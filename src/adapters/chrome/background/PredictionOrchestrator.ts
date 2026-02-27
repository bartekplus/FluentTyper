import {
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_PREDICTION_TIMEOUT_MS,
  DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
  DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
} from "@core/domain/constants";
import { getErrorMessage } from "@core/domain/error";
import type {
  AIPredictorStageDebugInfo,
  PredictionDebugEvent,
  PredictionResult,
  PredictionRunConfig,
  PredictorStageDebugInfo,
  SecondaryPredictor,
} from "./PredictionTypes";
import {
  PresageHandler,
} from "./PresageHandler";
import type { PresageConfig, PresagePredictionContext } from "./PresageHandler";
import { mergePredictions } from "./PredictionMerger";

function clampAIPredictionTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AI_PREDICTION_TIMEOUT_MS;
  }
  return Math.min(2000, Math.max(20, Math.round(value)));
}

interface AIPredictionResult {
  predictions: string[];
  durationMs: number;
  timedOut: boolean;
}

export interface PredictionConfig extends PresageConfig {
  aiPredictorEnabled?: boolean;
  aiModelId?: string;
  aiPredictionTimeoutMs?: number;
  debugPresagePredictorEnabled?: boolean;
  debugAIPredictorEnabled?: boolean;
}

export interface PredictionOrchestratorDebugState {
  predictorConfig: {
    aiPredictorEnabled: boolean;
    aiModelId: string;
    aiPredictionTimeoutMs: number;
    debugPresagePredictorEnabled: boolean;
    debugAIPredictorEnabled: boolean;
  };
}

export class PredictionOrchestrator {
  private readonly presageHandler: PresageHandler;
  private readonly aiPredictor: SecondaryPredictor | null;
  private aiPredictorEnabled = false;
  private aiModelId = DEFAULT_AI_MODEL_ID;
  private aiPredictionTimeoutMs = DEFAULT_AI_PREDICTION_TIMEOUT_MS;
  private debugPresagePredictorEnabled =
    DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED;
  private debugAIPredictorEnabled = DEFAULT_DEBUG_AI_PREDICTOR_ENABLED;

  constructor(
    presageHandler: PresageHandler,
    aiPredictor?: SecondaryPredictor,
  ) {
    this.presageHandler = presageHandler;
    this.aiPredictor = aiPredictor || null;
  }

  setConfig(config: PredictionConfig): void {
    const {
      aiPredictorEnabled,
      aiModelId,
      aiPredictionTimeoutMs,
      debugPresagePredictorEnabled,
      debugAIPredictorEnabled,
      ...presageConfig
    } = config;

    this.presageHandler.setConfig(presageConfig);
    this.aiPredictorEnabled = aiPredictorEnabled ?? false;
    this.aiModelId =
      typeof aiModelId === "string" && aiModelId.trim().length > 0
        ? aiModelId
        : DEFAULT_AI_MODEL_ID;
    this.aiPredictionTimeoutMs = clampAIPredictionTimeoutMs(
      aiPredictionTimeoutMs,
    );
    this.debugPresagePredictorEnabled =
      typeof debugPresagePredictorEnabled === "boolean"
        ? debugPresagePredictorEnabled
        : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED;
    this.debugAIPredictorEnabled =
      typeof debugAIPredictorEnabled === "boolean"
        ? debugAIPredictorEnabled
        : DEFAULT_DEBUG_AI_PREDICTOR_ENABLED;

    this.aiPredictor?.setConfig({
      enabled: this.aiPredictorEnabled,
      modelId: this.aiModelId,
    });
    if (this.aiPredictorEnabled && this.aiPredictor?.preload) {
      void this.aiPredictor.preload();
    }
  }

  getDebugState(): PredictionOrchestratorDebugState {
    return {
      predictorConfig: {
        aiPredictorEnabled: this.aiPredictorEnabled,
        aiModelId: this.aiModelId,
        aiPredictionTimeoutMs: this.aiPredictionTimeoutMs,
        debugPresagePredictorEnabled: this.debugPresagePredictorEnabled,
        debugAIPredictorEnabled: this.debugAIPredictorEnabled,
      },
    };
  }

