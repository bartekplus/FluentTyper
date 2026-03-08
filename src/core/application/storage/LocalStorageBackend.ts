import type { StorageBackend } from "./StorageBackend.js";

export class LocalStorageBackend implements StorageBackend {
  async get(key: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      try {
        const value = localStorage.getItem(key);
        resolve(value === null ? undefined : value);
      } catch (ex) {
        reject(ex);
      }
    });
  }

  async set(key: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        localStorage.setItem(key, value);
        resolve();
      } catch (ex) {
        reject(ex);
      }
    });
  }

  async remove(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        localStorage.removeItem(key);
        resolve();
      } catch (ex) {
        reject(ex);
      }
    });
  }

  async getAll(prefix: string): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      try {
        const values: Record<string, string> = {};
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const fullKey = localStorage.key(i);
          if (fullKey !== null && fullKey.substring(0, prefix.length) === prefix) {
            const value = localStorage.getItem(fullKey);
            if (value !== null) {
              values[fullKey.substring(prefix.length)] = value;
            }
          }
        }
        resolve(values);
      } catch (ex) {
        reject(ex);
      }
    });
  }
}
