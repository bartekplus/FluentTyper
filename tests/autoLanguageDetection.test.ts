import { describe, expect, test } from "bun:test";
import {
  AUTO_LANGUAGE_MAX_SAMPLE_CHARS,
  AUTO_LANGUAGE_MAX_SAMPLE_TOKENS,
  extractAutoLanguageSample,
  getAutoLanguageSitePrior,
  resolveAutoLanguageDecision,
} from "../src/core/domain/autoLanguageDetection";

const allowedLanguages = ["en_US", "fr_FR", "el_GR"];

describe("auto language detection decision engine", () => {
  test("holds fallback for short ambiguous text", () => {
    const result = resolveAutoLanguageDecision({
      allowedLanguages,
      fallbackLanguage: "en_US",
      sampleText: "bonjour",
      browserDetections: [{ language: "fr", percentage: 58 }],
      session: {
        stableLanguage: null,
        pendingLanguage: null,
        pendingConfirmations: 0,
        manualLockLanguage: null,
        switchSuppressedUntilBoundary: false,
      },
    });

    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.stableLanguage).toBeNull();
  });

  test("ignores an isolated foreign word during a stable session", () => {
    const result = resolveAutoLanguageDecision({
      allowedLanguages,
      fallbackLanguage: "en_US",
      sampleText: "this is a stable english thread bonjour",
      browserDetections: [
        { language: "fr", percentage: 62 },
        { language: "en", percentage: 38 },
      ],
      session: {
        stableLanguage: "en_US",
        pendingLanguage: null,
        pendingConfirmations: 0,
        manualLockLanguage: null,
        switchSuppressedUntilBoundary: false,
      },
    });

    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.pendingLanguage).toBeNull();
  });

  test("switches after sustained challenger confirmation", () => {
    const first = resolveAutoLanguageDecision({
      allowedLanguages,
      fallbackLanguage: "en_US",
      sampleText: "bonjour tout le monde merci encore ",
      browserDetections: [{ language: "fr", percentage: 88 }],
      session: {
        stableLanguage: "en_US",
        pendingLanguage: null,
        pendingConfirmations: 0,
        manualLockLanguage: null,
        switchSuppressedUntilBoundary: false,
      },
    });
    const second = resolveAutoLanguageDecision({
      allowedLanguages,
      fallbackLanguage: "en_US",
      sampleText: "bonjour tout le monde merci encore ",
      browserDetections: [{ language: "fr", percentage: 88 }],
      session: {
        stableLanguage: "en_US",
        pendingLanguage: first.pendingLanguage,
        pendingConfirmations: first.pendingConfirmations,
        manualLockLanguage: null,
        switchSuppressedUntilBoundary: false,
      },
    });

    expect(first.resolvedLanguage).toBe("en_US");
    expect(first.pendingLanguage).toBe("fr_FR");
    expect(second.resolvedLanguage).toBe("fr_FR");
    expect(second.switched).toBe(true);
  });

  test("switches immediately on Greek script", () => {
    const result = resolveAutoLanguageDecision({
      allowedLanguages,
      fallbackLanguage: "en_US",
      sampleText: "γειά σου κόσμε",
      browserDetections: [{ language: "el", percentage: 55 }],
      session: {
        stableLanguage: "en_US",
        pendingLanguage: null,
        pendingConfirmations: 0,
        manualLockLanguage: null,
        switchSuppressedUntilBoundary: false,
      },
    });

    expect(result.resolvedLanguage).toBe("el_GR");
    expect(result.source).toBe("strong_script");
  });

  test("respects manual lock", () => {
    const result = resolveAutoLanguageDecision({
      allowedLanguages,
      fallbackLanguage: "en_US",
      sampleText: "bonjour tout le monde merci encore ",
      browserDetections: [{ language: "fr", percentage: 95 }],
      session: {
        stableLanguage: "en_US",
        pendingLanguage: null,
        pendingConfirmations: 0,
        manualLockLanguage: "en_US",
        switchSuppressedUntilBoundary: false,
      },
    });

    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.source).toBe("manual_lock");
  });

  test("uses page hint when detection is unavailable", () => {
    const result = resolveAutoLanguageDecision({
      allowedLanguages,
      fallbackLanguage: "en_US",
      sampleText: "",
      browserDetections: [],
      pageLanguageHint: "fr",
      session: {
        stableLanguage: null,
        pendingLanguage: null,
        pendingConfirmations: 0,
        manualLockLanguage: null,
        switchSuppressedUntilBoundary: false,
      },
    });

    expect(result.resolvedLanguage).toBe("fr_FR");
    expect(result.source).toBe("provisional_page");
  });

  test("uses site prior as a soft bias but not a hard force", () => {
    const prior = getAutoLanguageSitePrior(
      { "example.com": { en_US: 0.9 } },
      "example.com",
      allowedLanguages,
    );
    const result = resolveAutoLanguageDecision({
      allowedLanguages,
      fallbackLanguage: "fr_FR",
      sampleText: "bonjour tout le monde merci encore ",
      browserDetections: [{ language: "fr", percentage: 84 }],
      sitePriorLanguage: prior.language,
      sitePriorConfidence: prior.confidence,
      session: {
        stableLanguage: null,
        pendingLanguage: null,
        pendingConfirmations: 0,
        manualLockLanguage: null,
        switchSuppressedUntilBoundary: false,
      },
    });

    expect(result.resolvedLanguage).toBe("fr_FR");
    expect(result.stableLanguage).toBe("fr_FR");
  });

  test("extracts a capped rolling sample from the latest tokens", () => {
    const sample = extractAutoLanguageSample(
      "one two three four five six seven eight nine ten eleven twelve",
    );

    expect(sample.split(/\s+/)).toHaveLength(AUTO_LANGUAGE_MAX_SAMPLE_TOKENS);
    expect(sample.length).toBeLessThanOrEqual(AUTO_LANGUAGE_MAX_SAMPLE_CHARS);
    expect(sample).toBe("seven eight nine ten eleven twelve");
  });
});

