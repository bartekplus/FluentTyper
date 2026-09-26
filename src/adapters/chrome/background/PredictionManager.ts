import { randomUUID } from "@core/domain/randomId";
import type { PresageModule } from "./PresageTypes";
import { PresageHandler } from "./PresageHandler";
import type { SpellingLookupOptions } from "./PresageEngine";
import {
  PredictionOrchestrator,
  type PredictionConfig,
  type PredictorDebugConfig,
} from "./PredictionOrchestrator";
import type {
  AIPredictorStageDebugInfo,
  PredictionDebugEvent,
  PredictionResult,
  PredictionRunConfig,
  PredictionConfigOverride,
  PredictorStageDebugInfo,
} from "./PredictionTypes";
import libPresageMod from "@third-party/libpresage/libpresage.js";
import { WebLLMPredictor, type WebLLMPredictorDebugState } from "./WebLLMPredictor";
import { createLogger } from "@core/application/logging/Logger";
import { DEFAULT_AI_PREDICTION_TIMEOUT_MS } from "@core/domain/constants";
import { PredictorError, getErrorMessage } from "@core/domain/error";
import type { PersonalizationRankingSnapshot } from "@core/domain/personalization/types";

interface PredictionManagerOptions {
  getPersonalizationSnapshot?: () => PersonalizationRankingSnapshot;
}

interface PredictionDebugRequestMeta {
  traceId?: string;
  requestId?: number;
  tabId?: number;
  frameId?: number;
  suggestionId?: number;
}

interface PredictorTraceTimelineEvent {
  timestampMs: number;
  stage: string;
  detail?: string;
}

interface PredictorDebugTrace extends PredictionDebugEvent {
  traceId: string;
  requestId: number | null;
  tabId: number | null;
  frameId: number | null;
  suggestionId: number | null;
  timeline: PredictorTraceTimelineEvent[];
}

export interface PredictorDebugSnapshot {
  generatedAtMs: number;
  config: PredictorDebugConfig;
  runtime: {
    presage: {
      languageEngineCount: number;
    };
    webllm: WebLLMPredictorDebugState;
  };
  traces: PredictorDebugTrace[];
}

const MAX_DEBUG_TRACES = 80;
const MAX_TRACE_TIMELINE_EVENTS = 48;
const TIMELINE_DETAIL_MAX_LENGTH = 180;
const logger = createLogger("PredictionManager");

export class PredictionManager {
  private libPresageMod: () => Promise<PresageModule>;
  private presageHandler: PresageHandler | undefined;
  private predictionOrchestrator: PredictionOrchestrator | undefined;
  private readonly webLLMPredictor = new WebLLMPredictor();
  private initializationPromise: Promise<void> | null = null;
  private debugTraces: PredictorDebugTrace[] = [];
  private debugTraceById: Map<string, PredictorDebugTrace> = new Map();
  private currentConfig: PredictionConfig | null = null;
  private readonly getPersonalizationSnapshot: () => PersonalizationRankingSnapshot;

  constructor(options: PredictionManagerOptions = {}) {
    this.libPresageMod = libPresageMod as () => Promise<PresageModule>;
    this.getPersonalizationSnapshot = options.getPersonalizationSnapshot ?? (() => ({}));
    void this.initialize();
  }

  async initialize(): Promise<void> {
    this.initializationPromise ??= this._doInitializePresage();
    return this.initializationPromise;
  }

