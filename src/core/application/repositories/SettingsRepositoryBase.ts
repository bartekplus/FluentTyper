import type { JsonValue, SettingsManager } from "../settingsManager";
import {
  getSettingStorageKey,
  type SettingField,
  type SettingsSchema,
} from "@core/domain/contracts/settings";
import { readSettingWithAliases } from "../settings/settingsAccess";

export class SettingsRepositoryBase {
  constructor(protected readonly settings: SettingsManager) {}

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
