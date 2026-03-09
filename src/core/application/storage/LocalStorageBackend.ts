import type { StorageBackend } from "./StorageBackend.js";

export class LocalStorageBackend implements StorageBackend {
  get(key: string): Promise<string | undefined> {
    const value = localStorage.getItem(key);
    return Promise.resolve(value === null ? undefined : value);
  }

  set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    localStorage.removeItem(key);
    return Promise.resolve();
  }

  getAll(prefix: string): Promise<Record<string, string>> {
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
    return Promise.resolve(values);
  }
}
