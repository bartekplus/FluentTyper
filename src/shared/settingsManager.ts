// Handles all settings-related logic for FluentTyper
import { Store } from "../third_party/fancier-settings/lib/store.js";
import {
  getAliasesForCanonicalSettingKey,
  resolveCanonicalSettingKey,
} from "./contracts/settings";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Settings {
  get: (key: string) => Promise<JsonValue>;
  set?: (key: string, value: JsonValue) => Promise<void>;
}

export class SettingsManager {
  private settings: Store;
  constructor() {
    this.settings = new Store("settings");
  }

  async get(key: string): Promise<JsonValue> {
    const canonicalKey = resolveCanonicalSettingKey(key);
    const canonicalValue = await this.settings.get(canonicalKey);
    if (typeof canonicalValue !== "undefined") {
      return canonicalValue as JsonValue;
    }

    const aliases = getAliasesForCanonicalSettingKey(canonicalKey);
    for (const alias of aliases) {
      const aliasValue = await this.settings.get(alias);
      if (typeof aliasValue !== "undefined") {
        return aliasValue as JsonValue;
      }
    }

    return canonicalValue as unknown as JsonValue;
  }

  async set(key: string, value: JsonValue): Promise<void> {
    const canonicalKey = resolveCanonicalSettingKey(key);
    return this.settings.set(canonicalKey, value);
  }

  async getAll(keys: string[]): Promise<Record<string, JsonValue>> {
    const result: Record<string, JsonValue> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }
}
