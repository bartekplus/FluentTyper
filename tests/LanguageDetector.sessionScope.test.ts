import { beforeEach, describe, expect, jest, test } from "bun:test";
import { LanguageDetector } from "../src/adapters/chrome/background/LanguageDetector";

type SettingsState = Record<string, unknown>;

function createSettingsManager(initialState: Partial<SettingsState> = {}) {
  const state: SettingsState = {
    fallbackLanguage: "en_US",
    enabledLanguages: ["en_US", "fr_FR"],
    autoLanguageSitePriors: {},
    ...initialState,
  };

  return {
    state,
    manager: {
      get: jest.fn(async (key: string) => state[key]),
      set: jest.fn(async (key: string, value: unknown) => {
        state[key] = value;
      }),
    },
  };
}

function createDetector(initialState: Partial<SettingsState> = {}) {
  const { manager, state } = createSettingsManager(initialState);

  (globalThis as unknown as { chrome: typeof chrome }).chrome = {
    i18n: {
      detectLanguage: jest.fn(async (text: string) => {
        if (text.includes("bonjour")) {
          return { languages: [{ language: "fr", percentage: 96 }] };
        }
        return { languages: [{ language: "en", percentage: 96 }] };
      }),
    },
    tabs: {
      detectLanguage: jest.fn(async () => null),
    },
  } as unknown as typeof chrome;

  return {
    detector: new LanguageDetector(manager as never),
    settingsState: state,
    settingsManager: manager,
  };
}

describe("LanguageDetector live session scoping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("same-tab navigation cannot reuse a previous page session", async () => {
    const { detector, settingsManager } = createDetector();

    await detector.resolveLanguage({
      text: "bonjour tout le monde merci encore aujourd'hui",
      nextChar: "",
      tabId: 11,
      frameId: 0,
      suggestionId: 1,
      runtimeGeneration: 1,
      domainURL: "old.example",
      enabledLanguages: ["en_US", "fr_FR"],
    });

    detector.reportRuntimeActivity({
      tabId: 11,
      frameId: 0,
      runtimeGeneration: 2,
      domainURL: "new.example",
    });

    expect(
      await detector.getRecentSessionStatusForScope({
        tabId: 11,
        domainURL: "new.example",
      }),
    ).toBeNull();

    expect(
      await detector.cycleManualLockForScope({
        tabId: 11,
        domainURL: "new.example",
      }),
    ).toBeNull();

    expect(settingsManager.set).not.toHaveBeenCalledWith(
      "autoLanguageSitePriors",
      expect.anything(),
    );
  });

  test("only the active frame runtime is affected in a multi-frame tab", async () => {
    const { detector, settingsState } = createDetector();

    await detector.resolveLanguage({
      text: "hello this is a longer english paragraph for stable detection",
      nextChar: "",
      tabId: 12,
      frameId: 0,
      suggestionId: 1,
      runtimeGeneration: 1,
      domainURL: "example.com",
      enabledLanguages: ["en_US", "fr_FR"],
    });
    detector.reportRuntimeActivity({
      tabId: 12,
      frameId: 0,
      runtimeGeneration: 1,
      domainURL: "example.com",
    });

    await detector.resolveLanguage({
      text: "bonjour tout le monde merci encore pour cette discussion",
      nextChar: "",
      tabId: 12,
      frameId: 3,
      suggestionId: 1,
      runtimeGeneration: 4,
      domainURL: "example.com",
      enabledLanguages: ["en_US", "fr_FR"],
    });
    detector.reportRuntimeActivity({
      tabId: 12,
      frameId: 3,
      runtimeGeneration: 4,
      domainURL: "example.com",
    });

    const activeFrameStatus = await detector.getRecentSessionStatusForScope({
      tabId: 12,
      domainURL: "example.com",
    });
    expect(activeFrameStatus?.frameId).toBe(3);
    expect(activeFrameStatus?.language).toBe("fr_FR");

    const lockedStatus = await detector.cycleManualLockForScope({
      tabId: 12,
      domainURL: "example.com",
    });
    expect(lockedStatus?.frameId).toBe(3);
    expect(lockedStatus?.language).toBe("en_US");

    detector.reportRuntimeActivity({
      tabId: 12,
      frameId: 0,
      runtimeGeneration: 1,
      domainURL: "example.com",
    });

    const restoredFrameStatus = await detector.getRecentSessionStatusForScope({
      tabId: 12,
      domainURL: "example.com",
    });
    expect(restoredFrameStatus?.frameId).toBe(0);
    expect(restoredFrameStatus?.language).toBe("en_US");
    expect(settingsState.autoLanguageSitePriors).toEqual({
      "example.com": {
        en_US: expect.any(Number),
      },
    });
  });
});
