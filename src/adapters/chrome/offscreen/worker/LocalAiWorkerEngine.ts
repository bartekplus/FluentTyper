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
import type {
  WorkerCall,
  WorkerLoadResult,
  WorkerProgressPhase,
  WorkerReply,
  WorkerRequest,
  WorkerResults,
} from "../workerProtocol";
import { NetworkBlockedError, type NetworkGuard } from "./networkGuard";
import {
  IntegrityError,
  deleteModelArtifacts,
  downloadModelFiles,
  markModelVerified,
  modelCacheState,
  type CacheStorageLike,
} from "./modelArtifacts";

/** Dedicated worker engine. Its epoch discards loads completed after unload. */

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

/** The Transformers.js calls the engine makes (the worker entry binds the real library). */
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

export interface WorkerEngineDeps {
  runtime: TransformersRuntime;
  caches: CacheStorageLike;
  gpu: GpuLike | undefined;
  guard: NetworkGuard;
  /** The worker's guarded fetch (downloads go through the guard). */
  fetch: (url: string) => Promise<Response>;
  /** Registry lookup (tests use tiny synthetic records). */
  findModel?: (modelId: unknown) => LocalAiModelRecord | null;
}

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

export async function probeGpu(
  gpu: GpuLike | undefined,
  record: LocalAiModelRecord,
): Promise<LocalAiUnavailableReason | null> {
  if (!gpu) {
    return "no-webgpu";
  }
  let adapter: GpuAdapterLike | null = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch {
    adapter = null;
  }
  if (!adapter) {
    return "no-adapter";
  }
  return record.requiredFeatures.every((feature) => adapter.features.has(feature))
    ? null
    : "missing-feature";
}

type ProgressSink = (phase: WorkerProgressPhase, progress: number) => void;

export class LocalAiWorkerEngine {
  private loaded: LoadedModel | null = null;
  private loading: { modelId: string; promise: Promise<WorkerLoadResult> } | null = null;
  private epoch = 0;
  private stopper: StopperLike | null = null;
  private interruptRequested = false;
  private readonly findModel: (modelId: unknown) => LocalAiModelRecord | null;

  constructor(private readonly deps: WorkerEngineDeps) {
    this.findModel = deps.findModel ?? localAiModelById;
  }

  /** Serves one host request; replies only with bounded, text-free data. */
  async handle(message: WorkerRequest, reply: (message: WorkerReply) => void): Promise<void> {
    if (message.type === "interrupt") {
      this.interrupt();
      return;
    }
    const { id } = message;
    const onProgress: ProgressSink = (phase, progress) =>
      reply({ id, type: "progress", phase, progress });
    reply({ id, type: "result", result: await this.run(message, onProgress) });
  }

  private run(
    call: WorkerCall,
    onProgress: ProgressSink,
  ): Promise<WorkerResults[WorkerCall["type"]]> {
    switch (call.type) {
      case "probe":
        return this.probe(call.modelId);
      case "cache-state":
        return this.cacheState(call.modelId);
      case "install":
        return this.install(call.modelId, onProgress);
      case "load":
        return this.load(call.modelId, onProgress);
      case "generate":
        return this.generate(call.modelId, call.request);
      case "unload":
        return this.unload().then(() => null);
      case "delete":
        return this.delete(call.modelId);
    }
  }

  async probe(modelId: string): Promise<WorkerResults["probe"]> {
    const record = this.findModel(modelId);
    return { unavailable: record ? await probeGpu(this.deps.gpu, record) : "not-in-build" };
  }

  async cacheState(modelId: string): Promise<WorkerResults["cache-state"]> {
    const record = this.findModel(modelId);
    if (!record) {
      return { install: "none" };
    }
    try {
      return { install: await modelCacheState(this.deps.caches, record) };
    } catch {
      return { install: "partial" };
    }
  }

  /**
   * Explicit install, the only time network is allowed: download and verify
   * the listed files, load once from the cache (network denied), then mark
   * the model verified. Leaves the model loaded.
   */
  async install(modelId: string, onProgress: ProgressSink): Promise<WorkerLoadResult> {
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
      await downloadModelFiles(this.deps.caches, record, this.deps.fetch, (bytes) =>
        onProgress("download", Math.min(1, bytes / record.downloadBytes)),
      );
    } catch (error) {
      return { ok: false, error: installErrorCode(error) };
    } finally {
      this.deps.guard.allowDownloads(null);
    }
    const result = await this.load(modelId, onProgress);
    if (result.ok) {
      try {
        await markModelVerified(this.deps.caches, record);
      } catch (error) {
        return { ok: false, error: installErrorCode(error) };
      }
    }
    return result;
  }

  /** Single-flight per model id: concurrent loads of the same model share one promise. */
  load(modelId: string, onProgress: ProgressSink): Promise<WorkerLoadResult> {
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
  ): Promise<WorkerLoadResult> {
    if (epoch !== this.epoch) {
      return { ok: false, error: "load-failed" };
    }
    onProgress("load", 0);
    this.deps.guard.takeBlockedUrl();
    try {
      const tokenizer = await this.deps.runtime.loadTokenizer(record);
      const model = await this.deps.runtime.loadModel(record);
      if (epoch !== this.epoch) {
        // Unloaded, deleted or switched while loading: discard the late model.
        await model.dispose().catch(() => undefined);
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

  async unload(): Promise<void> {
    this.epoch += 1;
    this.deps.guard.allowDownloads(null);
    const loaded = this.loaded;
    const loading = this.loading;
    this.loaded = null;
    if (loaded) {
      await loaded.model.dispose().catch(() => undefined);
    }
    if (loading) {
      await loading.promise;
    }
  }

  /** The host reads the outcome back with `cache-state`. */
  async delete(modelId: string): Promise<null> {
    const record = this.findModel(modelId);
    if (!record) {
      return null;
    }
    if (this.loaded?.modelId === modelId || this.loading?.modelId === modelId) {
      await this.unload();
    }
    await deleteModelArtifacts(this.deps.caches, record).catch(() => undefined);
    return null;
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
      this.stopper = null;
    }
  }
}
