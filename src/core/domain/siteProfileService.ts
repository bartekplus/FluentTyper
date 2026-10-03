import { DEFAULT_NUM_SUGGESTIONS, MAX_NUM_SUGGESTIONS } from "./constants";
import { normalizeNumSuggestions } from "./siteProfiles";

export function resolveGlobalNumSuggestions(value: unknown): number {
  return normalizeNumSuggestions(value) ?? DEFAULT_NUM_SUGGESTIONS;
}

export function parseSuggestionsOverride(value: string): number | undefined {
  if (value === "global") {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, parsed));
}

export function parseBooleanOverride(value: string): boolean | undefined {
  if (value === "on") {
    return true;
  }
  if (value === "off") {
    return false;
  }
  return undefined;
}
