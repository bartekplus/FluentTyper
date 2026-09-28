import type {
  AppConfig,
  ChatCompletionChunk,
  ChatCompletionRequestStreaming,
  InitProgressReport,
} from "@mlc-ai/web-llm";
import type { LocalAiErrorCode, LocalAiUnavailableReason } from "@core/domain/contracts/localAi";
import { localAiModelById, type LocalAiModelRecord } from "@core/domain/localAi/modelRegistry";
import { aiMaxOutputTokens, buildAiMessages } from "@core/domain/grammar/review/ai/prompts";
import { MAX_AI_RAW_OUTPUT_CHARS, parseAiResponse } from "@core/domain/grammar/review/ai/parse";
import type {
  AiErrorCode,
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
import { NETWORK_BLOCKED_ERROR_NAME, type NetworkGuard } from "./networkGuard";
import {
  deleteModelArtifacts,
  localAiAppConfig,
  modelCacheState,
  type CacheStorageLike,
} from "./modelArtifacts";

/**
 * The only WebLLM engine (runs inside the dedicated worker).
 *
 * - One engine, one model at a time. Loads are single-flight per model id; an
 *   epoch discards a load that finishes after unload/delete/model switch.
 * - Network is allowed only during an explicit install (see networkGuard).
 * - Every generation starts and ends with resetChat(): no history, no
 *   resumable generation. Deltas are collected, never forwarded.
 * - Errors become bounded codes by error class name; no message text leaves.
 */

/** The subset of MLCEngine used here (keeps the engine fakeable in tests). */
export interface EngineLike {
  chat: {
    completions: {
      create(request: ChatCompletionRequestStreaming): Promise<AsyncIterable<ChatCompletionChunk>>;
    };
  };
  interruptGenerate(): unknown;
  resetChat(): Promise<void>;
  unload(): Promise<void>;
}

interface GpuAdapterLike {
  features: { has(feature: string): boolean };
  limits: {
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
    maxComputeWorkgroupStorageSize: number;
    maxStorageBuffersPerShaderStage: number;
  };
}

export interface GpuLike {
  requestAdapter(options?: {
    powerPreference?: "high-performance";
  }): Promise<GpuAdapterLike | null>;
}

export interface WorkerEngineDeps {
  createEngine(
    modelId: string,
    appConfig: AppConfig,
    onProgress: (report: InitProgressReport) => void,
  ): Promise<EngineLike>;
  caches: CacheStorageLike;
  gpu: GpuLike | undefined;
  guard: NetworkGuard;
  extensionOrigin: string;
  /** Domain prompt/parse functions (injected in tests). */
  ai?: {
    buildAiMessages: typeof buildAiMessages;
    aiMaxOutputTokens: typeof aiMaxOutputTokens;
    parseAiResponse: typeof parseAiResponse;
  };
}

/** Minimums WebLLM 0.2.85 enforces in detectGPUDevice (its fallback values). */
const MIN_GPU_LIMITS = {
  maxBufferSize: 1 << 28,
  maxStorageBufferBindingSize: 1 << 27,
  maxComputeWorkgroupStorageSize: 32 << 10,
  maxStorageBuffersPerShaderStage: 10,
} as const;

const CORRECT_TEMPERATURE = 0;
const REWRITE_TEMPERATURE = 0.4;

function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "";
}

export function unavailableReasonForError(error: unknown): LocalAiUnavailableReason | null {
  switch (errorName(error)) {
    case "WebGPUNotAvailableError":
    case "WebGPUNotFoundError":
      return "no-webgpu";
    case "ShaderF16SupportError":
    case "FeatureSupportError":
      return "missing-feature";
    default:
      return null;
  }
}

export function loadErrorCode(error: unknown, downloading: boolean): LocalAiErrorCode {
  switch (errorName(error)) {
    case "DeviceLostError":
      return "device-lost";
    case "IntegrityError":
      return "integrity-failed";
    case "QuotaExceededError":
      return "storage-full";
    case NETWORK_BLOCKED_ERROR_NAME:
      return downloading ? "download-failed" : "cache-failed";
    default:
      return downloading ? "download-failed" : "load-failed";
  }
}

