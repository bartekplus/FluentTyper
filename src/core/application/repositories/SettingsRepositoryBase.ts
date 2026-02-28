import type { JsonValue } from "../settingsManager";
import { SettingsManager } from "../settingsManager";
import {
  getSettingStorageKey,
  SettingField,
  SettingsSchema,
} from "@core/domain/contracts/settings";
import { readSettingWithAliases } from "../settings/SettingsMigrationV3";

export class SettingsRepositoryBase {
  protected readonly settings: SettingsManager;

  constructor(settings?: SettingsManager) {
    this.settings = settings || new SettingsManager();
  }

  protected async getField<K extends SettingField>(
    field: K,
  ): Promise<SettingsSchema[K] | undefined> {
    const value = await readSettingWithAliases(this.settings, field);
    return value as SettingsSchema[K] | undefined;
  }

  protected async setField<K extends SettingField>(
    field: K,
    value: SettingsSchema[K],
  ): Promise<void> {
    await this.settings.set(getSettingStorageKey(field), value as unknown as JsonValue);
  }
}
