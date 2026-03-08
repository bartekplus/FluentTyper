import type { StorageBackend } from "./StorageBackend.js";

export class LocalStorageBackend implements StorageBackend {
  async get(key: string): Promise<string | undefined> {
    const value = localStorage.getItem(key);
    return value === null ? undefined : value;
  }

  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  async getAll(prefix: string): Promise<Record<string, string>> {
    const values: Record<string, string> = {};
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const fullKey = localStorage.key(i);
      if (fullKey !== null && fullKey.startsWith(prefix)) {
        const value = localStorage.getItem(fullKey);
        if (value !== null) {
          values[fullKey.substring(prefix.length)] = value;
        }
      }
    }
    return values;
  }
}
