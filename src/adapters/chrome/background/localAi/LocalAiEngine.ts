import type { LocalAiErrorCode, LocalAiUnavailableReason } from "@core/domain/contracts/localAi";
import {
  localAiModelById,
  localAiModelFileUrl,
  type LocalAiModelRecord,
} from "@core/domain/localAi/modelRegistry";
import { aiMaxOutputTokens, buildAiMessages } from "@core/domain/grammar/review/ai/prompts";
import { MAX_AI_RAW_OUTPUT_CHARS, parseAiResponse } from "@core/domain/grammar/review/ai/parse";
import type {
  AiGenerationOutcome,
  AiGenerationRequest,
} from "@core/domain/grammar/review/ai/types";
import { NetworkBlockedError, type NetworkGuard } from "./networkGuard";
import {
  IntegrityError,
  deleteModelArtifacts,
  downloadModelFiles,
  markModelVerified,
  modelCacheState,
  type CacheStorageLike,
} from "./modelArtifacts";

/**
 * The Local AI engine, run in-process by the background service worker. Its
 * epoch discards loads completed after unload. Returns bounded, text-free data.
 */

export type LoadResult =
  { ok: true } | { ok: false; error?: LocalAiErrorCode; unavailable?: LocalAiUnavailableReason };

export type ProgressPhase = "download" | "load";

/** Just the tensor surface used here. */
export interface TensorLike {
  dims: readonly number[];
  slice(...slices: Array<number | Array<number | null> | null>): TensorLike;
}

export interface TokenizerLike {
  apply_chat_template(
    messages: Array<{ role: string; content: string }>,
    options: { add_generation_prompt: true; return_dict: true; enable_thinking?: boolean },
  ): unknown;
  batch_decode(batch: TensorLike, options: { skip_special_tokens: boolean }): string[];
}

export interface StopperLike {
  interrupted: boolean;
  interrupt(): void;
}

export interface ModelLike {
  generate(options: {
    input_ids: TensorLike;
    attention_mask: unknown;
    max_new_tokens: number;
    do_sample: false;
    stopping_criteria: StopperLike[];
  }): Promise<unknown>;
  dispose(): Promise<unknown>;
}

/** The Transformers.js calls the engine makes (engineRuntime.ts binds the real library). */
interface TransformersRuntime {
  loadTokenizer(record: LocalAiModelRecord): Promise<TokenizerLike>;
  loadModel(record: LocalAiModelRecord): Promise<ModelLike>;
  createStopper(): StopperLike;
}

interface GpuAdapterLike {
  features: { has(feature: string): boolean };
}

export interface GpuLike {
  requestAdapter(options?: {
    powerPreference?: "high-performance";
  }): Promise<GpuAdapterLike | null>;
}

export interface EngineDeps {
  runtime: TransformersRuntime;
  caches: CacheStorageLike;
  gpu: GpuLike | undefined;
  /** Every engine fetch (Transformers.js and downloads) goes through the guard. */
  guard: NetworkGuard;
  /** Registry lookup (tests use tiny synthetic records). */
  findModel?: (modelId: unknown) => LocalAiModelRecord | null;
  /** Upper bound on one `dispose()`; a hung one is abandoned (tests shorten it). */
  disposeTimeoutMs?: number;
}

const DISPOSE_TIMEOUT_MS = 10_000;

interface LoadedModel {
  modelId: string;
  tokenizer: TokenizerLike;
  model: ModelLike;
}

function installErrorCode(error: unknown): LocalAiErrorCode {
  if (error instanceof IntegrityError) {
    return "integrity-failed";
  }
  return (error as Error | null)?.name === "QuotaExceededError"
    ? "storage-full"
    : "download-failed";
}

/** A GPU-less machine can leave `requestAdapter` pending forever: treat that as no adapter. */
const ADAPTER_TIMEOUT_MS = 5_000;

export async function probeGpu(
  gpu: GpuLike | undefined,
  record: LocalAiModelRecord,
  adapterTimeoutMs = ADAPTER_TIMEOUT_MS,
): Promise<LocalAiUnavailableReason | null> {
  if (!gpu) {
    return "no-webgpu";
  }
  let adapter: GpuAdapterLike | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    adapter = await Promise.race([
      gpu.requestAdapter({ powerPreference: "high-performance" }),
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), adapterTimeoutMs))),
    ]);
  } catch {
    adapter = null;
  } finally {
    clearTimeout(timer);
  }
  if (!adapter) {
    return "no-adapter";
  }
  return record.requiredFeatures.every((feature) => adapter.features.has(feature))
    ? null
    : "missing-feature";
}

