import {
  SUPPORTED_PREDICTION_LANGUAGE_KEYS,
  resolveEnabledLanguages,
  resolveEnabledPredictionLanguages,
} from "../src/core/domain/lang";

describe("language settings helpers", () => {
  test("resolveEnabledLanguages falls back to all languages for empty input", () => {
    expect(resolveEnabledLanguages(undefined)).toEqual(
      SUPPORTED_PREDICTION_LANGUAGE_KEYS,
    );
    expect(resolveEnabledLanguages([])).toEqual(
      SUPPORTED_PREDICTION_LANGUAGE_KEYS,
    );
  });

  test("resolveEnabledLanguages filters and preserves supported order", () => {
    const result = resolveEnabledLanguages(["de_DE", "en_US"]);
    expect(result).toEqual(["en_US", "de_DE"]);
  });

  test("resolveEnabledPredictionLanguages excludes auto_detect and never returns empty", () => {
    const result = resolveEnabledPredictionLanguages(["auto_detect"]);
    expect(result).toEqual(SUPPORTED_PREDICTION_LANGUAGE_KEYS);
  });
});
