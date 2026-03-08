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