type ProgressSink = (phase: ProgressPhase, progress: number) => void;

export class LocalAiEngine {
  private loaded: LoadedModel | null = null;
  private loading: { modelId: string; promise: Promise<LoadResult> } | null = null;
  private epoch = 0;
  private stopper: StopperLike | null = null;
  private interruptRequested = false;
  private readonly findModel: (modelId: unknown) => LocalAiModelRecord | null;

  constructor(private readonly deps: EngineDeps) {
    this.findModel = deps.findModel ?? localAiModelById;
  }

  async probe(modelId: string): Promise<LocalAiUnavailableReason | null> {
    const record = this.findModel(modelId);
    return record ? probeGpu(this.deps.gpu, record) : "not-in-build";
  }

  async cacheState(modelId: string): Promise<"none" | "partial" | "complete"> {
    const record = this.findModel(modelId);
    if (!record) {
      return "none";
    }
    try {
      return await modelCacheState(this.deps.caches, record);
    } catch {
      return "partial";
    }
  }

  /**
   * Explicit install, the only time network is allowed: download and verify
   * the listed files, load once from the cache (network denied), then mark
   * the model verified. Leaves the model loaded. `signal` cancels it at once;
   * a load that outlives `loadTimeoutMs` or the cancel is abandoned (its late
   * model is discarded).
   */
  async install(
    modelId: string,
    onProgress: ProgressSink,
    signal: AbortSignal,
    loadTimeoutMs: number,
  ): Promise<LoadResult> {
    const record = this.findModel(modelId);
    if (!record) {
      return { ok: false, error: "download-failed" };
    }
    await this.unload();
    this.deps.guard.allowDownloads(
      new Set(record.files.map((file) => localAiModelFileUrl(record, file))),
    );
    try {
      onProgress("download", 0);
      await downloadModelFiles(
        this.deps.caches,
        record,
        (url, init) => this.deps.guard.fetch(url, init),
        (bytes) => onProgress("download", Math.min(1, bytes / record.downloadBytes)),
        signal,
      );
    } catch (error) {
      return { ok: false, error: signal.aborted ? "download-cancelled" : installErrorCode(error) };
    } finally {
      this.deps.guard.allowDownloads(null);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<LoadResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: "load-failed" }), loadTimeoutMs);
      signal.addEventListener("abort", () => resolve({ ok: false, error: "load-failed" }), {
        once: true,
      });
    });
    const result = await Promise.race([this.load(modelId, onProgress), stopped]);
    clearTimeout(timer);
    if (signal.aborted) {
      await this.unload();
      return { ok: false, error: "download-cancelled" };
    }
    if (!result.ok) {
      // A failed or abandoned load: nothing stays half-loaded on the GPU.
      await this.unload();
    } else {
      try {
        await markModelVerified(this.deps.caches, record);
      } catch (error) {
        // Not installed after all: the loaded model must not outlive the failure.
        await this.unload();
        return { ok: false, error: installErrorCode(error) };
      }
    }
    return result;
  }

  /** Single-flight per model id: concurrent loads of the same model share one promise. */
  load(modelId: string, onProgress: ProgressSink): Promise<LoadResult> {
    if (this.loaded?.modelId === modelId) {
      return Promise.resolve({ ok: true });
    }
    if (this.loading?.modelId === modelId) {
      return this.loading.promise;
    }
    const record = this.findModel(modelId);
    if (!record) {
      return Promise.resolve({ ok: false, error: "load-failed" });
    }
    const unloading = this.unload();
    const epoch = this.epoch;
    const promise = unloading.then(() => this.runLoad(record, onProgress, epoch));
    const loading = { modelId, promise };
    this.loading = loading;
    void promise.finally(() => {
      if (this.loading === loading) {
        this.loading = null;
      }
    });
    return promise;
  }

  private async runLoad(
    record: LocalAiModelRecord,
    onProgress: ProgressSink,
    epoch: number,
  ): Promise<LoadResult> {
    if (epoch !== this.epoch) {
      return { ok: false, error: "load-failed" };
    }
    onProgress("load", 0);
    this.deps.guard.takeBlockedUrl();
    try {
      const tokenizer = await this.deps.runtime.loadTokenizer(record);
      if (epoch !== this.epoch) {
        // Abandoned while the tokenizer loaded: never start an obsolete GPU allocation.
        return { ok: false, error: "load-failed" };
      }
      const model = await this.deps.runtime.loadModel(record);
      if (epoch !== this.epoch) {
        // Unloaded, deleted or switched while loading: discard the late model.
        await this.dispose(model);
        return { ok: false, error: "load-failed" };
      }
      this.loaded = { modelId: record.modelId, tokenizer, model };
      onProgress("load", 1);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: this.loadErrorCode(record, error) };
    }
  }

  /**
   * A load reads only from the cache. A refused request for a listed file means
   * the cache is incomplete; for an unlisted file, the registry is missing it.
   */
  private loadErrorCode(record: LocalAiModelRecord, error: unknown): LocalAiErrorCode {
    const blocked = this.deps.guard.takeBlockedUrl();
    if (error instanceof NetworkBlockedError && blocked) {
      const listed = record.files.some((file) => localAiModelFileUrl(record, file) === blocked);
      if (listed) {
        return "cache-failed";
      }
      // A model file path (never user text), so maintainers can add it to the registry.
      console.warn("Local AI: the loader requested a file missing from the registry", blocked);
    }
    return "load-failed";
  }

  /**
   * Disposes the model and drops the tokenizer/model references. A load still
   * in flight is not awaited (it may hang with a lost device): the epoch
   * discards its model when it lands, and the next load starts afresh.
   */
  async unload(): Promise<void> {
    this.epoch += 1;
    this.deps.guard.allowDownloads(null);
    const loaded = this.loaded;
    this.loaded = null;
    this.loading = null;
    if (loaded) {
      await this.dispose(loaded.model);
    }
  }

  /** A dispose that hangs (e.g. on a lost GPU device) must not hold the host's lock. */
  private async dispose(model: ModelLike): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      model.dispose().catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(resolve, this.deps.disposeTimeoutMs ?? DISPOSE_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  /** Throws if the cache refuses; the host reads the outcome back with `cacheState`. */
  async delete(modelId: string): Promise<void> {
    const record = this.findModel(modelId);
    if (!record) {
      return;
    }
    if (this.loaded?.modelId === modelId || this.loading?.modelId === modelId) {
      await this.unload();
    }
    await deleteModelArtifacts(this.deps.caches, record);
  }

  interrupt(): void {
    this.interruptRequested = true;
    this.stopper?.interrupt();
  }

  async generate(modelId: string, request: AiGenerationRequest): Promise<AiGenerationOutcome> {
    const loaded = this.loaded;
    const record = this.findModel(modelId);
    if (!loaded || loaded.modelId !== modelId || !record) {
      return { ok: false, error: "not-ready" };
    }
    this.interruptRequested = false;
    const stopper = this.deps.runtime.createStopper();
    this.stopper = stopper;
    try {
      const inputs = loaded.tokenizer.apply_chat_template(buildAiMessages(request), {
        add_generation_prompt: true,
        return_dict: true,
        ...(record.disableThinking ? { enable_thinking: false } : {}),
      }) as { input_ids?: TensorLike; attention_mask?: unknown } | null;
      const inputIds = inputs?.input_ids;
      if (!inputIds) {
        return { ok: false, error: "engine-failed" };
      }
      if (this.interruptRequested) {
        return { ok: false, error: "cancelled" };
      }
      const promptTokens = inputIds.dims.at(-1) ?? 0;
      const maxNewTokens = aiMaxOutputTokens(request);
      const output = (await loaded.model.generate({
        input_ids: inputIds,
        attention_mask: inputs.attention_mask,
        max_new_tokens: maxNewTokens,
        do_sample: false,
        stopping_criteria: [stopper],
      })) as TensorLike;
      if (stopper.interrupted || this.interruptRequested) {
        return { ok: false, error: "cancelled" };
      }
      const generated = output.slice(null, [promptTokens, null]);
      if ((generated.dims.at(-1) ?? 0) >= maxNewTokens) {
        return { ok: false, error: "truncated" };
      }
      const raw = loaded.tokenizer.batch_decode(generated, { skip_special_tokens: true })[0] ?? "";
      if (raw.length > MAX_AI_RAW_OUTPUT_CHARS) {
        return { ok: false, error: "malformed" };
      }
      return parseAiResponse(raw, request);
    } catch {
      return { ok: false, error: "engine-failed" };
    } finally {
      // A generation abandoned by the host may settle after a newer one started.
      if (this.stopper === stopper) {
        this.stopper = null;
      }
    }
  }
}
