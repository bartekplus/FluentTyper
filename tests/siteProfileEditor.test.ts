import "./setup";
import { describe, expect, test } from "bun:test";
import { MAX_NUM_SUGGESTIONS } from "../src/core/domain/constants";
import { SUPPORTED_LANGUAGES } from "../src/core/domain/lang";
import { i18n } from "../src/ui/options/fluenttyperI18n.js";
import {
  appendLanguageOptions,
  buildSiteProfile,
  getOnOffLabel,
  languageLabel,
  populateBooleanOverrideOptions,
  populateSuggestionOptions,
  toOverrideValue,
} from "../src/ui/shared/siteProfileEditor";

function optionPairs(select: HTMLSelectElement): Array<[string, string | null]> {
  return Array.from(select.options).map((option) => [option.value, option.textContent]);
}

describe("siteProfileEditor", () => {
  test("languageLabel falls back to key; appendLanguageOptions appends labelled options", () => {
    expect(languageLabel("en_US")).toBe(SUPPORTED_LANGUAGES.en_US);
    expect(languageLabel("xx_YY")).toBe("xx_YY");

    const select = document.createElement("select");
    select.appendChild(document.createElement("option"));
    appendLanguageOptions(select, ["en_US", "xx_YY"]);
    expect(optionPairs(select)).toEqual([
      ["", ""],
      ["en_US", SUPPORTED_LANGUAGES.en_US],
      ["xx_YY", "xx_YY"],
    ]);
  });

  test("populateSuggestionOptions renders inherit + 0..MAX options", () => {
    const select = document.createElement("select");
    select.appendChild(document.createElement("option"));
    populateSuggestionOptions(select, 3);
    const pairs = optionPairs(select);
    expect(pairs[0]).toEqual(["global", `${i18n.get("site_profile_inherit_global")} (3)`]);
    expect(pairs.slice(1)).toEqual(
      Array.from({ length: MAX_NUM_SUGGESTIONS + 1 }, (_, idx) => [String(idx), String(idx)]),
    );
  });

  test("populateBooleanOverrideOptions renders global/on/off", () => {
    const select = document.createElement("select");
    populateBooleanOverrideOptions(select, true, getOnOffLabel);
    expect(optionPairs(select)).toEqual([
      ["global", `${i18n.get("site_profile_inherit_global")} (${getOnOffLabel(true)})`],
      ["on", getOnOffLabel(true)],
      ["off", getOnOffLabel(false)],
    ]);
  });

  test("toOverrideValue maps booleans to on/off and undefined to global", () => {
    expect(toOverrideValue(true)).toBe("on");
    expect(toOverrideValue(false)).toBe("off");
    expect(toOverrideValue(undefined)).toBe("global");
  });

  test("buildSiteProfile keeps only explicit overrides", () => {
    expect(buildSiteProfile("en_US", {})).toEqual({ language: "en_US" });
    expect(
      buildSiteProfile("de_DE", {
        numSuggestions: "global",
        inlineSuggestion: "global",
        preferNativeAutocomplete: "global",
        codeMode: "global",
      }),
    ).toEqual({ language: "de_DE" });
    expect(
      buildSiteProfile("pl_PL", {
        numSuggestions: "99",
        inlineSuggestion: "off",
        preferNativeAutocomplete: "on",
        codeMode: "on",
      }),
    ).toEqual({
      language: "pl_PL",
      numSuggestions: MAX_NUM_SUGGESTIONS,
      inline_suggestion: false,
      preferNativeAutocomplete: true,
      codeMode: true,
    });
  });
});
