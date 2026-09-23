import { Store } from "./storage/Store.js";
import { readFirstDefinedSetting } from "./settings/settingsAccess";
import {
  getAliasesForCanonicalSettingKey,
  resolveCanonicalSettingKey,
} from "@core/domain/contracts/settings";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export class SettingsManager {
  private settings: Store;
  constructor() {
    this.settings = new Store("settings");
  }

  async getRaw(key: string): Promise<JsonValue | undefined> {
    const value = await this.settings.get(key);
    return value as JsonValue | undefined;
  }

  async get(key: string): Promise<JsonValue> {
    const canonicalKey = resolveCanonicalSettingKey(key);
    return (await readFirstDefinedSetting(this, [
      canonicalKey,
      ...getAliasesForCanonicalSettingKey(canonicalKey),
    ])) as JsonValue;
  }

  async set(key: string, value: JsonValue): Promise<void> {
    const canonicalKey = resolveCanonicalSettingKey(key);
    return this.settings.set(canonicalKey, value);
  }

  async setRaw(key: string, value: JsonValue): Promise<void> {
    return this.settings.set(key, value);
  }

  async removeRaw(key: string): Promise<void> {
    return this.settings.remove(key);
  }
}
