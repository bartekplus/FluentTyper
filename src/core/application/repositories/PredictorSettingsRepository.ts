import {
  clampAIPredictionTimeoutMs,
  DEFAULT_AI_MODEL_ID,
  DEFAULT_AI_PREDICTOR_ENABLED,
  DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
  DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
} from "@core/domain/constants";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

interface PredictorSettingsSnapshot {
  aiPredictorEnabled: boolean;
  aiModelId: string;
  aiPredictionTimeoutMs: number;
  debugPresagePredictorEnabled: boolean;
  debugAIPredictorEnabled: boolean;
}

export class PredictorSettingsRepository extends SettingsRepositoryBase {
  async getSnapshot(): Promise<PredictorSettingsSnapshot> {
    const [
      aiPredictorEnabled,
      aiModelId,
      aiPredictionTimeoutMs,
      debugPresagePredictorEnabled,
      debugAIPredictorEnabled,
    ] = await Promise.all([
      this.getField("aiPredictorEnabled"),
      this.getField("aiModelId"),
      this.getField("aiPredictionTimeoutMs"),
      this.getField("debugPresagePredictorEnabled"),
      this.getField("debugAiPredictorEnabled"),
    ]);

    return {
      aiPredictorEnabled:
        typeof aiPredictorEnabled === "boolean" ? aiPredictorEnabled : DEFAULT_AI_PREDICTOR_ENABLED,
      aiModelId:
        typeof aiModelId === "string" && aiModelId.trim().length > 0
          ? aiModelId
          : DEFAULT_AI_MODEL_ID,
      aiPredictionTimeoutMs: clampAIPredictionTimeoutMs(aiPredictionTimeoutMs),
      debugPresagePredictorEnabled:
        typeof debugPresagePredictorEnabled === "boolean"
          ? debugPresagePredictorEnabled
          : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
      debugAIPredictorEnabled:
        typeof debugAIPredictorEnabled === "boolean"
          ? debugAIPredictorEnabled
          : DEFAULT_DEBUG_AI_PREDICTOR_ENABLED,
    };
  }
}
