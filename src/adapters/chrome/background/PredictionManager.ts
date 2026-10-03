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
  PredictionDebugEvent,
  PredictionResult,
  PredictionRunConfig,
  PredictionConfigOverride,
  PredictorStageDebugInfo,
} from "./PredictionTypes";
import libPresageMod from "@third-party/libpresage/libpresage.js";
import { createLogger } from "@core/application/logging/Logger";
import { PredictorError, getErrorMessage } from "@core/domain/error";
import type { PersonalizationRankingSnapshot } from "@core/domain/personalization/types";

interface PredictionManagerOptions {
  getPersonalizationSnapshot?: () => PersonalizationRankingSnapshot;
  /** Development builds only: keep text-bearing debug traces. Production keeps no text. */
  isDevBuild?: boolean;
  /** Presage engine loader; tests pass a fake engine. */
  loadPresage?: () => Promise<PresageModule>;
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
  private initializationPromise: Promise<void> | null = null;
  private initializationFailed = false;
  // Map insertion order is the recency order: the most recent trace is last.
  private readonly debugTraces = new Map<string, PredictorDebugTrace>();
  private currentConfig: PredictionConfig | null = null;
  private readonly getPersonalizationSnapshot: () => PersonalizationRankingSnapshot;
  private readonly isDevBuild: boolean;

  constructor(options: PredictionManagerOptions = {}) {
    this.libPresageMod = options.loadPresage ?? (libPresageMod as () => Promise<PresageModule>);
    this.getPersonalizationSnapshot = options.getPersonalizationSnapshot ?? (() => ({}));
    this.isDevBuild = options.isDevBuild ?? false;
    void this.initialize().catch(() => undefined);
  }

  async initialize(retry = false): Promise<void> {
    if (retry && this.initializationFailed) {
      this.initializationPromise = null;
      this.initializationFailed = false;
    }
    this.initializationPromise ??= this._doInitializePresage().catch((error: unknown) => {
      this.initializationFailed = true;
      throw error;
    });
    return this.initializationPromise;
  }

  private async _doInitializePresage(): Promise<void> {
    try {
      const Module = await this.libPresageMod();
      this.presageHandler = new PresageHandler(Module, {
        getPersonalizationSnapshot: this.getPersonalizationSnapshot,
      });
      this.predictionOrchestrator = new PredictionOrchestrator(this.presageHandler);
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
    await this.initialize(true);
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
      debugPresagePredictorEnabled: config.debugPresagePredictorEnabled,
    });
    if (!this.predictionOrchestrator) {
      throw new PredictorError("Prediction orchestrator not initialized", {
        code: "predictor_orchestrator_missing",
      });
    }
    this.predictionOrchestrator.setConfig(config);
  }

  getPredictorDebugSnapshot(): PredictorDebugSnapshot {
    const presageDebugState = this.presageHandler?.getDebugState();
    const orchestratorDebugState = this.predictionOrchestrator?.getDebugState().predictorConfig;

    return {
      generatedAtMs: Date.now(),
      config: {
        debugPresagePredictorEnabled:
          orchestratorDebugState?.debugPresagePredictorEnabled ??
          this.currentConfig?.debugPresagePredictorEnabled ??
          true,
      },
      runtime: {
        presage: {
          languageEngineCount: presageDebugState?.languageEngineCount ?? 0,
        },
      },
      traces: [...this.debugTraces.values()].reverse().map((trace) => ({
        ...trace,
        presage: {
          ...trace.presage,
          predictions: trace.presage.predictions.slice(),
        },
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
    if (!this.isDevBuild) {
      return this.ensureTraceId(debugMeta?.traceId);
    }
    const trace = this.upsertTrace(debugMeta);
    this.appendTimelineEvent(trace, timestampMs, stage.trim() || "event", detail);
    return trace.traceId;
  }

  private recordDebugTrace(
    debugEvent: PredictionDebugEvent,
    debugMeta?: PredictionDebugRequestMeta,
  ): void {
    // Traces hold typed text; production keeps none.
    if (!this.isDevBuild) {
      return;
    }
    const trace = this.upsertTrace(debugMeta);

    Object.assign(trace, {
      ...debugEvent,
      presage: { ...debugEvent.presage, predictions: debugEvent.presage.predictions.slice() },
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

    let trace = this.debugTraces.get(traceId);
    if (!trace) {
      trace = this.createEmptyTrace(traceId, resolvedDebugMeta);
      this.promoteTrace(trace);
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
      predictions: [],
      skipReason: undefined,
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
      finalPredictions: [],
      requestId: typeof debugMeta.requestId === "number" ? debugMeta.requestId : null,
      tabId: typeof debugMeta.tabId === "number" ? debugMeta.tabId : null,
      frameId: typeof debugMeta.frameId === "number" ? debugMeta.frameId : null,
      suggestionId: typeof debugMeta.suggestionId === "number" ? debugMeta.suggestionId : null,
      timeline: [],
    };
  }

  private promoteTrace(trace: PredictorDebugTrace): void {
    this.debugTraces.delete(trace.traceId);
    this.debugTraces.set(trace.traceId, trace);
    for (const traceId of this.debugTraces.keys()) {
      if (this.debugTraces.size <= MAX_DEBUG_TRACES) {
        break;
      }
      this.debugTraces.delete(traceId);
    }
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
