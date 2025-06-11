// Handles all settings-related logic for FluentTyper
import { Store } from "../third_party/fancier-settings/lib/store.js";

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
    return this.settings.get(key);
  }

  async set(key: string, value: JsonValue): Promise<unknown> {
    return this.settings.set(key, value);
  }

  async getAll(keys: string[]): Promise<Record<string, JsonValue>> {
    const result: Record<string, JsonValue> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }
}