describe("auto language detection — Arabic", () => {
  const emptySession = {
    stableLanguage: null,
    pendingLanguage: null,
    pendingConfirmations: 0,
    manualLockLanguage: null,
    switchSuppressedUntilBoundary: false,
  };

  function decide(sampleText: string, allowed: string[]) {
    return resolveAutoLanguageDecision({
      allowedLanguages: allowed,
      fallbackLanguage: "en_US",
      sampleText,
      browserDetections: [],
      session: emptySession,
    });
  }

  test("commits an Arabic sample via strong script", () => {
    const result = decide("مرحبا بالعالم", ["en_US", "ar_SA"]);
    expect(result.resolvedLanguage).toBe("ar_SA");
    expect(result.source).toBe("strong_script");
  });

  test("a mixed Latin + Arabic sample still commits via strong script", () => {
    const result = decide("hello مرحبا بالعالم", ["en_US", "ar_SA"]);
    expect(result.resolvedLanguage).toBe("ar_SA");
    expect(result.source).toBe("strong_script");
  });

  test("does not commit to ar_SA when it is not an allowed language", () => {
    const result = decide("مرحبا بالعالم", ["en_US", "fr_FR"]);
    expect(result.resolvedLanguage).not.toBe("ar_SA");
  });

  // The Arabic block is shared with Persian, Urdu and Pashto.  Their samples
  // must not take the immediate strong-script commit that skips scoring.
  test("Persian does not take the Arabic strong-script shortcut", () => {
    const result = decide("سلام دنیا", ["en_US", "ar_SA"]);
    expect(result.source).not.toBe("strong_script");
  });

  test("Urdu does not take the Arabic strong-script shortcut", () => {
    const result = decide("ہیلو دنیا", ["en_US", "ar_SA"]);
    expect(result.source).not.toBe("strong_script");
  });

  test("Pashto does not take the Arabic strong-script shortcut", () => {
    const result = decide("ښه راغلاست", ["en_US", "ar_SA"]);
    expect(result.source).not.toBe("strong_script");
  });

  test("Greek still commits via strong script (control)", () => {
    const result = decide("φιλοσοφία", ["en_US", "el_GR"]);
    expect(result.resolvedLanguage).toBe("el_GR");
    expect(result.source).toBe("strong_script");
  });

  // The sample is a rolling window, so after typing Arabic it still contains
  // Arabic while the user types English in the same sentence.  Deciding the
  // strong script from the whole window pinned the language to Arabic and the
  // Arabic engine then predicted Latin words.
  test("returns to English when Latin is typed after Arabic in the same sentence", () => {
    const result = resolveAutoLanguageDecision({
      allowedLanguages: ["en_US", "ar_SA"],
      fallbackLanguage: "en_US",
      sampleText: "السلام عليكم hello",
      browserDetections: [{ language: "ar", percentage: 72 }],
      session: { ...emptySession, stableLanguage: "ar_SA" },
    });

    expect(result.resolvedLanguage).toBe("en_US");
  });

  test("returns to English mid-word after Arabic in the same sentence", () => {
    const result = resolveAutoLanguageDecision({
      allowedLanguages: ["en_US", "ar_SA"],
      fallbackLanguage: "en_US",
      sampleText: "السلام hel",
      browserDetections: [{ language: "ar", percentage: 72 }],
      session: { ...emptySession, stableLanguage: "ar_SA" },
    });

    expect(result.resolvedLanguage).toBe("en_US");
  });

  test("stays on Arabic while the token being typed is Arabic", () => {
    const result = resolveAutoLanguageDecision({
      allowedLanguages: ["en_US", "ar_SA"],
      fallbackLanguage: "en_US",
      sampleText: "hello مرحبا",
      browserDetections: [{ language: "ar", percentage: 60 }],
      session: { ...emptySession, stableLanguage: "ar_SA" },
    });

    expect(result.resolvedLanguage).toBe("ar_SA");
  });

  // The reverse direction must keep working: English session, Arabic typed.
  test("switches to Arabic when Arabic is typed after English in a sentence", () => {
    const result = resolveAutoLanguageDecision({
      allowedLanguages: ["en_US", "ar_SA"],
      fallbackLanguage: "en_US",
      sampleText: "hello مرحبا",
      browserDetections: [{ language: "en", percentage: 70 }],
      session: { ...emptySession, stableLanguage: "en_US" },
    });

    expect(result.resolvedLanguage).toBe("ar_SA");
  });
});

