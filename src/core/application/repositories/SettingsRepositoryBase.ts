import type { SettingsManager } from "../settingsManager";
import {
  getSettingStorageKey,
  type SettingField,
  type SettingsSchema,
} from "@core/domain/contracts/settings";

export class SettingsRepositoryBase {
  constructor(protected readonly settings: SettingsManager) {}

  protected async getField<K extends SettingField>(
    field: K,
  ): Promise<SettingsSchema[K] | undefined> {
    // SettingsManager.get also reads the legacy alias keys.
    return (await this.settings.get(getSettingStorageKey(field))) as SettingsSchema[K] | undefined;
  }

  protected async setField<K extends SettingField>(
    field: K,
    value: SettingsSchema[K],
  ): Promise<void> {
    await this.settings.set(getSettingStorageKey(field), value);
  }
}
