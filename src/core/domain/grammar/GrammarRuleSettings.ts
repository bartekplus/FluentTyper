import {
  DEFAULT_CURRENT_GRAMMAR_RULES,
  GRAMMAR_RULE_IDS,
  normalizeGrammarRuleSelection,
  type CatalogRuleId,
} from "./ruleCatalog";

export type GrammarRuleOverrides = Record<string, boolean>;

// Frozen inventory from the last array-based settings schema. New rules must not
// be added here: absence for a newly introduced rule means inherit its default.
const LEGACY_RULE_IDS: readonly CatalogRuleId[] = [
  "capitalizeSentenceStart",
  "capitalizeAfterLineBreak",
  "englishPronounICapitalization",
  "englishContractionNormalization",
  "englishTypoWhitelistCorrection",
  "doubleSpaceToPeriod",
  "englishModalOfCorrection",
  "englishYourWelcomeCorrection",
  "englishTheirThereBeVerb",
  "englishAlotCorrection",
  "englishPronounVerbWhitelistAgreement",
  "technicalTokenCompaction",
  "mathOperatorSpacing",
  "slashContextSpacing",
  "openingBracketSpacing",
  "closingBracketSpacing",
  "commaPeriodSpacing",
  "collapseRepeatedSpaces",
  "trimSpaceBeforeLineBreak",
  "neutralPunctuationPolicy",
  "ellipsisShortcut",
  "emdashShortcut",
  "smartQuoteNormalization",
  "duplicatePunctuationCollapse",
  "autoBracketClose",
];

export function isGrammarRuleOverrides(value: unknown): value is GrammarRuleOverrides {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((choice) => typeof choice === "boolean")
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
  const choices =
    value === undefined
      ? {}
      : Array.isArray(value)
        ? migrateLegacyGrammarRuleSelection(value)
        : value;
  if (!isGrammarRuleOverrides(choices)) return [];
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
