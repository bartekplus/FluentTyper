// Handles all settings-related logic for FluentTyper
import { Store } from "./storage/Store.js";
import {
  getAliasesForCanonicalSettingKey,
  resolveCanonicalSettingKey,
} from "@core/domain/contracts/settings";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface Settings {
  get: (key: string) => Promise<JsonValue>;
  set?: (key: string, value: JsonValue) => Promise<void>;
}

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
    const canonicalValue = await this.getRaw(canonicalKey);
    if (typeof canonicalValue !== "undefined") {
      return canonicalValue;
    }

    const aliases = getAliasesForCanonicalSettingKey(canonicalKey);
    for (const alias of aliases) {
      const aliasValue = await this.getRaw(alias);
      if (typeof aliasValue !== "undefined") {
        return aliasValue;
      }
    }

    return canonicalValue as unknown as JsonValue;
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

  async getAll(keys: string[]): Promise<Record<string, JsonValue>> {
    const result: Record<string, JsonValue> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }
}
