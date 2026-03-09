import { DEFAULT_NUM_SUGGESTIONS, MAX_NUM_SUGGESTIONS } from "./constants";

export function resolveGlobalNumSuggestions(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_NUM_SUGGESTIONS;
  }
  return Math.min(MAX_NUM_SUGGESTIONS, Math.max(0, Math.round(value)));
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

export function parseInlineOverride(value: string): boolean | undefined {
  return parseBooleanOverride(value);
}

export function parsePreferNativeAutocompleteOverride(value: string): boolean | undefined {
  return parseBooleanOverride(value);
}

function parseBooleanOverride(value: string): boolean | undefined {
  if (value === "on") {
    return true;
  }
  if (value === "off") {
    return false;
  }
  return undefined;
}
