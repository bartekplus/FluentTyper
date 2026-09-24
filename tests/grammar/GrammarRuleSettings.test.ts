import { describe, expect, test } from "bun:test";
import {
  grammarRuleSelectionToOverrides,
  isGrammarRuleOverrides,
  LEGACY_RULE_IDS,
  migrateLegacyGrammarRuleSelection,
  resolveGrammarRuleSelection,
} from "../../src/core/domain/grammar/GrammarRuleSettings";
import {
  DEFAULT_CURRENT_GRAMMAR_RULES,
  GRAMMAR_RULE_IDS,
  RECOMMENDED_CURRENT_GRAMMAR_RULES,
  RECOMMENDED_V1_GRAMMAR_RULES,
  RECOMMENDED_V2_GRAMMAR_RULES,
  DEFAULT_V3_GRAMMAR_RULES,
} from "../../src/core/domain/grammar/ruleCatalog";

const DEFAULT_RULES = [
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
  "englishProperNounCapitalization",
  "technicalTokenCompaction",
  "mathOperatorSpacing",
  "measurementUnitFormatting",
  "currencySpacing",
  "slashContextSpacing",
  "openingBracketSpacing",
  "closingBracketSpacing",
  "commaPeriodSpacing",
  "collapseRepeatedSpaces",
  "trimSpaceBeforeLineBreak",
];

const PRE_MEASUREMENT_RULES = [
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
  "ellipsisShortcut",
  "emdashShortcut",
  "smartQuoteNormalization",
  "duplicatePunctuationCollapse",
  "autoBracketClose",
];

