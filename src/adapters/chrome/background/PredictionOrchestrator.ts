import { DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED } from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
import { getErrorMessage } from "@core/domain/error";
import type {
  PredictionDebugEvent,
  PredictionCandidate,
  PredictionResult,
  PredictionRunConfig,
  PredictorStageDebugInfo,
} from "./PredictionTypes";
import type { PresageConfig, PresageHandler, PresagePredictionContext } from "./PresageHandler";

const logger = createLogger("PredictionOrchestrator");

export interface PredictionConfig extends PresageConfig {
  debugPresagePredictorEnabled?: boolean;
}

export type PredictorDebugConfig = Required<Omit<PredictionConfig, keyof PresageConfig>>;

interface PredictionOrchestratorDebugState {
  predictorConfig: PredictorDebugConfig;
}

export class PredictionOrchestrator {
  private readonly presageHandler: PresageHandler;
  private debugPresagePredictorEnabled = DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED;

  constructor(presageHandler: PresageHandler) {
    this.presageHandler = presageHandler;
  }

  setConfig(config: PredictionConfig): void {
    const { debugPresagePredictorEnabled, ...presageConfig } = config;

    this.presageHandler.setConfig(presageConfig);
    this.debugPresagePredictorEnabled =
      typeof debugPresagePredictorEnabled === "boolean"
        ? debugPresagePredictorEnabled
        : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED;
  }

  getDebugState(): PredictionOrchestratorDebugState {
    return {
      predictorConfig: {
        debugPresagePredictorEnabled: this.debugPresagePredictorEnabled,
      },
    };
  }

  async runPrediction(
    text: string,
    nextChar: string,
    lang: string,
    configOverride?: PredictionRunConfig,
    afterCursorTokenSuffix?: string,
  ): Promise<PredictionResult> {
    const startedAt = Date.now();
    const context = this.presageHandler.preparePredictionContext(
      text,
      nextChar,
      lang,
      configOverride?.numSuggestions,
      configOverride?.tabId,
      afterCursorTokenSuffix,
      configOverride?.suppressAutoCapitalize,
    );

    const presageDebug: PredictorStageDebugInfo = {
      enabled: this.debugPresagePredictorEnabled,
      attempted: false,
      durationMs: 0,
      timedOut: false,
      predictions: [],
      skipReason: undefined,
    };

    const canRunPresage =
      context.doPrediction &&
      context.effectiveNumSuggestions > 0 &&
      this.debugPresagePredictorEnabled &&
      this.presageHandler.hasLanguageEngine(lang);

    let presagePredictions: PredictionCandidate[] = [];
    if (canRunPresage) {
      presageDebug.attempted = true;
      const presageStartedAt = Date.now();
      presagePredictions = await this.presageHandler.predictPresage(context);
      presageDebug.durationMs = Date.now() - presageStartedAt;
      presageDebug.predictions = presagePredictions.map(({ text }) => text);
    } else {
      presageDebug.skipReason = this.resolvePresageSkipReason(context);
    }

    const result = this.presageHandler.finalizePrediction(presagePredictions, context);

    this.emitDebugEvent(configOverride?.debugListener, {
      timestampMs: Date.now(),
      text,
      nextChar,
      lang,
      predictionInput: context.predictionInput,
      numSuggestions: context.effectiveNumSuggestions,
      doPrediction: context.doPrediction,
      totalDurationMs: Date.now() - startedAt,
      presage: presageDebug,
      finalPredictions: result.predictions.slice(),
    });

    return result;
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
      logger.warn("Prediction debug listener failed", {
        error: getErrorMessage(error),
      });
    }
  }

  private resolvePresageSkipReason(context: PresagePredictionContext): string {
    if (!this.debugPresagePredictorEnabled) {
      return "disabled_by_debug_toggle";
    }
    if (!this.presageHandler.hasLanguageEngine(context.lang)) {
      return "language_engine_missing";
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
