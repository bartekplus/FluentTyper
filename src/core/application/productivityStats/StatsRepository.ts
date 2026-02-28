import type { JsonValue, SettingsManager } from "@core/application/settingsManager";
import { getSettingStorageKey } from "@core/domain/contracts/settings";
import type { StatsSanitizer } from "@core/domain/productivityStats/StatsSanitizer";
import type { ProductivityStatsState } from "@core/domain/productivityStats/types";
import { readSettingWithAliases } from "../settings/SettingsMigrationV3";

const PRODUCTIVITY_STATS_KEY = getSettingStorageKey("productivityStats");

export class StatsRepository {
  constructor(
    private readonly settingsManager: SettingsManager,
    private readonly sanitizer: StatsSanitizer,
  ) {}

  async loadState(): Promise<ProductivityStatsState> {
    const rawState = await readSettingWithAliases(this.settingsManager, "productivityStats");
    return this.sanitizer.sanitizeStatsState(rawState);
  }

  async saveState(state: ProductivityStatsState): Promise<void> {
    await this.settingsManager.set(PRODUCTIVITY_STATS_KEY, state as unknown as JsonValue);
  }
}
