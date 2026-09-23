import type { StorageBackend } from "./StorageBackend.js";

function callStorage<T, R = void>(
  invoke: (done: (result: T) => void) => void,
  map: (result: T) => R = () => undefined as R,
): Promise<R> {
  return new Promise((resolve, reject) => {
    try {
      invoke((result) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(map(result));
      });
    } catch (ex) {
      reject(ex instanceof Error ? ex : new Error(String(ex)));
    }
  });
}

export class ChromeStorageBackend implements StorageBackend {
  private readonly backend: chrome.storage.StorageArea;

  constructor(useLocalBackend = false) {
    this.backend = useLocalBackend ? chrome.storage.local : chrome.storage.sync;
  }

  async get(key: string): Promise<string | undefined> {
    return callStorage<Record<string, unknown>, string | undefined>(
      (done) => this.backend.get(key, done),
      (value) => value[key] as string | undefined,
    );
  }

  async set(key: string, value: string): Promise<void> {
    return callStorage((done) => this.backend.set({ [key]: value }, () => done(undefined)));
  }

  async remove(key: string): Promise<void> {
    return callStorage((done) => this.backend.remove(key, () => done(undefined)));
  }

  async getAll(prefix: string): Promise<Record<string, string>> {
    return callStorage<Record<string, unknown>, Record<string, string>>(
      (done) => this.backend.get(null, done),
      (values) => {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(values)) {
          if (!key.startsWith(prefix)) {
            continue;
          }
          Object.defineProperty(result, key.substring(prefix.length), {
            configurable: true,
            enumerable: true,
            value: value,
            writable: true,
          });
        }
        return result;
      },
    );
  }
}
