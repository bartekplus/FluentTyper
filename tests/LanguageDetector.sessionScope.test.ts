import { beforeEach, describe, expect, jest, test } from "bun:test";
import { LanguageDetector } from "../src/adapters/chrome/background/LanguageDetector";
import {
  AUTO_LANGUAGE_MAX_SAMPLE_CHARS,
  AUTO_LANGUAGE_MAX_SAMPLE_TOKENS,
} from "../src/core/domain/autoLanguageDetection";

type SettingsState = Record<string, unknown>;
const SESSION_TTL_MS = 5 * 60 * 1000;

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
  const detectLanguage = jest.fn(async (text: string) => {
    const englishMatches =
      text.match(/\b(?:hello|english|steady|paragraph|history|typing|long|cursor)\b/gi)?.length || 0;
    const frenchMatches =
      text.match(/\b(?:bonjour|merci|monde|francais|encore|discussion|phrase|texte)\b/gi)
        ?.length || 0;
    if (frenchMatches > englishMatches) {
      return { languages: [{ language: "fr", percentage: 96 }] };
    }
    return { languages: [{ language: "en", percentage: 96 }] };
  });
  const pageDetectLanguage = jest.fn(async () => null);

  (globalThis as unknown as { chrome: typeof chrome }).chrome = {
    i18n: {
      detectLanguage,
    },
    tabs: {
      detectLanguage: pageDetectLanguage,
    },
  } as unknown as typeof chrome;

  return {
    detector: new LanguageDetector(manager as never),
    settingsState: state,
    settingsManager: manager,
    detectLanguage,
    pageDetectLanguage,
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

  test("sustained french near the cursor overcomes a long english history", async () => {
    const { detector, detectLanguage } = createDetector();
    const longEnglishHistory =
      "hello english paragraph with long cursor history and steady typing " +
      "hello english paragraph with long cursor history and steady typing " +
      "hello english paragraph with long cursor history and steady typing ";

    const initial = await detector.resolveLanguage({
      text: `${longEnglishHistory}hello english paragraph with steady typing `,
      nextChar: "",
      tabId: 13,
      frameId: 0,
      suggestionId: 1,
      runtimeGeneration: 1,
      domainURL: "example.com",
      enabledLanguages: ["en_US", "fr_FR"],
    });
    const firstFrenchObservation = await detector.resolveLanguage({
      text: `${longEnglishHistory}bonjour merci monde francais encore discussion `,
      nextChar: "",
      tabId: 13,
      frameId: 0,
      suggestionId: 1,
      runtimeGeneration: 1,
      domainURL: "example.com",
      enabledLanguages: ["en_US", "fr_FR"],
    });
    const secondFrenchObservation = await detector.resolveLanguage({
      text: `${longEnglishHistory}bonjour merci monde francais encore discussion phrase texte `,
      nextChar: "",
      tabId: 13,
      frameId: 0,
      suggestionId: 1,
      runtimeGeneration: 1,
      domainURL: "example.com",
      enabledLanguages: ["en_US", "fr_FR"],
    });

    expect(initial.language).toBe("en_US");
    expect(firstFrenchObservation.language).toBe("en_US");
    expect(secondFrenchObservation.language).toBe("fr_FR");

    const detectorInputs = detectLanguage.mock.calls.map(([text]) => String(text));
    expect(detectorInputs.every((text) => text.length <= AUTO_LANGUAGE_MAX_SAMPLE_CHARS)).toBe(true);
    expect(
      detectorInputs.every(
        (text) => (text.match(/\p{L}+/gu)?.length || 0) <= AUTO_LANGUAGE_MAX_SAMPLE_TOKENS,
      ),
    ).toBe(true);
    expect(detectorInputs.at(-1)).toBe(
      "bonjour merci monde francais encore discussion phrase texte"
        .split(/\s+/)
        .slice(-AUTO_LANGUAGE_MAX_SAMPLE_TOKENS)
        .join(" ") + " ",
    );
  });

  test("caches page language hints until the runtime or page scope changes", async () => {
    const { detector, pageDetectLanguage } = createDetector();
    pageDetectLanguage.mockResolvedValue("fr");

    const first = await detector.resolveLanguage({
      text: "hi",
      nextChar: "",
      tabId: 14,
      frameId: 0,
      suggestionId: 1,
      runtimeGeneration: 1,
      domainURL: "example.com",
      enabledLanguages: ["en_US", "fr_FR"],
    });
    const repeated = await detector.resolveLanguage({
      text: "hi there",
      nextChar: "",
      tabId: 14,
      frameId: 0,
      suggestionId: 1,
      runtimeGeneration: 1,
      domainURL: "example.com",
      enabledLanguages: ["en_US", "fr_FR"],
    });

    expect(first.language).toBe("fr_FR");
    expect(first.source).toBe("provisional_page");
    expect(repeated.language).toBe("fr_FR");
    expect(repeated.source).toBe("provisional_page");
    expect(pageDetectLanguage).toHaveBeenCalledTimes(1);

    await detector.resolveLanguage({
      text: "hi again",
      nextChar: "",
      tabId: 14,
      frameId: 0,
      suggestionId: 1,
      runtimeGeneration: 2,
      domainURL: "example.com",
      enabledLanguages: ["en_US", "fr_FR"],
    });
    expect(pageDetectLanguage).toHaveBeenCalledTimes(2);

    await detector.resolveLanguage({
      text: "hi once more",
      nextChar: "",
      tabId: 14,
      frameId: 0,
      suggestionId: 1,
      runtimeGeneration: 2,
      domainURL: "other.example",
      enabledLanguages: ["en_US", "fr_FR"],
    });
    expect(pageDetectLanguage).toHaveBeenCalledTimes(3);
  });

  test("stale-session pruning persists a soft site prior and clears stale live state", async () => {
    const { detector, settingsState } = createDetector();
    const nowSpy = jest.spyOn(Date, "now");
    let now = 10_000;
    nowSpy.mockImplementation(() => now);

    try {
      await detector.resolveLanguage({
        text: "bonjour merci monde francais encore discussion phrase texte ",
        nextChar: "",
        tabId: 21,
        frameId: 0,
        suggestionId: 1,
        runtimeGeneration: 1,
        domainURL: "example.com",
        enabledLanguages: ["en_US", "fr_FR"],
      });

      expect(
        await detector.getRecentSessionStatusForScope({
          tabId: 21,
          domainURL: "example.com",
        }),
      ).toEqual(
        expect.objectContaining({
          language: "fr_FR",
          frameId: 0,
          domain: "example.com",
        }),
      );

      now += SESSION_TTL_MS + 1;

      expect(
        await detector.getRecentSessionStatusForScope({
          tabId: 21,
          domainURL: "example.com",
        }),
      ).toBeNull();
      expect(
        await detector.getLiveRuntimeStatus({
          tabId: 21,
          domainURL: "example.com",
        }),
      ).toBeNull();
      expect(settingsState.autoLanguageSitePriors).toEqual({
        "example.com": {
          fr_FR: expect.any(Number),
        },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("revisit uses a pruned soft prior provisionally but stronger fresh evidence overrides it", async () => {
    const { detector, settingsState } = createDetector();
    const nowSpy = jest.spyOn(Date, "now");
    let now = 20_000;
    nowSpy.mockImplementation(() => now);

    try {
      await detector.resolveLanguage({
        text: "bonjour merci monde francais encore discussion phrase texte ",
        nextChar: "",
        tabId: 31,
        frameId: 0,
        suggestionId: 1,
        runtimeGeneration: 1,
        domainURL: "example.com",
        enabledLanguages: ["en_US", "fr_FR"],
      });

      now += SESSION_TTL_MS + 1;
      await detector.getRecentSessionStatusForScope({
        tabId: 31,
        domainURL: "example.com",
      });

      expect(settingsState.autoLanguageSitePriors).toEqual({
        "example.com": {
          fr_FR: expect.any(Number),
        },
      });

      const provisionalRevisit = await detector.resolveLanguage({
        text: "hi",
        nextChar: "",
        tabId: 32,
        frameId: 0,
        suggestionId: 1,
        runtimeGeneration: 1,
        domainURL: "example.com",
        enabledLanguages: ["en_US", "fr_FR"],
      });
      expect(provisionalRevisit.language).toBe("fr_FR");
      expect(provisionalRevisit.source).toBe("provisional_site_prior");

      const strongEnglishRevisit = await detector.resolveLanguage({
        text: "hello english paragraph with long cursor history and steady typing ",
        nextChar: "",
        tabId: 32,
        frameId: 0,
        suggestionId: 1,
        runtimeGeneration: 1,
        domainURL: "example.com",
        enabledLanguages: ["en_US", "fr_FR"],
      });
      expect(strongEnglishRevisit.language).toBe("en_US");
      expect(strongEnglishRevisit.source).toBe("detection");
    } finally {
      nowSpy.mockRestore();
    }
  });
});
