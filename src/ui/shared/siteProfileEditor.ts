import { MAX_NUM_SUGGESTIONS } from "@core/domain/constants";
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

export function createSelectOption(value: string, text: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  return option;
}

export function populateSuggestionOptions(
  select: HTMLSelectElement,
  globalNumSuggestions: number,
): void {
  select.replaceChildren(
    createSelectOption("global", getInheritLabel(String(globalNumSuggestions))),
  );
  for (let idx = 0; idx <= MAX_NUM_SUGGESTIONS; idx += 1) {
    select.appendChild(createSelectOption(String(idx), String(idx)));
  }
}

export function populateBooleanOverrideOptions(
  select: HTMLSelectElement,
  globalValue: boolean,
  describeValue: (value: boolean) => string,
): void {
  select.replaceChildren(
    createSelectOption("global", getInheritLabel(describeValue(globalValue))),
    createSelectOption("on", describeValue(true)),
    createSelectOption("off", describeValue(false)),
  );
}

/** Builds a profile from editor select values; "global" (or a missing select) means inherit. */
export function buildSiteProfile(
  language: string,
  overrides: {
    numSuggestions?: string;
    inlineSuggestion?: string;
    preferNativeAutocomplete?: string;
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
  return profile;
}
