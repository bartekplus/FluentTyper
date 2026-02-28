import { KEY_PRODUCTIVITY_STATS } from "@core/domain/constants";
import { JsonValue, SettingsManager } from "@core/application/settingsManager";
import { StatsSanitizer } from "@core/domain/productivityStats/StatsSanitizer";
import type { ProductivityStatsState } from "@core/domain/productivityStats/types";

export class StatsRepository {
  constructor(
    private readonly settingsManager: SettingsManager,
    private readonly sanitizer: StatsSanitizer,
  ) {}

  async loadState(): Promise<ProductivityStatsState> {
    const rawState = await this.settingsManager.get(KEY_PRODUCTIVITY_STATS);
    return this.sanitizer.sanitizeStatsState(rawState);
  }

  async saveState(state: ProductivityStatsState): Promise<void> {
    await this.settingsManager.set(
      KEY_PRODUCTIVITY_STATS,
      state as unknown as JsonValue,
    );
  }
}
