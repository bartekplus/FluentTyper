import { jest } from "@jest/globals";

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
    },
  },
  i18n: {
    get: jest.fn((key: string) => key),
  },
};
(global as unknown as { chrome: unknown }).chrome = mockChrome;
