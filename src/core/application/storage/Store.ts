import type { StorageBackend } from "./StorageBackend.js";
import { ChromeStorageBackend } from "./ChromeStorageBackend.js";
import { LocalStorageBackend } from "./LocalStorageBackend.js";
import { getAliasesForCanonicalSettingKey } from "@core/domain/contracts/settings";

function isValidJson(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

export class Store {
  private readonly storageName: string;
  private readonly storageBackend: StorageBackend;
  private readonly initializationPromise: Promise<void>;

  constructor(storageName: string, defaults?: Record<string, unknown>, useLocalBackend = true) {
    this.storageName = storageName;
    this.storageBackend =
      typeof chrome !== "undefined" && chrome.storage
        ? new ChromeStorageBackend(useLocalBackend)
        : new LocalStorageBackend();
    this.initializationPromise = this.initializeDefaults(defaults);
  }

  buildKey(name: string): string {
    return `store.${this.storageName}.${name}`;
  }

  static serializeValue(value: unknown): string | null {
    if (typeof value === "function") {
      return null;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  private async getStoredValue(name: string): Promise<unknown> {
    const value = await this.storageBackend.get(this.buildKey(name));
    try {
      return value === undefined ? undefined : JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private async setStoredValue(name: string, value: unknown): Promise<void> {
    const serialized = Store.serializeValue(value);
    if (serialized !== null) {
      await this.storageBackend.set(this.buildKey(name), serialized);
    }
  }

  private async initializeDefaults(defaults?: Record<string, unknown>): Promise<void> {
    if (defaults === undefined || Object.keys(defaults).length === 0) {
      return;
    }

    const prefix = this.buildKey("");
    const storedValues = await this.storageBackend.getAll(prefix);
    const writes: Promise<void>[] = [];

    for (const [key, value] of Object.entries(defaults)) {
      if (isValidJson(storedValues[key])) {
        continue;
      }
      if (
        storedValues[key] === undefined &&
        getAliasesForCanonicalSettingKey(key).some((aliasKey) =>
          isValidJson(storedValues[aliasKey]),
        )
      ) {
        continue;
      }
      writes.push(this.setStoredValue(key, value));
    }

    await Promise.all(writes);
  }

  async get(name: string): Promise<unknown> {
    await this.initializationPromise;
    return this.getStoredValue(name);
  }

  async set(name: string, value: unknown): Promise<void> {
    await this.initializationPromise;
    if (value === undefined) {
      await this.remove(name);
      return;
    }
    await this.setStoredValue(name, value);
  }

  async remove(name: string): Promise<void> {
    await this.initializationPromise;
    await this.storageBackend.remove(this.buildKey(name));
  }
}
