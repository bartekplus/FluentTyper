// Handles prediction routing logic for FluentTyper
import type { PresageModule } from "./PresageTypes";
import { PresageHandler } from "./PresageHandler";
import {
  PredictionOrchestrator,
  PredictionConfig,
} from "./PredictionOrchestrator";
import type {
  AIPredictorStageDebugInfo,
  PredictionDebugEvent,
  PredictionResult,
  PredictionRunConfig,
  PredictorStageDebugInfo,
} from "./PredictionTypes";
import libPresageMod from "@third-party/libpresage/libpresage.js";
import { WebLLMPredictor } from "./WebLLMPredictor";
import { DEFAULT_AI_PREDICTION_TIMEOUT_MS } from "@core/domain/constants";
import { PredictorError, getErrorMessage } from "@core/domain/error";

export interface PredictionDebugRequestMeta {
  traceId?: string;
  requestId?: number;
  tabId?: number;
  frameId?: number;
  tributeId?: number;
}

export interface PredictorTraceTimelineEvent {
  timestampMs: number;
  stage: string;
  detail?: string;
}

export interface PredictorDebugTrace extends PredictionDebugEvent {
  traceId: string;
  requestId: number | null;
  tabId: number | null;
  frameId: number | null;
  tributeId: number | null;
  timeline: PredictorTraceTimelineEvent[];
}

export interface PredictorDebugSnapshot {
  generatedAtMs: number;
  config: {
    aiPredictorEnabled: boolean;
    aiModelId: string;
    aiPredictionTimeoutMs: number;
    debugPresagePredictorEnabled: boolean;
    debugAIPredictorEnabled: boolean;
  };
  runtime: {
    presage: {
      languageEngineCount: number;
    };
    webllm: {
      enabled: boolean;
      modelId: string;
      status: string;
      hasWebGPU: boolean;
      initAttemptCount: number;
      isGenerating: boolean;
      cacheSize: number;
      lastFailureAt: number | null;
      lastInitStartedAt: number | null;
      lastInitDurationMs: number | null;
      lastInitProgress: number | null;
      lastInitProgressAt: number | null;
      lastInitProgressText: string | null;
      lastInitError: string | null;
      lastInitProgressLog: Array<{
        atMs: number;
        progress: number;
        text: string;
      }>;
      lastPredictAt: number | null;
      lastPredictDurationMs: number | null;
      lastPredictSource: string;
      lastPredictInput: string | null;
      lastRawOutputPreview: string | null;
      lastPredictOutputCount: number;
      lastPredictError: string | null;
    };
  };
  traces: PredictorDebugTrace[];
}

const MAX_DEBUG_TRACES = 80;
const MAX_TRACE_TIMELINE_EVENTS = 48;
const TIMELINE_DETAIL_MAX_LENGTH = 180;

export class PredictionManager {
  private libPresageMod: () => Promise<PresageModule>;
  private presageHandler: PresageHandler | undefined;
  private predictionOrchestrator: PredictionOrchestrator | undefined;
  private webLLMPredictor: WebLLMPredictor | null = null;
  private initializationPromise: Promise<void> | null = null;
  private debugTraces: PredictorDebugTrace[] = [];
  private debugTraceById: Map<string, PredictorDebugTrace> = new Map();
  private currentConfig: PredictionConfig | null = null;

  constructor() {
    this.libPresageMod = libPresageMod as () => Promise<PresageModule>;
    this.initialize();
  }

