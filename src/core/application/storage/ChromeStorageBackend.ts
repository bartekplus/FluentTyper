import type { StorageBackend } from "./StorageBackend.js";

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" ? error : String(error));
}

export class ChromeStorageBackend implements StorageBackend {
  private readonly backend: chrome.storage.StorageArea;

  constructor(useLocalBackend = false) {
    this.backend = useLocalBackend ? chrome.storage.local : chrome.storage.sync;
  }

  async get(key: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      try {
        this.backend.get(key, (value) => {
          resolve(value[key] as string | undefined);
        });
      } catch (ex) {
        reject(toError(ex));
      }
    });
  }

  async set(key: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.backend.set({ [key]: value }, () => {
          const lastError = chrome.runtime?.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve();
        });
      } catch (ex) {
        reject(toError(ex));
      }
    });
  }

  async remove(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.backend.remove(key, () => {
          resolve();
        });
      } catch (ex) {
        reject(toError(ex));
      }
    });
  }

  async getAll(prefix: string): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      try {
        this.backend.get(null, (values) => {
          const result: Record<string, string> = {};
          for (const [key, value] of Object.entries(values)) {
            if (!key.startsWith(prefix)) {
              continue;
            }
            result[key.substring(prefix.length)] = value as string;
          }
          resolve(result);
        });
      } catch (ex) {
        reject(toError(ex));
      }
    });
  }
}
