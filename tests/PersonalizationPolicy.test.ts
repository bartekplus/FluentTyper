import {
  PERSONALIZATION_DECAY_WINDOW_MS,
  PERSONALIZATION_MAX_WORDS_PER_LANGUAGE,
  calculateEffectivePersonalizationScore,
  normalizePersonalizationWord,
  prunePersonalizationLanguage,
  sanitizePersonalizationStore,
} from "../src/core/domain/personalization/PersonalizationPolicy";

describe("PersonalizationPolicy", () => {
  test("normalizes Unicode, case, regular whitespace, and non-breaking spaces", () => {
    expect(normalizePersonalizationWord(" \u00a0Café\u0301\u00a0 ", "fr_FR")).toEqual({
      normalizedWord: "café́".normalize("NFC"),
      display: "Café́".normalize("NFC"),
    });
    expect(normalizePersonalizationWord("ÄPFEL", "de_DE")?.normalizedWord).toBe("äpfel");
  });

  test.each(["", "two words", "two\nwords", "\bword", "\\bword", "12345", "---", "${date}"])(
    "rejects ineligible value %j",
    (value) => {
      expect(normalizePersonalizationWord(value, "en_US")).toBeNull();
    },
  );

  test("decays scores deterministically", () => {
    const score = calculateEffectivePersonalizationScore(
      { score: 4, updatedAtMs: 1_000 },
      1_000 + PERSONALIZATION_DECAY_WINDOW_MS,
    );
    expect(score).toBeCloseTo(4 / Math.E, 10);
  });

  test("prunes lowest decayed scores first", () => {
    const words = Object.fromEntries(
      Array.from({ length: PERSONALIZATION_MAX_WORDS_PER_LANGUAGE + 1 }, (_, index) => [
        `word${String.fromCharCode(97 + (index % 26))}${index}`,
        {
          display: `word${index}`,
          score: index === 0 ? 0.1 : 2,
          updatedAtMs: 10_000 + index,
        },
      ]),
    );
    const pruned = prunePersonalizationLanguage(words, 20_000);
    expect(Object.keys(pruned)).toHaveLength(PERSONALIZATION_MAX_WORDS_PER_LANGUAGE);
    expect(pruned.worda0).toBeUndefined();
  });

  test("repairs malformed stores while tolerating future fields", () => {
    const repaired = sanitizePersonalizationStore(
      {
        version: 1,
        future: true,
        languages: {
          en_US: {
            valid: { display: "Valid", score: 2, updatedAtMs: 100, future: "ok" },
            mismatch: { display: "other", score: 2, updatedAtMs: 100 },
            invalidScore: { display: "invalidScore", score: -1, updatedAtMs: 100 },
          },
          unknown: { word: { display: "word", score: 2, updatedAtMs: 100 } },
        },
        recentEvents: {
          accepted: { language: "en_US", normalizedWord: "valid", applied: true },
          bad: { language: "unknown", normalizedWord: "word", applied: true },
        },
      },
      200,
    );
    expect(repaired).toEqual({
      version: 1,
      languages: {
        en_US: {
          valid: { display: "Valid", score: 2, updatedAtMs: 100 },
        },
      },
      recentEvents: {
        accepted: { language: "en_US", normalizedWord: "valid", applied: true },
      },
    });
  });
});
