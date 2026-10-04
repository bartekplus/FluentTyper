import { describe, expect, test } from "bun:test";
import {
  AUTO_LANGUAGE_MAX_SAMPLE_CHARS,
  AUTO_LANGUAGE_MAX_SAMPLE_TOKENS,
  extractAutoLanguageSample,
  getAutoLanguageSitePrior,
  resolveAutoLanguageDecision,
} from "../src/core/domain/autoLanguageDetection";

const allowedLanguages = ["en_US", "fr_FR", "el_GR"];

const emptySession = {
  stableLanguage: null,
  pendingLanguage: null,
  pendingConfirmations: 0,
  manualLockLanguage: null,
  switchSuppressedUntilBoundary: false,
};

function decide(
  sampleText: string,
  allowed: string[],
  stableLanguage: string | null = null,
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

describe("auto language detection decision engine", () => {
  test("holds fallback for short ambiguous text", () => {
    const result = decide("bonjour", allowedLanguages, null, {
      browserDetections: [{ language: "fr", percentage: 58 }],
    });

    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.stableLanguage).toBeNull();
  });

  test("ignores an isolated foreign word during a stable session", () => {
    const result = decide("this is a stable english thread bonjour", allowedLanguages, "en_US", {
      browserDetections: [
        { language: "fr", percentage: 62 },
        { language: "en", percentage: 38 },
      ],
    });

    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.pendingLanguage).toBeNull();
  });

  test("switches after sustained challenger confirmation", () => {
    const sample = "bonjour tout le monde merci encore ";
    const browserDetections = [{ language: "fr", percentage: 88 }];
    const first = decide(sample, allowedLanguages, "en_US", { browserDetections });
    const second = decide(sample, allowedLanguages, "en_US", {
      browserDetections,
      session: {
        ...emptySession,
        stableLanguage: "en_US",
        pendingLanguage: first.pendingLanguage,
        pendingConfirmations: first.pendingConfirmations,
      },
    });

    expect(first.resolvedLanguage).toBe("en_US");
    expect(first.pendingLanguage).toBe("fr_FR");
    expect(second.resolvedLanguage).toBe("fr_FR");
    expect(second.switched).toBe(true);
  });

  test("switches immediately on Greek script", () => {
    const result = decide("γειά σου κόσμε", allowedLanguages, "en_US", {
      browserDetections: [{ language: "el", percentage: 55 }],
    });

    expect(result.resolvedLanguage).toBe("el_GR");
    expect(result.source).toBe("strong_script");
  });

  test("respects manual lock", () => {
    const result = decide("bonjour tout le monde merci encore ", allowedLanguages, "en_US", {
      browserDetections: [{ language: "fr", percentage: 95 }],
      session: { ...emptySession, stableLanguage: "en_US", manualLockLanguage: "en_US" },
    });

    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.source).toBe("manual_lock");
  });

  test("uses page hint when detection is unavailable", () => {
    const result = decide("", allowedLanguages, null, { pageLanguageHint: "fr" });

    expect(result.resolvedLanguage).toBe("fr_FR");
    expect(result.source).toBe("provisional_page");
  });

  test("uses site prior as a soft bias but not a hard force", () => {
    const prior = getAutoLanguageSitePrior(
      { "example.com": { en_US: 0.9 } },
      "example.com",
      allowedLanguages,
    );
    const result = decide("bonjour tout le monde merci encore ", allowedLanguages, null, {
      fallbackLanguage: "fr_FR",
      browserDetections: [{ language: "fr", percentage: 84 }],
      sitePriorLanguage: prior.language,
      sitePriorConfidence: prior.confidence,
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
  test.each([
    ["Persian", "سلام دنیا"],
    ["Urdu", "ہیلو دنیا"],
    ["Pashto", "ښه راغلاست"],
  ])("%s does not take the Arabic strong-script shortcut", (_language, sample) => {
    expect(decide(sample, ["en_US", "ar_SA"]).source).not.toBe("strong_script");
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
  test.each([
    ["Latin is typed after Arabic in the same sentence", "السلام عليكم hello", 72, "en_US"],
    ["Latin is typed mid-word after Arabic in the same sentence", "السلام hel", 72, "en_US"],
    ["the token being typed is Arabic", "hello مرحبا", 60, "ar_SA"],
  ])("an Arabic session resolves correctly when %s", (_case, sample, percentage, expected) => {
    const result = decide(sample, ["en_US", "ar_SA"], "ar_SA", {
      browserDetections: [{ language: "ar", percentage }],
    });

    expect(result.resolvedLanguage).toBe(expected);
  });

  // The reverse direction must keep working: English session, Arabic typed.
  test("switches to Arabic when Arabic is typed after English in a sentence", () => {
    const result = decide("hello مرحبا", ["en_US", "ar_SA"], "en_US", {
      browserDetections: [{ language: "en", percentage: 70 }],
    });

    expect(result.resolvedLanguage).toBe("ar_SA");
  });
});

describe("auto language detection — script switch", () => {
  test("switches by script and suppresses further switches until a boundary", () => {
    const result = decide("مرحبا hel", ["en_US", "ar_SA"], "ar_SA");
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
      const result = decide(sampleText, allowed, stableLanguage);
      expect(result.resolvedLanguage).toBe("en_US");
      expect(result.source).toBe("script_switch");
    },
  );

  test("script switch prefers a scored Latin candidate over the fallback", () => {
    const result = decide("مرحبا bonjour", ["ar_SA", "de_DE", "en_US", "fr_FR"], "ar_SA", {
      browserDetections: [{ language: "fr", percentage: 60 }],
    });
    expect(result.resolvedLanguage).toBe("fr_FR");
    expect(result.source).toBe("script_switch");
  });

  test.each([null, "en_US"])(
    "old Japanese evidence does not suppress the current English token with stable language %s",
    (stableLanguage) => {
      const result = decide(
        "これは日本語です 日本語の文章です もう一つの文章です hello",
        ["en_US"],
        stableLanguage,
        { browserDetections: [{ language: "ja", percentage: 99 }] },
      );
      expect(result.resolvedLanguage).toBe("en_US");
      expect(result.source).not.toBe("unsupported");
      expect(result.stableLanguage).toBe(stableLanguage);
    },
  );

  test("old Japanese evidence permits the existing current-token script switch", () => {
    const result = decide(
      "これは日本語です 日本語の文章です もう一つの文章です hello",
      ["en_US", "ar_SA"],
      "ar_SA",
      { browserDetections: [{ language: "ja", percentage: 99 }] },
    );
    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.source).toBe("script_switch");
  });

  test("script switch uses a same-script page hint", () => {
    const result = decide("مرحبا hallo", ["ar_SA", "de_DE", "en_US", "fr_FR"], "ar_SA", {
      pageLanguageHint: "de",
    });
    expect(result.resolvedLanguage).toBe("de_DE");
  });

  test("does not script-switch without a scored or fallback candidate", () => {
    const result = decide("مرحبا hallo", ["ar_SA", "de_DE", "fr_FR"], "ar_SA", {
      fallbackLanguage: "ar_SA",
    });
    expect(result.resolvedLanguage).toBe("ar_SA");
    expect(result.source).not.toBe("script_switch");
  });

  test("unsupported script remains unchecked instead of switching to the text expander", () => {
    const result = decide("مرحبا hello", ["ar_SA", "textExpander"], "ar_SA", {
      fallbackLanguage: "ar_SA",
    });
    expect(result.resolvedLanguage).toBe("und");
    expect(result.source).toBe("unsupported");
  });

  test("text expander alone still resolves to the text expander", () => {
    const result = decide("hello world again", ["textExpander"], null, {
      fallbackLanguage: "textExpander",
    });
    expect(result.resolvedLanguage).toBe("textExpander");
    expect(result.source).toBe("fallback");
  });

  test.each([
    ["token", "hello پیام"],
    ["sample", "سلام چطوری"],
  ])("Persian %s does not script-switch an English session to Arabic", (_case, sample) => {
    expect(decide(sample, ["en_US", "ar_SA"], "en_US").resolvedLanguage).toBe("en_US");
  });

  // Pins current behaviour: a script mismatch overrides an active suppression.
  test("script switch still applies while a previous switch is suppressed", () => {
    const result = decide("مرحبا hel", ["en_US", "ar_SA"], "ar_SA", {
      session: { ...emptySession, stableLanguage: "ar_SA", switchSuppressedUntilBoundary: true },
    });
    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.source).toBe("script_switch");
    expect(result.switchSuppressedUntilBoundary).toBe(true);
  });

  test("Arabic digits alone do not commit Arabic", () => {
    const result = decide("١٢٣", ["en_US", "ar_SA"], null);
    expect(result.resolvedLanguage).toBe("en_US");
    expect(result.source).not.toBe("strong_script");
  });

  test("Arabic punctuation alone does not commit Arabic", () => {
    const result = decide("؟", ["en_US", "ar_SA"], null);
    expect(result.source).not.toBe("strong_script");
  });

  test("tashkeel and ZWNJ do not split a word into several tokens", () => {
    expect(extractAutoLanguageSample("كَتَبَ")).toBe("كَتَبَ");
    expect(extractAutoLanguageSample("می‌خواهم")).toBe("می‌خواهم");
    // Three diacritised letters must not count as three tokens of evidence.
    const result = decide("كَتَبَ", ["en_US", "fr_FR"], null);
    expect(result.hasQualifiedEvidence).toBe(false);
  });
});

test("unsupported detected text never uses page hints or an unrelated fallback", () => {
  const input = {
    allowedLanguages: ["en_US", "pl_PL"],
    fallbackLanguage: "en_US",
    sampleText: "これは日本語で書かれた長い文章です。日本語を確認します。",
    browserDetections: [{ language: "ja", percentage: 99 }],
    documentLanguageHint: "en",
    pageLanguageHint: "en",
    session: emptySession,
  };
  expect(resolveAutoLanguageDecision(input)).toMatchObject({
    resolvedLanguage: "und",
    source: "unsupported",
  });
  expect(
    resolveAutoLanguageDecision({
      ...input,
      session: { ...input.session, manualLockLanguage: "pl_PL" },
    }),
  ).toMatchObject({ resolvedLanguage: "pl_PL", source: "manual_lock" });
});
