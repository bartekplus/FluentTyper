import { Store } from "./storage/Store.js";
import { readFirstDefinedSetting } from "./settings/settingsAccess";
import {
  getAliasesForCanonicalSettingKey,
  resolveCanonicalSettingKey,
} from "@core/domain/contracts/settings";

export class SettingsManager {
  private settings: Store;
  constructor() {
    this.settings = new Store("settings");
  }

  async getRaw(key: string): Promise<unknown> {
    return this.settings.get(key);
  }

  async get(key: string): Promise<unknown> {
    const canonicalKey = resolveCanonicalSettingKey(key);
    return readFirstDefinedSetting(this, [
      canonicalKey,
      ...getAliasesForCanonicalSettingKey(canonicalKey),
    ]);
  }

  async set(key: string, value: unknown): Promise<void> {
    const canonicalKey = resolveCanonicalSettingKey(key);
    return this.settings.set(canonicalKey, value);
  }

  async setRaw(key: string, value: unknown): Promise<void> {
    return this.settings.set(key, value);
  }

  async removeRaw(key: string): Promise<void> {
    return this.settings.remove(key);
  }
}
