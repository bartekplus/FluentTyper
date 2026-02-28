import { SettingsManager } from "@core/application/settingsManager";
import { StatsSanitizer } from "@core/domain/productivityStats/StatsSanitizer";
import type { ProductivityStatsState } from "@core/domain/productivityStats/types";
import { ProductivityStatsRepository } from "../repositories/ProductivityStatsRepository";

export class StatsRepository {
  private readonly statsRepository: ProductivityStatsRepository;

  constructor(
    settingsManager: SettingsManager,
    private readonly sanitizer: StatsSanitizer,
  ) {
    this.statsRepository = new ProductivityStatsRepository(settingsManager);
  }

  async loadState(): Promise<ProductivityStatsState> {
    const rawState = await this.statsRepository.getRawStats();
    return this.sanitizer.sanitizeStatsState(rawState);
  }

  async saveState(state: ProductivityStatsState): Promise<void> {
    await this.statsRepository.setRawStats(state);
  }
}