  async initialize(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this._doInitializePresage();
    }
    return this.initializationPromise;
  }

  private async _doInitializePresage(): Promise<void> {
    try {
      const Module = await this.libPresageMod();
      this.presageHandler = new PresageHandler(Module);
      this.predictionOrchestrator = new PredictionOrchestrator(
        this.presageHandler,
        this.getWebLLMPredictor(),
      );
      if (this.currentConfig) {
        this.predictionOrchestrator.setConfig(this.currentConfig);
      }
    } catch (error) {
      throw new PredictorError("Failed to initialize prediction engines", {
        code: "predictor_initialize_failed",
        cause: error,
      });
    }
  }

  async runPrediction(
    text: string,
    nextChar: string,
    lang: string,
    configOverride?: { numSuggestions?: number },
    debugMeta?: PredictionDebugRequestMeta,
  ): Promise<PredictionResult> {
    await this.initialize();
    if (!this.predictionOrchestrator) {
      throw new PredictorError("Prediction orchestrator not initialized", {
        code: "predictor_orchestrator_missing",
      });
    }

    const resolvedDebugMeta = this.resolveDebugMeta(debugMeta);
    this.recordTraceTimelineEvent(
      resolvedDebugMeta,
      "predictor.orchestrator.start",
      `lang=${lang}`,
    );

    const runConfig: PredictionRunConfig = {
      numSuggestions: configOverride?.numSuggestions,
      debugListener: (debugEvent) => {
        this.recordDebugTrace(debugEvent, resolvedDebugMeta);
      },
    };

    try {
      const result = await this.predictionOrchestrator.runPrediction(
        text,
        nextChar,
        lang,
        runConfig,
      );
      this.recordTraceTimelineEvent(
        resolvedDebugMeta,
        "predictor.orchestrator.end",
        `${result.predictions.length} predictions`,
      );
      return result;
    } catch (error) {
      this.recordTraceTimelineEvent(
        resolvedDebugMeta,
        "predictor.orchestrator.error",
        getErrorMessage(error),
      );
      throw error;
    }
  }

  setConfig(config: PredictionConfig): void {
    this.currentConfig = {
      ...config,
    };
    if (!this.predictionOrchestrator) {
      throw new PredictorError("Prediction orchestrator not initialized", {
        code: "predictor_orchestrator_missing",
      });
    }
    this.predictionOrchestrator.setConfig(config);
  }

  clearPredictorDebugTrace(): void {
    this.debugTraces = [];
    this.debugTraceById.clear();
    this.getWebLLMPredictor().clearCache();
  }

  getPredictorDebugSnapshot(): PredictorDebugSnapshot {
    const webllmDebugState = this.getWebLLMPredictor().getDebugState();
    const presageDebugState = this.presageHandler?.getDebugState();
    const orchestratorDebugState =
      this.predictionOrchestrator?.getDebugState().predictorConfig;

    return {
      generatedAtMs: Date.now(),
      config: {
        aiPredictorEnabled:
          orchestratorDebugState?.aiPredictorEnabled ??
          this.currentConfig?.aiPredictorEnabled ??
          false,
        aiModelId:
          orchestratorDebugState?.aiModelId ??
          this.currentConfig?.aiModelId ??
          "",
        aiPredictionTimeoutMs:
          orchestratorDebugState?.aiPredictionTimeoutMs ??
          this.currentConfig?.aiPredictionTimeoutMs ??
          DEFAULT_AI_PREDICTION_TIMEOUT_MS,
        debugPresagePredictorEnabled:
          orchestratorDebugState?.debugPresagePredictorEnabled ??
          this.currentConfig?.debugPresagePredictorEnabled ??
          true,
        debugAIPredictorEnabled:
          orchestratorDebugState?.debugAIPredictorEnabled ??
          this.currentConfig?.debugAIPredictorEnabled ??
          true,
      },
      runtime: {
        presage: {
          languageEngineCount: presageDebugState?.languageEngineCount ?? 0,
        },
        webllm: {
          enabled: webllmDebugState.enabled,
          modelId: webllmDebugState.modelId,
          status: webllmDebugState.status,
          hasWebGPU: webllmDebugState.hasWebGPU,
          initAttemptCount: webllmDebugState.initAttemptCount,
          isGenerating: webllmDebugState.isGenerating,
          cacheSize: webllmDebugState.cacheSize,
          lastFailureAt: webllmDebugState.lastFailureAt,
          lastInitStartedAt: webllmDebugState.lastInitStartedAt,
          lastInitDurationMs: webllmDebugState.lastInitDurationMs,
          lastInitProgress: webllmDebugState.lastInitProgress,
          lastInitProgressAt: webllmDebugState.lastInitProgressAt,
          lastInitProgressText: webllmDebugState.lastInitProgressText,
          lastInitError: webllmDebugState.lastInitError,
          lastInitProgressLog: webllmDebugState.lastInitProgressLog.slice(),
          lastPredictAt: webllmDebugState.lastPredictAt,
          lastPredictDurationMs: webllmDebugState.lastPredictDurationMs,
          lastPredictSource: webllmDebugState.lastPredictSource,
          lastPredictInput: webllmDebugState.lastPredictInput,
          lastRawOutputPreview: webllmDebugState.lastRawOutputPreview,
          lastPredictOutputCount: webllmDebugState.lastPredictOutputCount,
          lastPredictError: webllmDebugState.lastPredictError,
        },
      },
      traces: this.debugTraces.map((trace) => ({
        ...trace,
        presage: {
          ...trace.presage,
          predictions: trace.presage.predictions.slice(),
        },
        webllm: {
          ...trace.webllm,
          predictions: trace.webllm.predictions.slice(),
        },
        mergedPredictions: trace.mergedPredictions.slice(),
        finalPredictions: trace.finalPredictions.slice(),
        timeline: trace.timeline.map((event) => ({ ...event })),
      })),
    };
  }

  ensureTraceId(traceId?: string): string {
    const normalized = this.normalizeTraceId(traceId);
    if (normalized) {
      return normalized;
    }
    return this.generateTraceId();
  }

  recordTraceTimelineEvent(
    debugMeta: PredictionDebugRequestMeta | undefined,
    stage: string,
    detail?: string,
    timestampMs: number = Date.now(),
  ): string {
    const trace = this.upsertTrace(debugMeta);
    const normalizedStage =
      typeof stage === "string" && stage.trim().length > 0
        ? stage.trim()
        : "event";
    const normalizedDetail = this.normalizeTimelineDetail(detail);
    const normalizedTimestamp =
      typeof timestampMs === "number" && Number.isFinite(timestampMs)
        ? timestampMs
        : Date.now();

    trace.timeline.push({
      timestampMs: normalizedTimestamp,
      stage: normalizedStage,
      detail: normalizedDetail,
    });
    if (trace.timeline.length > MAX_TRACE_TIMELINE_EVENTS) {
      trace.timeline = trace.timeline.slice(
        trace.timeline.length - MAX_TRACE_TIMELINE_EVENTS,
      );
    }
    this.promoteTrace(trace);
    return trace.traceId;
  }

  private recordDebugTrace(
    debugEvent: PredictionDebugEvent,
    debugMeta?: PredictionDebugRequestMeta,
  ): void {
    const trace = this.upsertTrace(debugMeta);

    trace.timestampMs = debugEvent.timestampMs;
    trace.text = debugEvent.text;
    trace.nextChar = debugEvent.nextChar;
    trace.lang = debugEvent.lang;
    trace.predictionInput = debugEvent.predictionInput;
    trace.numSuggestions = debugEvent.numSuggestions;
    trace.doPrediction = debugEvent.doPrediction;
    trace.forceReplace = debugEvent.forceReplace;
    trace.totalDurationMs = debugEvent.totalDurationMs;
    trace.presage = {
      ...debugEvent.presage,
      predictions: debugEvent.presage.predictions.slice(),
    };
    trace.webllm = {
      ...debugEvent.webllm,
      predictions: debugEvent.webllm.predictions.slice(),
    };
    trace.mergedPredictions = debugEvent.mergedPredictions.slice();
    trace.finalPredictions = debugEvent.finalPredictions.slice();

    trace.timeline.push({
      timestampMs: debugEvent.timestampMs,
      stage: "predictor.debug.snapshot",
      detail: this.normalizeTimelineDetail(
        `total=${Math.round(debugEvent.totalDurationMs)}ms final=${debugEvent.finalPredictions.length}`,
      ),
    });
    if (trace.timeline.length > MAX_TRACE_TIMELINE_EVENTS) {
      trace.timeline = trace.timeline.slice(
        trace.timeline.length - MAX_TRACE_TIMELINE_EVENTS,
      );
    }
    this.promoteTrace(trace);
  }

  private getWebLLMPredictor(): WebLLMPredictor {
    if (!this.webLLMPredictor) {
      this.webLLMPredictor = new WebLLMPredictor();
    }
    return this.webLLMPredictor;
  }

  private normalizeTraceId(traceId: unknown): string | null {
    if (typeof traceId !== "string") {
      return null;
    }
    const normalized = traceId.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private generateTraceId(): string {
    const randomPart =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    return `pred-${randomPart}`;
  }

  private resolveDebugMeta(
    debugMeta?: PredictionDebugRequestMeta,
  ): PredictionDebugRequestMeta {
    const traceId = this.ensureTraceId(debugMeta?.traceId);
    return {
      ...debugMeta,
      traceId,
    };
  }

  private upsertTrace(debugMeta?: PredictionDebugRequestMeta): PredictorDebugTrace {
    const resolvedDebugMeta = this.resolveDebugMeta(debugMeta);
    const traceId = resolvedDebugMeta.traceId as string;

    let trace = this.debugTraceById.get(traceId);
    if (!trace) {
      trace = this.createEmptyTrace(traceId, resolvedDebugMeta);
      this.debugTraceById.set(traceId, trace);
      this.debugTraces.unshift(trace);
      this.trimDebugTraceBuffer();
      return trace;
    }

    trace.requestId = this.resolveNumericMeta(
      resolvedDebugMeta.requestId,
      trace.requestId,
    );
    trace.tabId = this.resolveNumericMeta(resolvedDebugMeta.tabId, trace.tabId);
    trace.frameId = this.resolveNumericMeta(
      resolvedDebugMeta.frameId,
      trace.frameId,
    );
    trace.tributeId = this.resolveNumericMeta(
      resolvedDebugMeta.tributeId,
      trace.tributeId,
    );
    return trace;
  }

  private resolveNumericMeta(
    value: unknown,
    fallback: number | null,
  ): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  private createEmptyTrace(
    traceId: string,
    debugMeta: PredictionDebugRequestMeta,
  ): PredictorDebugTrace {
    const emptyPresageStage: PredictorStageDebugInfo = {
      enabled: false,
      attempted: false,
      durationMs: 0,
      timedOut: false,
      predictions: [],
      skipReason: undefined,
    };
    const emptyAIPredictorStage: AIPredictorStageDebugInfo = {
      enabled: false,
      attempted: false,
      durationMs: 0,
      timedOut: false,
      predictions: [],
      skipReason: undefined,
      modelId: "",
    };
    return {
      traceId,
      timestampMs: 0,
      text: "",
      nextChar: "",
      lang: "",
      predictionInput: "",
      numSuggestions: 0,
      doPrediction: false,
      forceReplace: false,
      totalDurationMs: 0,
      presage: emptyPresageStage,
      webllm: emptyAIPredictorStage,
      mergedPredictions: [],
      finalPredictions: [],
      requestId:
        typeof debugMeta.requestId === "number" ? debugMeta.requestId : null,
      tabId: typeof debugMeta.tabId === "number" ? debugMeta.tabId : null,
      frameId: typeof debugMeta.frameId === "number" ? debugMeta.frameId : null,
      tributeId:
        typeof debugMeta.tributeId === "number" ? debugMeta.tributeId : null,
      timeline: [],
    };
  }

  private promoteTrace(trace: PredictorDebugTrace): void {
    const currentIndex = this.debugTraces.findIndex(
      (item) => item.traceId === trace.traceId,
    );
    if (currentIndex === 0) {
      return;
    }
    if (currentIndex > -1) {
      this.debugTraces.splice(currentIndex, 1);
    }
    this.debugTraces.unshift(trace);
    this.trimDebugTraceBuffer();
  }

  private trimDebugTraceBuffer(): void {
    if (this.debugTraces.length <= MAX_DEBUG_TRACES) {
      return;
    }
    const removed = this.debugTraces.splice(MAX_DEBUG_TRACES);
    removed.forEach((trace) => {
      this.debugTraceById.delete(trace.traceId);
    });
  }

  private normalizeTimelineDetail(detail: unknown): string | undefined {
    if (typeof detail !== "string") {
      return undefined;
    }
    const compact = detail.replace(/\s+/g, " ").trim();
    if (compact.length === 0) {
      return undefined;
    }
    if (compact.length <= TIMELINE_DETAIL_MAX_LENGTH) {
      return compact;
    }
    return `${compact.slice(0, TIMELINE_DETAIL_MAX_LENGTH)}...`;
  }
}

export type { PredictionConfig };
