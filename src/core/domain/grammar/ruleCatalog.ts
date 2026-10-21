import type { GrammarRuleCatalogEntry, GrammarRuleId } from "./types";
import { CATALOG as GENERATED_CATALOG, EXCLUSIVE_GROUPS } from "./engine/catalog.generated";

/**
 * The catalog is declared in grammar/rules/*.yaml (`checks`, in display order) and compiled
 * by scripts/compile-grammar-rules.ts.
 */
const CATALOG = GENERATED_CATALOG;

/** Every catalog rule id: the typing rules (GrammarRuleId) and the Review-only checks. */
export type CatalogRuleId = (typeof CATALOG)[number]["id"];

/**
 * Opposite rules: each one undoes the fix of the others, so only one rule of a group can be on.
 * Review keeps the first enabled rule of a group in catalog order.
 */
export const EXCLUSIVE_RULE_GROUPS: readonly (readonly CatalogRuleId[])[] = EXCLUSIVE_GROUPS;

/** The other rules of `ruleId`'s exclusive group; none when it is in no group. */
export function exclusiveRivals(ruleId: string): readonly CatalogRuleId[] {
  const group = EXCLUSIVE_RULE_GROUPS.find((ids) => ids.includes(ruleId as CatalogRuleId)) ?? [];
  return group.filter((id) => id !== ruleId);
}

export const GRAMMAR_RULE_CATALOG: readonly (GrammarRuleCatalogEntry & { id: CatalogRuleId })[] =
  CATALOG;

export const TYPING_RULE_CATALOG = GRAMMAR_RULE_CATALOG.filter(
  (
    entry,
  ): entry is Extract<GrammarRuleCatalogEntry, { typing?: undefined }> & {
    id: GrammarRuleId;
  } => entry.typing !== false,
);

export const TYPING_RULE_IDS = TYPING_RULE_CATALOG.map((entry) => entry.id);

export const GRAMMAR_RULE_IDS: CatalogRuleId[] = GRAMMAR_RULE_CATALOG.map((entry) => entry.id);

// Historical snapshots below are exact stored values, compared against real
// stored settings by the V4-V6 migrations. They may name retired rules
// ("neutralPunctuationPolicy"), so they are plain strings, never edited.
export const RECOMMENDED_V1_GRAMMAR_RULES: string[] = [
  "capitalizeSentenceStart",
  "capitalizeAfterLineBreak",
  "technicalTokenCompaction",
  "mathOperatorSpacing",
  "slashContextSpacing",
  "openingBracketSpacing",
  "closingBracketSpacing",
  "commaPeriodSpacing",
  "collapseRepeatedSpaces",
  "trimSpaceBeforeLineBreak",
  "neutralPunctuationPolicy",
];

// This is the pre-v3 recommended set (current users migrated by V5).
export const RECOMMENDED_V2_GRAMMAR_RULES: string[] = [
  ...RECOMMENDED_V1_GRAMMAR_RULES.slice(0, 2),
  "englishPronounICapitalization",
  "englishContractionNormalization",
  "englishTypoWhitelistCorrection",
  ...RECOMMENDED_V1_GRAMMAR_RULES.slice(2),
];

// Historical snapshots used by V6 migration. Keep these exact when the live catalog grows.
export const DEFAULT_V3_GRAMMAR_RULES: string[] = [
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
];

export const DEFAULT_CURRENT_GRAMMAR_RULES: CatalogRuleId[] = TYPING_RULE_CATALOG.filter(
  (entry) => entry.defaultRollout === "on",
).map((entry) => entry.id);

const CODE_SAFE_RULE_IDS: ReadonlySet<string> = new Set(
  GRAMMAR_RULE_CATALOG.filter((entry) => entry.codeSafe).map((entry) => entry.id),
);

export function isCodeSafeGrammarRule(ruleId: string): boolean {
  return CODE_SAFE_RULE_IDS.has(ruleId);
}

const LEGACY_RULE_MAP: Record<string, CatalogRuleId[]> = {
  spacingRule: [
    "commaPeriodSpacing",
    "openingBracketSpacing",
    "closingBracketSpacing",
    "slashContextSpacing",
    "mathOperatorSpacing",
    "technicalTokenCompaction",
  ],
  capitalizeFirstLetter: ["capitalizeSentenceStart", "capitalizeAfterLineBreak"],
};

export function isCatalogRuleId(value: string): value is CatalogRuleId {
  return GRAMMAR_RULE_IDS.includes(value as CatalogRuleId);
}

export function normalizeGrammarRuleSelection(selection: unknown): CatalogRuleId[] {
  const selected = Array.isArray(selection) ? selection.map((item) => String(item)) : [];
  const expanded: CatalogRuleId[] = [];

  for (const ruleId of selected) {
    if (isCatalogRuleId(ruleId)) {
      expanded.push(ruleId);
      continue;
    }

    const mapped = LEGACY_RULE_MAP[ruleId];
    if (mapped) {
      expanded.push(...mapped);
    }
  }

  const unique = new Set(expanded);
  return TYPING_RULE_IDS.filter((id) => unique.has(id));
}
