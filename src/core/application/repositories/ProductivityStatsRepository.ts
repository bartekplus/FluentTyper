import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

export class ProductivityStatsRepository extends SettingsRepositoryBase {
  async getRawStats(): Promise<unknown> {
    return this.getField("productivityStats");
  }

  async setRawStats(value: unknown): Promise<void> {
    await this.setField(
      "productivityStats",
      value as Record<string, unknown>,
    );
  }
}