  private async _doInitializePresage(): Promise<void> {
    try {
      const Module = await this.libPresageMod();
      this.presageHandler = new PresageHandler(Module, {
        getPersonalizationSnapshot: this.getPersonalizationSnapshot,
      });
      this.predictionOrchestrator = new PredictionOrchestrator(
        this.presageHandler,
        this.webLLMPredictor,
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

  /** Review spelling lookups (see PresageHandler.lookupSpelling); null without an engine. */
  async lookupSpelling(
    lang: string,
    words: ReadonlyArray<{ word: string; before: string }>,
    options?: SpellingLookupOptions,
  ): Promise<Array<string[] | null> | null> {
    await this.initialize();
    return this.presageHandler?.lookupSpelling(lang, words, options) ?? null;
  }

  async runPrediction(
    text: string,
    nextChar: string,
    lang: string,
    configOverride?: PredictionConfigOverride,
    debugMeta?: PredictionDebugRequestMeta,
    afterCursorTokenSuffix?: string,
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
      ...(configOverride?.suppressAutoCapitalize === true ? { suppressAutoCapitalize: true } : {}),
      tabId: resolvedDebugMeta.tabId ?? undefined,
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
        afterCursorTokenSuffix,
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
    logger.info("Applying prediction manager config", {
      aiPredictorEnabled: config.aiPredictorEnabled,
      debugPresagePredictorEnabled: config.debugPresagePredictorEnabled,
      debugAIPredictorEnabled: config.debugAIPredictorEnabled,
    });
    if (!this.predictionOrchestrator) {
      throw new PredictorError("Prediction orchestrator not initialized", {
        code: "predictor_orchestrator_missing",
      });
    }
    this.predictionOrchestrator.setConfig(config);
  }

  clearPredictorDebugTrace(): void {
    logger.info("Clearing predictor debug traces");
    this.debugTraces = [];
    this.debugTraceById.clear();
  }

  getPredictorDebugSnapshot(): PredictorDebugSnapshot {
    const webllmDebugState = this.webLLMPredictor.getDebugState();
    const presageDebugState = this.presageHandler?.getDebugState();
    const orchestratorDebugState = this.predictionOrchestrator?.getDebugState().predictorConfig;
    const aiPredictorEnabled =
      orchestratorDebugState?.aiPredictorEnabled ?? this.currentConfig?.aiPredictorEnabled ?? false;

    return {
      generatedAtMs: Date.now(),
      config: {
        aiPredictorEnabled,
        aiModelId: orchestratorDebugState?.aiModelId ?? this.currentConfig?.aiModelId ?? "",
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
          ...webllmDebugState,
          enabled: aiPredictorEnabled && webllmDebugState.enabled,
          lastInitProgressLog: webllmDebugState.lastInitProgressLog.slice(),
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
    return this.normalizeTraceId(traceId) ?? `pred-${randomUUID()}`;
  }

  recordTraceTimelineEvent(
    debugMeta: PredictionDebugRequestMeta | undefined,
    stage: string,
    detail?: string,
    timestampMs: number = Date.now(),
  ): string {
    const trace = this.upsertTrace(debugMeta);
    this.appendTimelineEvent(trace, timestampMs, stage.trim() || "event", detail);
    return trace.traceId;
  }

  private recordDebugTrace(
    debugEvent: PredictionDebugEvent,
    debugMeta?: PredictionDebugRequestMeta,
  ): void {
    const trace = this.upsertTrace(debugMeta);

    Object.assign(trace, {
      ...debugEvent,
      presage: { ...debugEvent.presage, predictions: debugEvent.presage.predictions.slice() },
      webllm: { ...debugEvent.webllm, predictions: debugEvent.webllm.predictions.slice() },
      mergedPredictions: debugEvent.mergedPredictions.slice(),
      finalPredictions: debugEvent.finalPredictions.slice(),
    });

    this.appendTimelineEvent(
      trace,
      debugEvent.timestampMs,
      "predictor.debug.snapshot",
      `total=${Math.round(debugEvent.totalDurationMs)}ms final=${debugEvent.finalPredictions.length}`,
    );
  }

  private appendTimelineEvent(
    trace: PredictorDebugTrace,
    timestampMs: number,
    stage: string,
    detail: string | undefined,
  ): void {
    trace.timeline.push({ timestampMs, stage, detail: this.normalizeTimelineDetail(detail) });
    if (trace.timeline.length > MAX_TRACE_TIMELINE_EVENTS) {
      trace.timeline = trace.timeline.slice(trace.timeline.length - MAX_TRACE_TIMELINE_EVENTS);
    }
    this.promoteTrace(trace);
  }

  // traceId arrives in a runtime message payload, so its static type is not guaranteed.
  private normalizeTraceId(traceId: unknown): string | null {
    return typeof traceId === "string" ? traceId.trim() || null : null;
  }

  private resolveDebugMeta(debugMeta?: PredictionDebugRequestMeta): PredictionDebugRequestMeta {
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

    trace.requestId = this.resolveNumericMeta(resolvedDebugMeta.requestId, trace.requestId);
    trace.tabId = this.resolveNumericMeta(resolvedDebugMeta.tabId, trace.tabId);
    trace.frameId = this.resolveNumericMeta(resolvedDebugMeta.frameId, trace.frameId);
    trace.suggestionId = this.resolveNumericMeta(
      resolvedDebugMeta.suggestionId,
      trace.suggestionId,
    );
    return trace;
  }

  private resolveNumericMeta(value: unknown, fallback: number | null): number | null {
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
      totalDurationMs: 0,
      presage: emptyPresageStage,
      webllm: emptyAIPredictorStage,
      mergedPredictions: [],
      finalPredictions: [],
      requestId: typeof debugMeta.requestId === "number" ? debugMeta.requestId : null,
      tabId: typeof debugMeta.tabId === "number" ? debugMeta.tabId : null,
      frameId: typeof debugMeta.frameId === "number" ? debugMeta.frameId : null,
      suggestionId: typeof debugMeta.suggestionId === "number" ? debugMeta.suggestionId : null,
      timeline: [],
    };
  }

  private promoteTrace(trace: PredictorDebugTrace): void {
    const currentIndex = this.debugTraces.findIndex((item) => item.traceId === trace.traceId);
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