export function generationErrorCode(error: unknown): AiErrorCode {
  switch (errorName(error)) {
    case "DeviceLostError":
      return "device-lost";
    case "ContextWindowSizeExceededError":
      return "too-large";
    default:
      return "engine-failed";
  }
}

function progressPhase(report: InitProgressReport, installing: boolean): WorkerProgressPhase {
  const text = typeof report.text === "string" ? report.text : "";
  return installing && (text.startsWith("Fetching") || text.startsWith("Start to fetch"))
    ? "download"
    : "load";
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
  if (!record.requiredFeatures.every((feature) => adapter.features.has(feature))) {
    return "missing-feature";
  }
  const limits = adapter.limits;
  const sufficient = (Object.keys(MIN_GPU_LIMITS) as Array<keyof typeof MIN_GPU_LIMITS>).every(
    (key) => typeof limits[key] === "number" && limits[key] >= MIN_GPU_LIMITS[key],
  );
  return sufficient ? null : "insufficient-limits";
}

type ProgressSink = (phase: WorkerProgressPhase, progress: number) => void;

export class LocalAiWorkerEngine {
  private engine: EngineLike | null = null;
  private engineModelId: string | null = null;
  private loading: { modelId: string; promise: Promise<WorkerLoadResult> } | null = null;
  private epoch = 0;
  private interruptRequested = false;
  private readonly ai: NonNullable<WorkerEngineDeps["ai"]>;