describe("auto language detection — script switch", () => {
  const emptySession = {
    stableLanguage: null,
    pendingLanguage: null,
    pendingConfirmations: 0,
    manualLockLanguage: null,
    switchSuppressedUntilBoundary: false,
  };

  function decideStable(
    sampleText: string,
    allowed: string[],
    stableLanguage: string | null,
    extra: Partial<Parameters<typeof resolveAutoLanguageDecision>[0]> = {},
  ) {
    return resolveAutoLanguageDecision({
      allowedLanguages: allowed,
      fallbackLanguage: "en_US",
      sampleText,
      browserDetections: [],
      session: { ...emptySession, stableLanguage },
      ...extra,
    });
  }

  test("switches by script and suppresses further switches until a boundary", () => {
    const result = decideStable("مرحبا hel", ["en_US", "ar_SA"], "ar_SA");
    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.source).toBe("script_switch");
    expect(result.switched).toBe(true);
    expect(result.switchSuppressedUntilBoundary).toBe(true);
  });

  test.each([
    ["Greek", "Καλημέρα email", "el_GR"],
    ["Arabic", "مرحبا iPhone", "ar_SA"],
  ])(
    "stable %s + Latin word switches to the fallback, not the alphabetical first",
    (_script, sampleText, stableLanguage) => {
      const allowed = ["ar_SA", "de_DE", "el_GR", "en_US", "fr_FR"];
      const result = decideStable(sampleText, allowed, stableLanguage);
      expect(result.resolvedLanguage).toBe("en_US");
      expect(result.source).toBe("script_switch");
    },
  );

  test("script switch prefers a scored Latin candidate over the fallback", () => {
    const result = decideStable("مرحبا bonjour", ["ar_SA", "de_DE", "en_US", "fr_FR"], "ar_SA", {
      browserDetections: [{ language: "fr", percentage: 60 }],
    });
    expect(result.resolvedLanguage).toBe("fr_FR");
    expect(result.source).toBe("script_switch");
  });

  test("script switch uses a same-script page hint", () => {
    const result = decideStable("مرحبا hallo", ["ar_SA", "de_DE", "en_US", "fr_FR"], "ar_SA", {
      pageLanguageHint: "de",
    });
    expect(result.resolvedLanguage).toBe("de_DE");
  });

  test("does not script-switch without a scored or fallback candidate", () => {
    const result = decideStable("مرحبا hallo", ["ar_SA", "de_DE", "fr_FR"], "ar_SA", {
      fallbackLanguage: "ar_SA",
    });
    expect(result.resolvedLanguage).toBe("ar_SA");
    expect(result.source).not.toBe("script_switch");
  });

  test("never switches to the text expander", () => {
    const result = decideStable("مرحبا hello", ["ar_SA", "textExpander"], "ar_SA", {
      fallbackLanguage: "ar_SA",
    });
    expect(result.resolvedLanguage).toBe("ar_SA");
  });

  test("text expander alone still resolves to the text expander", () => {
    const result = decideStable("hello world again", ["textExpander"], null, {
      fallbackLanguage: "textExpander",
    });
    expect(result.resolvedLanguage).toBe("textExpander");
    expect(result.source).toBe("fallback");
  });

  test("Persian token does not script-switch an English session to Arabic", () => {
    const result = decideStable("hello پیام", ["en_US", "ar_SA"], "en_US");
    expect(result.resolvedLanguage).toBe("en_US");
  });

  test("Persian sample does not script-switch an English session to Arabic", () => {
    const result = decideStable("سلام چطوری", ["en_US", "ar_SA"], "en_US");
    expect(result.resolvedLanguage).toBe("en_US");
  });

  // Pins current behaviour: a script mismatch overrides an active suppression.
  test("script switch still applies while a previous switch is suppressed", () => {
    const result = decideStable("مرحبا hel", ["en_US", "ar_SA"], "ar_SA", {
      session: { ...emptySession, stableLanguage: "ar_SA", switchSuppressedUntilBoundary: true },
    });
    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.source).toBe("script_switch");
    expect(result.switchSuppressedUntilBoundary).toBe(true);
  });

  test("Arabic digits alone do not commit Arabic", () => {
    const result = decideStable("١٢٣", ["en_US", "ar_SA"], null);
    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.source).not.toBe("strong_script");
  });

  test("Arabic punctuation alone does not commit Arabic", () => {
    const result = decideStable("؟", ["en_US", "ar_SA"], null);
    expect(result.source).not.toBe("strong_script");
  });

  test("tashkeel and ZWNJ do not split a word into several tokens", () => {
    expect(extractAutoLanguageSample("كَتَبَ")).toBe("كَتَبَ");
    expect(extractAutoLanguageSample("می‌خواهم")).toBe("می‌خواهم");
    // Three diacritised letters must not count as three tokens of evidence.
    const result = decideStable("كَتَبَ", ["en_US", "fr_FR"], null);
    expect(result.hasQualifiedEvidence).toBe(false);
  });
});