  async runPrediction(
    text: string,
    nextChar: string,
    lang: string,
    configOverride?: PredictionRunConfig,
  ): Promise<PredictionResult> {
    const startedAt = Date.now();
    const context = this.presageHandler.preparePredictionContext(
      text,
      nextChar,
      lang,
      configOverride?.numSuggestions,
    );

    const presageDebug: PredictorStageDebugInfo = {
      enabled: this.debugPresagePredictorEnabled,
      attempted: false,
      durationMs: 0,
      timedOut: false,
      predictions: [],
      skipReason: undefined,
    };
    const aiDebug: AIPredictorStageDebugInfo = {
      enabled: this.aiPredictorEnabled && this.debugAIPredictorEnabled,
      attempted: false,
      durationMs: 0,
      timedOut: false,
      predictions: [],
      skipReason: undefined,
      modelId: this.aiModelId,
    };

    const canRunPredictionBase =
      !context.forceReplace &&
      context.doPrediction &&
      context.effectiveNumSuggestions > 0;

    const canRunPresage =
      canRunPredictionBase &&
      this.debugPresagePredictorEnabled &&
      this.presageHandler.hasLanguageEngine(lang);

    const canRunAI =
      canRunPredictionBase &&
      this.debugAIPredictorEnabled &&
      this.aiPredictorEnabled &&
      this.aiPredictor !== null;

    let aiPromise: Promise<AIPredictionResult> | null = null;
    if (canRunAI) {
      aiDebug.attempted = true;
      aiPromise = this.runAIPredictionWithTimeout(
        lang,
        context.predictionInput,
        context.effectiveNumSuggestions,
      );
    } else {
      aiDebug.skipReason = this.resolveAISkipReason(context);
    }

    let presagePredictions: string[] = [];
    if (canRunPresage) {
      presageDebug.attempted = true;
      const presageStartedAt = Date.now();
      presagePredictions = this.presageHandler.predictPresage(context);
      presageDebug.durationMs = Date.now() - presageStartedAt;
      presageDebug.predictions = presagePredictions.slice();
    } else {
      presageDebug.skipReason = this.resolvePresageSkipReason(context);
    }

    if (!aiPromise) {
      const result = this.presageHandler.finalizePrediction(
        presagePredictions,
        context,
      );
      this.emitDebugEvent(configOverride?.debugListener, {
        timestampMs: Date.now(),
        text,
        nextChar,
        lang,
        predictionInput: context.predictionInput,
        numSuggestions: context.effectiveNumSuggestions,
        doPrediction: context.doPrediction,
        forceReplace: Boolean(context.forceReplace),
        totalDurationMs: Date.now() - startedAt,
        presage: presageDebug,
        webllm: aiDebug,
        mergedPredictions: presagePredictions.slice(),
        finalPredictions: result.predictions.slice(),
      });
      return result;
    }

    let aiResult: AIPredictionResult;
    try {
      aiResult = await aiPromise;
    } catch {
      aiResult = {
        predictions: [],
        durationMs: 0,
        timedOut: false,
      };
    }

    aiDebug.durationMs = aiResult.durationMs;
    aiDebug.timedOut = aiResult.timedOut;
    aiDebug.predictions = aiResult.predictions.slice();

    const mergedPredictions = mergePredictions(
      presagePredictions,
      aiResult.predictions,
      context.effectiveNumSuggestions,
    );

    const result = this.presageHandler.finalizePrediction(
      mergedPredictions,
      context,
    );

    this.emitDebugEvent(configOverride?.debugListener, {
      timestampMs: Date.now(),
      text,
      nextChar,
      lang,
      predictionInput: context.predictionInput,
      numSuggestions: context.effectiveNumSuggestions,
      doPrediction: context.doPrediction,
      forceReplace: Boolean(context.forceReplace),
      totalDurationMs: Date.now() - startedAt,
      presage: presageDebug,
      webllm: aiDebug,
      mergedPredictions: mergedPredictions.slice(),
      finalPredictions: result.predictions.slice(),
    });

    return result;
  }

  private async runAIPredictionWithTimeout(
    lang: string,
    predictionInput: string,
    numSuggestions: number,
  ): Promise<AIPredictionResult> {
    if (!this.aiPredictor) {
      return {
        predictions: [],
        durationMs: 0,
        timedOut: false,
      };
    }

    this.aiPredictor.interruptActiveGeneration?.("newer_request");

    const startedAt = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<{
      predictions: string[];
      timedOut: boolean;
    }>((resolve) => {
      timeoutId = setTimeout(() => {
        this.interruptAIPrediction("timeout", {
          lang,
          predictionInput,
        });
        resolve({
          predictions: [],
          timedOut: true,
        });
      }, this.aiPredictionTimeoutMs);
    });

    const predictionPromise = this.aiPredictor
      .predict({
        lang,
        predictionInput,
        numSuggestions,
      })
      .then((predictions) => ({
        predictions,
        timedOut: false,
      }))
      .catch(() => ({
        predictions: [],
        timedOut: false,
      }));

    const result = await Promise.race([predictionPromise, timeoutPromise]);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    return {
      predictions: result.predictions,
      durationMs: Date.now() - startedAt,
      timedOut: result.timedOut,
    };
  }

  private interruptAIPrediction(
    reason: string,
    expectedRequest?: {
      lang: string;
      predictionInput: string;
    },
  ): void {
    if (!this.aiPredictor?.interruptActiveGeneration) {
      return;
    }
    try {
      this.aiPredictor.interruptActiveGeneration(reason, expectedRequest);
    } catch (error) {
      console.warn(
        "Failed to interrupt WebLLM generation:",
        getErrorMessage(error),
      );
    }
  }

  private emitDebugEvent(
    debugListener: ((debugEvent: PredictionDebugEvent) => void) | undefined,
    debugEvent: PredictionDebugEvent,
  ): void {
    if (!debugListener) {
      return;
    }
    try {
      debugListener(debugEvent);
    } catch (error) {
      console.warn("Prediction debug listener failed:", getErrorMessage(error));
    }
  }

  private resolvePresageSkipReason(context: PresagePredictionContext): string {
    if (!this.debugPresagePredictorEnabled) {
      return "disabled_by_debug_toggle";
    }
    if (!this.presageHandler.hasLanguageEngine(context.lang)) {
      return "language_engine_missing";
    }
    if (context.forceReplace) {
      return "blocked_by_spacing_rule";
    }
    if (!context.doPrediction) {
      return "input_not_predictable";
    }
    if (context.effectiveNumSuggestions <= 0) {
      return "num_suggestions_zero";
    }
    return "unknown";
  }

  private resolveAISkipReason(context: PresagePredictionContext): string {
    if (!this.aiPredictorEnabled) {
      return "disabled_in_settings";
    }
    if (!this.debugAIPredictorEnabled) {
      return "disabled_by_debug_toggle";
    }
    if (!this.aiPredictor) {
      return "predictor_unavailable";
    }
    if (context.forceReplace) {
      return "blocked_by_spacing_rule";
    }
    if (!context.doPrediction) {
      return "input_not_predictable";
    }
    if (context.effectiveNumSuggestions <= 0) {
      return "num_suggestions_zero";
    }
    return "unknown";
  }
}
