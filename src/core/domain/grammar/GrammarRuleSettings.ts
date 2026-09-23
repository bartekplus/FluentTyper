import { isObjectRecord } from "../guards";
import {
  DEFAULT_CURRENT_GRAMMAR_RULES,
  DEFAULT_V3_GRAMMAR_RULES,
  GRAMMAR_RULE_IDS,
  normalizeGrammarRuleSelection,
  type CatalogRuleId,
} from "./ruleCatalog";

export type GrammarRuleOverrides = Record<string, boolean>;

// Frozen inventory from the last array-based settings schema. New rules must not
// be added here: absence for a newly introduced rule means inherit its default.
// Also the lower bound for detecting "Disable all": every rule stored here has
// existed since before any override map could have opted every rule out at once.
export const LEGACY_RULE_IDS: readonly CatalogRuleId[] = [
  ...DEFAULT_V3_GRAMMAR_RULES,
  "ellipsisShortcut",
  "emdashShortcut",
  "smartQuoteNormalization",
  "duplicatePunctuationCollapse",
  "autoBracketClose",
];

export function isGrammarRuleOverrides(value: unknown): value is GrammarRuleOverrides {
  return (
    isObjectRecord(value) && Object.values(value).every((choice) => typeof choice === "boolean")
  );
}

export function migrateLegacyGrammarRuleSelection(
  value: unknown,
): GrammarRuleOverrides | undefined {
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) return undefined;
  const selected = new Set(normalizeGrammarRuleSelection(value));
  return Object.fromEntries([
    ...LEGACY_RULE_IDS.map((id) => [id, selected.has(id)] as const),
    ...[...selected].map((id) => [id, true] as const),
  ]);
}

export function resolveGrammarRuleSelection(value: unknown): CatalogRuleId[] {
  // A legacy empty array ("Disable all") means every rule was off, including
  // ones added since. Treat it the same as an override map that explicitly
  // turns every known rule off: don't let new rules inherit their default.
  if (Array.isArray(value) && value.length === 0) return [];
  const choices =
    value === undefined
      ? {}
      : Array.isArray(value)
        ? migrateLegacyGrammarRuleSelection(value)
        : value;
  if (!isGrammarRuleOverrides(choices)) return [];
  // "Disable all" writes every rule known at the time as false. An ordinary
  // partial override (a user switching off one or two rules) only ever names
  // the rules it touches, so only treat the map as a disable-all once it's
  // explicit about every rule that has ever existed: comprehensive over
  // LEGACY_RULE_IDS, and false throughout.
  const isExplicitDisableAll =
    LEGACY_RULE_IDS.every((id) => choices[id] === false) &&
    Object.values(choices).every((choice) => choice === false);
  if (isExplicitDisableAll) return [];
  return GRAMMAR_RULE_IDS.filter((id) => {
    const explicit = Object.hasOwn(choices, id) ? choices[id] : undefined;
    return explicit ?? DEFAULT_CURRENT_GRAMMAR_RULES.includes(id);
  });
}

/** Presets explicitly choose every currently known rule; future rules inherit defaults. */
export function grammarRuleSelectionToOverrides(
  selection: readonly string[],
): GrammarRuleOverrides {
  const selected = new Set(normalizeGrammarRuleSelection(selection));
  return Object.fromEntries(GRAMMAR_RULE_IDS.map((id) => [id, selected.has(id)]));
}
