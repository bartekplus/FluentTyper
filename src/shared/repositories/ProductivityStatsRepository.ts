import { KEY_PRODUCTIVITY_STATS } from "../constants";
import type { JsonValue } from "../settingsManager";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

export class ProductivityStatsRepository extends SettingsRepositoryBase {
  async getRawStats(): Promise<unknown> {
    return this.getRawSettingsManager().get(KEY_PRODUCTIVITY_STATS);
  }

  async setRawStats(value: unknown): Promise<void> {
    await this.getRawSettingsManager().set(
      KEY_PRODUCTIVITY_STATS,
      value as JsonValue,
    );
  }
}