  constructor(private readonly deps: WorkerEngineDeps) {
    this.ai = deps.ai ?? { buildAiMessages, aiMaxOutputTokens, parseAiResponse };
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
        return this.load(call.modelId, false, onProgress);
      case "generate":
        return this.generate(call.modelId, call.request);
      case "unload":
        return this.unload().then(() => null);
      case "delete":
        return this.delete(call.modelId);
    }
  }

  async probe(modelId: string): Promise<WorkerResults["probe"]> {
    const record = localAiModelById(modelId);
    return { unavailable: record ? await probeGpu(this.deps.gpu, record) : "not-in-build" };
  }

  async cacheState(modelId: string): Promise<WorkerResults["cache-state"]> {
    const record = localAiModelById(modelId);
    if (!record) {
      return { install: "none" };
    }
    try {
      return { install: await modelCacheState(this.deps.caches, record) };
    } catch {
      return { install: "partial" };
    }
  }

  /** Explicit install: the only time network is allowed. Leaves the engine warm. */
  async install(modelId: string, onProgress: ProgressSink): Promise<WorkerLoadResult> {
    if (
      this.engine &&
      this.engineModelId === modelId &&
      (await this.cacheState(modelId)).install === "complete"
    ) {
      return { ok: true };
    }
    await this.unload();
    return this.load(modelId, true, onProgress);
  }

  /** Single-flight per model id: concurrent loads of the same model share one promise. */
  load(
    modelId: string,
    allowNetwork: boolean,
    onProgress: ProgressSink,
  ): Promise<WorkerLoadResult> {
    if (this.engine && this.engineModelId === modelId) {
      return Promise.resolve({ ok: true });
    }
    if (this.loading?.modelId === modelId) {
      return this.loading.promise;
    }
    const record = localAiModelById(modelId);
    if (!record) {
      return Promise.resolve({ ok: false, error: "load-failed" });
    }
    const unloading = this.unload();
    const epoch = this.epoch;
    const promise = unloading.then(() => this.runLoad(record, allowNetwork, onProgress, epoch));
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
    allowNetwork: boolean,
    onProgress: ProgressSink,
    epoch: number,
  ): Promise<WorkerLoadResult> {
    if (epoch !== this.epoch) {
      return { ok: false, error: "load-failed" };
    }
    let phase: WorkerProgressPhase = allowNetwork ? "download" : "load";
    this.deps.guard.setNetworkAllowed(allowNetwork);
    try {
      const engine = await this.deps.createEngine(
        record.modelId,
        localAiAppConfig(record, this.deps.extensionOrigin),
        (report) => {
          phase = progressPhase(report, allowNetwork);
          const progress = Number.isFinite(report.progress) ? report.progress : 0;
          onProgress(phase, Math.max(0, Math.min(1, progress)));
        },
      );
      if (epoch !== this.epoch) {
        // Unloaded, deleted or switched while loading: discard the late engine.
        await engine.unload().catch(() => undefined);
        return { ok: false, error: "load-failed" };
      }
      this.engine = engine;
      this.engineModelId = record.modelId;
      return { ok: true };
    } catch (error) {
      const unavailable = unavailableReasonForError(error);
      return unavailable
        ? { ok: false, unavailable }
        : { ok: false, error: loadErrorCode(error, allowNetwork && phase === "download") };
    } finally {
      if (epoch === this.epoch) {
        this.deps.guard.setNetworkAllowed(false);
      }
    }
  }

  async unload(): Promise<void> {
    this.epoch += 1;
    this.deps.guard.setNetworkAllowed(false);
    const engine = this.engine;
    const loading = this.loading;
    this.engine = null;
    this.engineModelId = null;
    if (engine) {
      await engine.unload().catch(() => undefined);
    }
    if (loading) {
      await loading.promise;
    }
  }

  async delete(modelId: string): Promise<WorkerResults["delete"]> {
    const record = localAiModelById(modelId);
    if (!record) {
      return { ok: false };
    }
    if (this.engineModelId === modelId || this.loading?.modelId === modelId) {
      await this.unload();
    }
    try {
      await deleteModelArtifacts(this.deps.caches, record);
      return { ok: (await this.cacheState(modelId)).install === "none" };
    } catch {
      return { ok: false };
    }
  }

  interrupt(): void {
    this.interruptRequested = true;
    void Promise.resolve(this.engine?.interruptGenerate()).catch(() => undefined);
  }

  async generate(modelId: string, request: AiGenerationRequest): Promise<AiGenerationOutcome> {
    const engine = this.engine;
    const record = localAiModelById(modelId);
    if (!engine || this.engineModelId !== modelId || !record) {
      return { ok: false, error: "not-ready" };
    }
    this.interruptRequested = false;
    try {
      await engine.resetChat();
      if (this.interruptRequested) {
        return { ok: false, error: "cancelled" };
      }
      const stream = await engine.chat.completions.create({
        messages: this.ai.buildAiMessages(request),
        stream: true,
        n: 1,
        temperature: request.mode === "rewrite" ? REWRITE_TEMPERATURE : CORRECT_TEMPERATURE,
        max_tokens: this.ai.aiMaxOutputTokens(request),
        response_format: { type: "json_object" },
        ...(record.thinking === "qwen3-enable-thinking"
          ? { extra_body: { enable_thinking: false } }
          : {}),
      });
      let raw = "";
      let finishReason: string | null = null;
      let overflow = false;
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const delta = choice?.delta?.content ?? "";
        if (raw.length + delta.length > MAX_AI_RAW_OUTPUT_CHARS) {
          if (!overflow) {
            overflow = true;
            this.interrupt();
          }
        } else {
          raw += delta;
        }
        finishReason = choice?.finish_reason ?? finishReason;
      }
      if (overflow) {
        return { ok: false, error: "malformed" };
      }
      if (this.interruptRequested || finishReason === "abort") {
        return { ok: false, error: "cancelled" };
      }
      if (finishReason === "length") {
        return { ok: false, error: "truncated" };
      }
      return this.ai.parseAiResponse(raw, request);
    } catch (error) {
      return { ok: false, error: generationErrorCode(error) };
    } finally {
      await engine.resetChat().catch(() => undefined);
    }
  }
}
