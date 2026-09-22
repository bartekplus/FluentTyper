import { describe, expect, test } from "bun:test";
import {
  grammarRuleSelectionToOverrides,
  isGrammarRuleOverrides,
  migrateLegacyGrammarRuleSelection,
  resolveGrammarRuleSelection,
} from "../../src/core/domain/grammar/GrammarRuleSettings";

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
  "technicalTokenCompaction",
  "mathOperatorSpacing",
  "measurementUnitFormatting",
  "slashContextSpacing",
  "openingBracketSpacing",
  "closingBracketSpacing",
  "commaPeriodSpacing",
  "collapseRepeatedSpaces",
  "trimSpaceBeforeLineBreak",
  "neutralPunctuationPolicy",
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
  "neutralPunctuationPolicy",
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
});
