import { MAX_NUM_SUGGESTIONS } from "@core/domain/constants";
import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { parseBooleanOverride, parseSuggestionsOverride } from "@core/domain/siteProfileService";
import type { SiteProfile } from "@core/domain/siteProfiles";
import { i18n } from "@ui/options/fluenttyperI18n.js";

export function getOnOffLabel(value: boolean): string {
  return value ? i18n.get("site_profile_on") : i18n.get("site_profile_off");
}

export function getInheritLabel(globalValueLabel: string): string {
  return `${i18n.get("site_profile_inherit_global")} (${globalValueLabel})`;
}

export function getPreferNativeAutocompleteLabel(value: boolean): string {
  return value
    ? i18n.get("prefer_native_autocomplete_on")
    : i18n.get("prefer_native_autocomplete_off");
}

export function toOverrideValue(value: boolean | undefined): string {
  return typeof value === "boolean" ? (value ? "on" : "off") : "global";
}

export function languageLabel(languageKey: string): string {
  return SUPPORTED_LANGUAGES[languageKey] || languageKey;
}

export function appendLanguageOptions(select: HTMLSelectElement, languageKeys: string[]): void {
  for (const languageKey of languageKeys) {
    select.appendChild(new window.Option(languageLabel(languageKey), languageKey));
  }
}

export function populateSuggestionOptions(
  select: HTMLSelectElement,
  globalNumSuggestions: number,
): void {
  select.replaceChildren(
    new window.Option(getInheritLabel(String(globalNumSuggestions)), "global"),
  );
  for (let idx = 0; idx <= MAX_NUM_SUGGESTIONS; idx += 1) {
    select.appendChild(new window.Option(String(idx), String(idx)));
  }
}

export function populateBooleanOverrideOptions(
  select: HTMLSelectElement,
  globalValue: boolean,
  describeValue: (value: boolean) => string,
): void {
  select.replaceChildren(
    new window.Option(getInheritLabel(describeValue(globalValue)), "global"),
    new window.Option(describeValue(true), "on"),
    new window.Option(describeValue(false), "off"),
  );
}

export interface SiteProfileSelects {
  language: HTMLSelectElement;
  suggestions: HTMLSelectElement;
  inline: HTMLSelectElement;
  preferNativeAutocomplete: HTMLSelectElement;
  codeMode: HTMLSelectElement;
}

export interface SiteProfileGlobals {
  numSuggestions: number;
  inlineSuggestion: boolean;
  preferNativeAutocomplete: boolean;
  codeMode: boolean;
}

export function populateSiteProfileSelects(
  selects: SiteProfileSelects,
  globals: SiteProfileGlobals,
  enabledLanguages: string[],
): void {
  selects.language.replaceChildren();
  appendLanguageOptions(selects.language, enabledLanguages);
  populateSuggestionOptions(selects.suggestions, globals.numSuggestions);
  populateBooleanOverrideOptions(selects.inline, globals.inlineSuggestion, getOnOffLabel);
  populateBooleanOverrideOptions(
    selects.preferNativeAutocomplete,
    globals.preferNativeAutocomplete,
    getPreferNativeAutocompleteLabel,
  );
  populateBooleanOverrideOptions(selects.codeMode, globals.codeMode, getOnOffLabel);
}

/** Shows the profile in the selects; without a profile, shows fallbackLanguage and "global". */
export function applySiteProfileToSelects(
  selects: SiteProfileSelects,
  profile: SiteProfile | undefined,
  fallbackLanguage: string,
): void {
  selects.language.value = profile?.language || fallbackLanguage;
  selects.suggestions.value =
    typeof profile?.numSuggestions === "number" ? String(profile.numSuggestions) : "global";
  selects.inline.value = toOverrideValue(profile?.inline_suggestion);
  selects.preferNativeAutocomplete.value = toOverrideValue(profile?.preferNativeAutocomplete);
  selects.codeMode.value = toOverrideValue(profile?.codeMode);
}

/** Builds a profile from editor select values; "global" (or a missing select) means inherit. */
export function buildSiteProfile(
  language: string,
  overrides: {
    numSuggestions?: string;
    inlineSuggestion?: string;
    preferNativeAutocomplete?: string;
    codeMode?: string;
  },
): SiteProfile {
  const profile: SiteProfile = { language };
  const numSuggestions = parseSuggestionsOverride(overrides.numSuggestions ?? "global");
  if (typeof numSuggestions === "number") {
    profile.numSuggestions = numSuggestions;
  }
  const inlineSuggestion = parseBooleanOverride(overrides.inlineSuggestion ?? "global");
  if (typeof inlineSuggestion === "boolean") {
    profile.inline_suggestion = inlineSuggestion;
  }
  const preferNativeAutocomplete = parseBooleanOverride(
    overrides.preferNativeAutocomplete ?? "global",
  );
  if (typeof preferNativeAutocomplete === "boolean") {
    profile.preferNativeAutocomplete = preferNativeAutocomplete;
  }
  const codeMode = parseBooleanOverride(overrides.codeMode ?? "global");
  if (typeof codeMode === "boolean") {
    profile.codeMode = codeMode;
  }
  return profile;
}