describe("GrammarRuleSettings", () => {
  test.each([undefined, {}])("inherits catalog defaults from %j", (stored) => {
    expect(resolveGrammarRuleSelection(stored)).toEqual(DEFAULT_RULES);
  });

  test("preserves explicit off and on overrides", () => {
    expect(
      resolveGrammarRuleSelection({
        capitalizeSentenceStart: false,
        ellipsisShortcut: true,
      }),
    ).toEqual([
      ...DEFAULT_RULES.filter((id) => id !== "capitalizeSentenceStart"),
      "ellipsisShortcut",
    ]);
  });

  test("ignores unknown override ids", () => {
    expect(resolveGrammarRuleSelection({ futureRule: true })).toEqual(DEFAULT_RULES);
  });

  test.each([null, true, "capitalizeSentenceStart", { commaPeriodSpacing: "false" }, [false]])(
    "fails closed for malformed stored value %j",
    (stored) => {
      expect(resolveGrammarRuleSelection(stored)).toEqual([]);
    },
  );

  test("converts a legacy array into explicit pre-measurement choices", () => {
    const migrated = migrateLegacyGrammarRuleSelection([
      "capitalizeFirstLetter",
      "commaPeriodSpacing",
      "unknownRule",
    ]);

    expect(migrated).toEqual(
      Object.fromEntries(
        PRE_MEASUREMENT_RULES.map((id) => [
          id,
          ["capitalizeSentenceStart", "capitalizeAfterLineBreak", "commaPeriodSpacing"].includes(
            id,
          ),
        ]),
      ),
    );
    expect(migrated).not.toHaveProperty("measurementUnitFormatting");
    expect(resolveGrammarRuleSelection(["commaPeriodSpacing"])).toContain(
      "measurementUnitFormatting",
    );
  });

  test("expands legacy aliases when saving an explicit selection", () => {
    const overrides = grammarRuleSelectionToOverrides(["capitalizeFirstLetter"]);
    expect(resolveGrammarRuleSelection(overrides)).toEqual([
      "capitalizeSentenceStart",
      "capitalizeAfterLineBreak",
    ]);
    expect(overrides.measurementUnitFormatting).toBe(false);
  });

  test("creates explicit choices for every current rule", () => {
    const overrides = grammarRuleSelectionToOverrides(["ellipsisShortcut", "unknownRule"]);

    expect(isGrammarRuleOverrides(overrides)).toBe(true);
    expect(overrides.ellipsisShortcut).toBe(true);
    expect(overrides.capitalizeSentenceStart).toBe(false);
    expect(overrides).not.toHaveProperty("unknownRule");
  });

  describe("opt-in ordinal suffix rule", () => {
    const RULE = "englishOrdinalSuffix";

    test("is off on fresh install and after reset", () => {
      expect(resolveGrammarRuleSelection(undefined)).not.toContain(RULE);
      expect(resolveGrammarRuleSelection({})).not.toContain(RULE);
    });

    test("is off after every legacy upgrade path and is not materialized", () => {
      for (const legacy of [
        [],
        ["commaPeriodSpacing"],
        RECOMMENDED_V1_GRAMMAR_RULES,
        RECOMMENDED_V2_GRAMMAR_RULES,
        DEFAULT_V3_GRAMMAR_RULES,
      ]) {
        expect(migrateLegacyGrammarRuleSelection(legacy)).not.toHaveProperty(RULE);
        expect(resolveGrammarRuleSelection(legacy)).not.toContain(RULE);
      }
    });

    test("is not in the recommended preset", () => {
      expect(RECOMMENDED_CURRENT_GRAMMAR_RULES).not.toContain(RULE);
      const overrides = grammarRuleSelectionToOverrides(RECOMMENDED_CURRENT_GRAMMAR_RULES);
      expect(overrides[RULE]).toBe(false);
      expect(resolveGrammarRuleSelection(overrides)).not.toContain(RULE);
    });

    test("saving the inherited defaults records an opt-out, never an opt-in", () => {
      const overrides = grammarRuleSelectionToOverrides(resolveGrammarRuleSelection({}));
      expect(overrides[RULE]).toBe(false);
    });

    test("is on only after an explicit opt-in", () => {
      expect(resolveGrammarRuleSelection({ [RULE]: true })).toContain(RULE);
      expect(
        resolveGrammarRuleSelection(grammarRuleSelectionToOverrides(GRAMMAR_RULE_IDS)),
      ).toContain(RULE);
    });
  });

  describe("upgrade after Disable all", () => {
    test("keeps every rule off, including rules added later", () => {
      const beforeUpgrade = GRAMMAR_RULE_IDS.filter((id) => id !== "currencySpacing");
      const stored = Object.fromEntries(beforeUpgrade.map((id) => [id, false]));
      expect(resolveGrammarRuleSelection(stored)).toEqual([]);
    });

    test("an all-off map covering only the legacy rule inventory is still a disable-all", () => {
      const stored = Object.fromEntries(LEGACY_RULE_IDS.map((id) => [id, false]));
      expect(resolveGrammarRuleSelection(stored)).toEqual([]);
    });

    test("switching off just a couple of rules is not a disable-all", () => {
      const stored = { commaPeriodSpacing: false, mathOperatorSpacing: false };
      expect(resolveGrammarRuleSelection(stored)).toEqual(
        GRAMMAR_RULE_IDS.filter((id) => {
          if (id === "commaPeriodSpacing" || id === "mathOperatorSpacing") return false;
          return DEFAULT_CURRENT_GRAMMAR_RULES.includes(id);
        }),
      );
    });
  });

  describe("retired neutralPunctuationPolicy in stored settings", () => {
    const RETIRED = "neutralPunctuationPolicy";

    test("old stored arrays resolve to the same live rules without it", () => {
      for (const legacy of [
        RECOMMENDED_V1_GRAMMAR_RULES,
        RECOMMENDED_V2_GRAMMAR_RULES,
        DEFAULT_V3_GRAMMAR_RULES,
        ["spacingRule"],
        [RETIRED, "commaPeriodSpacing"],
      ]) {
        const liveIds = legacy.filter((id) => id !== RETIRED);
        const withoutRetired = resolveGrammarRuleSelection(liveIds);
        expect(resolveGrammarRuleSelection(legacy)).toEqual(withoutRetired);
        expect(resolveGrammarRuleSelection(legacy)).not.toContain(RETIRED);
      }
    });

    test("an array holding only the retired rule is not a disable-all", () => {
      // As before its removal: every legacy rule is off, and the rules added
      // since inherit their defaults.
      expect(resolveGrammarRuleSelection([RETIRED])).toEqual(
        DEFAULT_RULES.filter((id) => !LEGACY_RULE_IDS.includes(id as never)),
      );
    });

    test("old override maps ignore it, whichever way it was set", () => {
      for (const choice of [true, false]) {
        expect(resolveGrammarRuleSelection({ [RETIRED]: choice })).toEqual(DEFAULT_RULES);
        expect(
          resolveGrammarRuleSelection({ [RETIRED]: choice, capitalizeSentenceStart: false }),
        ).toEqual(DEFAULT_RULES.filter((id) => id !== "capitalizeSentenceStart"));
      }
    });

    test("a Disable all saved while it existed still disables everything", () => {
      // Written from the catalog of that time: every rule, the retired one included.
      const stored = Object.fromEntries(
        [...GRAMMAR_RULE_IDS, RETIRED].map((id) => [id, false] as const),
      );
      expect(resolveGrammarRuleSelection(stored)).toEqual([]);
      const legacyInventory = Object.fromEntries(
        [...LEGACY_RULE_IDS, RETIRED].map((id) => [id, false] as const),
      );
      expect(resolveGrammarRuleSelection(legacyInventory)).toEqual([]);
      // The array-era "Disable all".
      expect(resolveGrammarRuleSelection([])).toEqual([]);
    });

    test("a Disable all saved after it was retired still disables everything", () => {
      const stored = grammarRuleSelectionToOverrides([]);
      expect(stored).not.toHaveProperty(RETIRED);
      expect(resolveGrammarRuleSelection(stored)).toEqual([]);
    });

    test("an otherwise all-off map with it switched on is not a disable-all", () => {
      const stored = {
        ...Object.fromEntries(LEGACY_RULE_IDS.map((id) => [id, false] as const)),
        [RETIRED]: true,
      };
      expect(resolveGrammarRuleSelection(stored)).toEqual(
        DEFAULT_RULES.filter((id) => !LEGACY_RULE_IDS.includes(id as never)),
      );
    });
  });
});
