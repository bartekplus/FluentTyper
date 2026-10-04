import { jest } from "bun:test";

type StorageSnapshot = Record<string, string>;
type ChromeStorageMockOptions = {
  initialState?: StorageSnapshot;
  setDelayMs?: number;
  getError?: string;
  removeError?: string;
};

// Replaces globalThis.chrome with an async chrome.storage fake. The caller restores chrome.
export function installChromeStorageMock(options: ChromeStorageMockOptions = {}) {
  const { initialState = {}, setDelayMs = 0, getError, removeError } = options;
  const storageState: StorageSnapshot = { ...initialState };
  const runtime: {
    getManifest: () => { version: string };
    lastError?: { message: string };
  } = {
    getManifest: () => ({ version: "test-version" }),
  };
  const localSet = jest.fn(
    (values: Record<string, string>, callback?: (() => void) | undefined): void => {
      setTimeout(() => {
        Object.assign(storageState, values);
        callback?.();
      }, setDelayMs);
    },
  );

  const localGet = (
    key: string | string[] | null,
    callback: (result: Record<string, string>) => void,
  ): void => {
    setTimeout(() => {
      if (getError) {
        runtime.lastError = { message: getError };
        callback({});
        delete runtime.lastError;
        return;
      }
      if (typeof key === "string") {
        callback({ [key]: storageState[key] });
        return;
      }
      if (Array.isArray(key)) {
        const result: Record<string, string> = {};
        key.forEach((entry) => {
          if (storageState[entry] !== undefined) {
            result[entry] = storageState[entry];
          }
        });
        callback(result);
        return;
      }
      callback({ ...storageState });
    }, 0);
  };

  const localRemove = (key: string, callback?: (() => void) | undefined): void => {
    setTimeout(() => {
      if (removeError) {
        runtime.lastError = { message: removeError };
        callback?.();
        delete runtime.lastError;
        return;
      }
      delete storageState[key];
      callback?.();
    }, 0);
  };

  const area = { get: localGet, set: localSet, remove: localRemove };
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    writable: true,
    value: {
      runtime,
      i18n: { getMessage: (key: string) => key },
      storage: { local: area, sync: area },
    },
  });

  return { storageState, localSet };
}
