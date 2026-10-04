import type { SettingsManager } from "../../src/core/application/settingsManager";

export type MemorySettings = SettingsManager & { store: Record<string, unknown> };

type MemorySettingsOptions = {
  // The first setRaw call throws "write failed".
  failOnce?: boolean;
  // get and set wait for this before they read or write.
  delay?: () => Promise<unknown>;
};

export function memorySettings(
  seed: Record<string, unknown> = {},
  { failOnce = false, delay }: MemorySettingsOptions = {},
): MemorySettings {
  const store = { ...seed };
  return {
    store,
    get: async (key: string) => {
      if (delay) await delay();
      return store[key];
    },
    getRaw: async (key: string) => store[key],
    set: async (key: string, value: unknown) => {
      if (delay) await delay();
      store[key] = value;
    },
    setRaw: async (key: string, value: unknown) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("write failed");
      }
      store[key] = value;
    },
    removeRaw: async (key: string) => {
      delete store[key];
    },
  } as unknown as MemorySettings;
}
