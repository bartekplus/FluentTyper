import type { ProductivityStatsState } from "@core/domain/productivityStats/types";
import { SettingsRepositoryBase } from "../repositories/SettingsRepositoryBase";

export class StatsRepository extends SettingsRepositoryBase {
  async loadState(): Promise<unknown> {
    return this.getField("productivityStats");
  }

  async saveState(state: ProductivityStatsState): Promise<void> {
    await this.setField("productivityStats", state as unknown as Record<string, unknown>);
  }
}
