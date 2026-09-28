import { DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED } from "@core/domain/constants";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

interface PredictorSettingsSnapshot {
  debugPresagePredictorEnabled: boolean;
}

export class PredictorSettingsRepository extends SettingsRepositoryBase {
  async getSnapshot(): Promise<PredictorSettingsSnapshot> {
    const debugPresagePredictorEnabled = await this.getField("debugPresagePredictorEnabled");
    return {
      debugPresagePredictorEnabled:
        typeof debugPresagePredictorEnabled === "boolean"
          ? debugPresagePredictorEnabled
          : DEFAULT_DEBUG_PRESAGE_PREDICTOR_ENABLED,
    };
  }
}
