import { afterEach, describe, expect, jest, setSystemTime, spyOn, test } from "bun:test";
import {
  AUTO_LANGUAGE_MAX_SAMPLE_CHARS,
  AUTO_LANGUAGE_MAX_SAMPLE_TOKENS,
} from "../src/core/domain/autoLanguageDetection";
import { LanguageDetector } from "../src/adapters/chrome/background/LanguageDetector";
import { memorySettings } from "./support/fakeSettings";

const SESSION_TTL_MS = 5 * 60 * 1000;
const baseChrome = (globalThis as unknown as { chrome: unknown }).chrome;

function createDetector() {
  const settingsManager = memorySettings({
    fallbackLanguage: "en_US",
    enabledLanguages: ["en_US", "fr_FR"],
    autoLanguageSitePriors: {},
  });
  const detectLanguage = jest.fn(async (text: string) => {
    const englishMatches =
      text.match(/\b(?:hello|english|steady|paragraph|history|typing|long|cursor)\b/gi)?.length ||
      0;
    const frenchMatches =
      text.match(/\b(?:bonjour|merci|monde|francais|encore|discussion|phrase|texte)\b/gi)?.length ||
      0;
    if (frenchMatches > englishMatches) {
      return { languages: [{ language: "fr", percentage: 96 }] };
    }
    return { languages: [{ language: "en", percentage: 96 }] };
  });
  const pageDetectLanguage = jest.fn(async (): Promise<string | null> => null);

  (globalThis as unknown as { chrome: typeof chrome }).chrome = {
    i18n: {
      detectLanguage,
    },
    tabs: {
      detectLanguage: pageDetectLanguage,
    },
  } as unknown as typeof chrome;

  return {
    detector: new LanguageDetector(settingsManager),
    settingsState: settingsManager.store,
    settingsManager,
    detectLanguage,
    pageDetectLanguage,
  };
}

function resolve(
  detector: LanguageDetector,
  text: string,
  {
    tabId,
    frameId = 0,
    runtimeGeneration = 1,
    domainURL = "example.com",
  }: { tabId: number; frameId?: number; runtimeGeneration?: number; domainURL?: string },
) {
  return detector.resolveLanguage({
    text,
    nextChar: "",
    tabId,
    frameId,
    suggestionId: 1,
    runtimeGeneration,
    domainURL,
    enabledLanguages: ["en_US", "fr_FR"],
  });
}

describe("LanguageDetector live session scoping", () => {
  afterEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = baseChrome;
    setSystemTime();
  });

  test("same-tab navigation cannot reuse a previous page session", async () => {
    const { detector, settingsManager } = createDetector();
    const setSpy = spyOn(settingsManager, "set");

    await resolve(detector, "bonjour tout le monde merci encore aujourd'hui", {
      tabId: 11,
      domainURL: "old.example",
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

    expect(setSpy).not.toHaveBeenCalledWith("autoLanguageSitePriors", expect.anything());
  });

  test("only the active frame runtime is affected in a multi-frame tab", async () => {
    const { detector, settingsState } = createDetector();

    await resolve(detector, "hello this is a longer english paragraph for stable detection", {
      tabId: 12,
    });
    detector.reportRuntimeActivity({
      tabId: 12,
      frameId: 0,
      runtimeGeneration: 1,
      domainURL: "example.com",
    });

    await resolve(detector, "bonjour tout le monde merci encore pour cette discussion", {
      tabId: 12,
      frameId: 3,
      runtimeGeneration: 4,
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

    const initial = await resolve(
      detector,
      `${longEnglishHistory}hello english paragraph with steady typing `,
      { tabId: 13 },
    );
    const firstFrenchObservation = await resolve(
      detector,
      `${longEnglishHistory}bonjour merci monde francais encore discussion `,
      { tabId: 13 },
    );
    const secondFrenchObservation = await resolve(
      detector,
      `${longEnglishHistory}bonjour merci monde francais encore discussion phrase texte `,
      { tabId: 13 },
    );

    expect(initial.language).toBe("en_US");
    expect(firstFrenchObservation.language).toBe("en_US");
    expect(secondFrenchObservation.language).toBe("fr_FR");

    const detectorInputs = detectLanguage.mock.calls.map(([text]) => String(text));
    expect(detectorInputs.every((text) => text.length <= AUTO_LANGUAGE_MAX_SAMPLE_CHARS)).toBe(
      true,
    );
    expect(
      detectorInputs.every(
        (text) => (text.match(/\p{L}+/gu)?.length || 0) <= AUTO_LANGUAGE_MAX_SAMPLE_TOKENS,
      ),
    ).toBe(true);
    expect(detectorInputs.at(-1)).toBe(
      "bonjour merci monde francais encore discussion phrase texte"
        .split(/\s+/)
        .slice(-AUTO_LANGUAGE_MAX_SAMPLE_TOKENS)
        .join(" ")
        .concat(" "),
    );
  });

  test("caches page language hints until the runtime or page scope changes", async () => {
    const { detector, pageDetectLanguage } = createDetector();
    pageDetectLanguage.mockResolvedValue("fr");

    const first = await resolve(detector, "hi", { tabId: 14 });
    const repeated = await resolve(detector, "hi there", { tabId: 14 });

    expect(first.language).toBe("fr_FR");
    expect(first.source).toBe("provisional_page");
    expect(repeated.language).toBe("fr_FR");
    expect(repeated.source).toBe("provisional_page");
    expect(pageDetectLanguage).toHaveBeenCalledTimes(1);

    await resolve(detector, "hi again", { tabId: 14, runtimeGeneration: 2 });
    expect(pageDetectLanguage).toHaveBeenCalledTimes(2);

    await resolve(detector, "hi once more", {
      tabId: 14,
      runtimeGeneration: 2,
      domainURL: "other.example",
    });
    expect(pageDetectLanguage).toHaveBeenCalledTimes(3);
  });

  test("stale-session pruning persists a soft site prior and clears stale live state", async () => {
    const { detector, settingsState } = createDetector();
    let now = 10_000;
    setSystemTime(now);

    await resolve(detector, "bonjour merci monde francais encore discussion phrase texte ", {
      tabId: 21,
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
    setSystemTime(now);

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
  });

  test("revisit uses a pruned soft prior provisionally but stronger fresh evidence overrides it", async () => {
    const { detector, settingsState } = createDetector();
    let now = 20_000;
    setSystemTime(now);

    await resolve(detector, "bonjour merci monde francais encore discussion phrase texte ", {
      tabId: 31,
    });

    now += SESSION_TTL_MS + 1;
    setSystemTime(now);
    await detector.getRecentSessionStatusForScope({
      tabId: 31,
      domainURL: "example.com",
    });

    expect(settingsState.autoLanguageSitePriors).toEqual({
      "example.com": {
        fr_FR: expect.any(Number),
      },
    });

    const provisionalRevisit = await resolve(detector, "hi", { tabId: 32 });
    expect(provisionalRevisit.language).toBe("fr_FR");
    expect(provisionalRevisit.source).toBe("provisional_site_prior");

    const strongEnglishRevisit = await resolve(
      detector,
      "hello english paragraph with long cursor history and steady typing ",
      { tabId: 32 },
    );
    expect(strongEnglishRevisit.language).toBe("en_US");
    expect(strongEnglishRevisit.source).toBe("detection");
  });
});
