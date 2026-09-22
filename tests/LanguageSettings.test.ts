import {
  SUPPORTED_PREDICTION_LANGUAGE_KEYS,
  resolveEnabledLanguages,
} from "../src/core/domain/lang";

describe("language settings helpers", () => {
  test("resolveEnabledLanguages falls back to all languages for empty input", () => {
    expect(resolveEnabledLanguages(undefined)).toEqual(SUPPORTED_PREDICTION_LANGUAGE_KEYS);
    expect(resolveEnabledLanguages([])).toEqual(SUPPORTED_PREDICTION_LANGUAGE_KEYS);
  });

  test("resolveEnabledLanguages filters and preserves supported order", () => {
    const result = resolveEnabledLanguages(["de_DE", "en_US"]);
    expect(result).toEqual(["en_US", "de_DE"]);
  });

  test("resolveEnabledLanguages excludes auto_detect and never returns empty", () => {
    const result = resolveEnabledLanguages(["auto_detect"]);
    expect(result).toEqual(SUPPORTED_PREDICTION_LANGUAGE_KEYS);
  });

  test("ar_SA is a supported prediction language", () => {
    expect(SUPPORTED_PREDICTION_LANGUAGE_KEYS).toContain("ar_SA");
  });

  test("resolveEnabledLanguages round-trips ar_SA", () => {
    expect(resolveEnabledLanguages(["ar_SA"])).toEqual(["ar_SA"]);
    expect(resolveEnabledLanguages(["ar_SA", "en_US"])).toEqual(["en_US", "ar_SA"]);
  });

  test("en_US stays the first prediction language (first-enabled fallback)", () => {
    expect(SUPPORTED_PREDICTION_LANGUAGE_KEYS[0]).toBe("en_US");
  });
});
