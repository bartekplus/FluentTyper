import { DEFAULT_NUM_SUGGESTIONS } from "./constants";
import { normalizeNumSuggestions } from "./siteProfiles";

export function resolveGlobalNumSuggestions(value: unknown): number {
  return normalizeNumSuggestions(value) ?? DEFAULT_NUM_SUGGESTIONS;
}

export function parseSuggestionsOverride(value: string): number | undefined {
  return value === "global" ? undefined : normalizeNumSuggestions(Number.parseInt(value, 10));
}

export function parseBooleanOverride(value: string): boolean | undefined {
  return value === "on" ? true : value === "off" ? false : undefined;
}
