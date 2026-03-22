import type { JsonValue, SettingsManager } from "@core/application/settingsManager";
import { getSettingStorageKey } from "@core/domain/contracts/settings";
import type { ProductivityStatsState } from "@core/domain/productivityStats/types";
import { readSettingWithAliases } from "../settings/settingsAccess";

const PRODUCTIVITY_STATS_KEY = getSettingStorageKey("productivityStats");

export class StatsRepository {
  constructor(private readonly settingsManager: SettingsManager) {}

  async loadState(): Promise<unknown> {
    return readSettingWithAliases(this.settingsManager, "productivityStats");
  }

  async saveState(state: ProductivityStatsState): Promise<void> {
    await this.settingsManager.set(PRODUCTIVITY_STATS_KEY, state as unknown as JsonValue);
  }
}
