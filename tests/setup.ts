import { jest } from "bun:test";

type StorageState = Record<string, string>;

const localStorageState: StorageState = {};
const mockLocalStorage = {
  get length(): number {
    return Object.keys(localStorageState).length;
  },
  clear(): void {
    Object.keys(localStorageState).forEach((key) => {
      delete localStorageState[key];
    });
  },
  getItem(key: string): string | null {
    return localStorageState[key] ?? null;
  },
  key(index: number): string | null {
    return Object.keys(localStorageState)[index] ?? null;
  },
  removeItem(key: string): void {
    delete localStorageState[key];
  },
  setItem(key: string, value: string): void {
    localStorageState[key] = value;
  },
};

const mockChrome = {
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    getManifest: jest.fn(() => ({ version: "1.0.0" })),
  },
  commands: {
    onCommand: { addListener: jest.fn() },
  },
  tabs: {
    create: jest.fn(),
    get: jest.fn(),
    sendMessage: jest.fn(),
  },
  storage: {
    local: {
      get: jest.fn((key: string, callback: (result: unknown) => void) => {
        if (typeof key === "string") {
          callback({});
        } else {
          callback({});
        }
      }),
      set: jest.fn(),
      remove: jest.fn(),
    },
    sync: {
      get: jest.fn((key: string, callback: (result: unknown) => void) => {
        if (typeof key === "string") {
          callback({});
        } else {
          callback({});
        }
      }),
      set: jest.fn(),
      remove: jest.fn(),
    },
  },
  i18n: {
    get: jest.fn((key: string) => key),
  },
};
(global as unknown as { chrome: unknown }).chrome = mockChrome;
(global as unknown as { localStorage: unknown }).localStorage = mockLocalStorage;
