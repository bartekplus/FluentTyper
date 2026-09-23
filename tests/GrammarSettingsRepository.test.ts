import { describe, expect, test } from "bun:test";
import { CoreSettingsRepository } from "../src/core/application/repositories/CoreSettingsRepository";
import type { SettingsManager } from "../src/core/application/settingsManager";

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
  "englishOrdinalSuffix",
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

function repositoryWith(value?: unknown): {
  repository: CoreSettingsRepository;
  reads: string[];
} {
  const reads: string[] = [];
  const settings = {
    get: async (key: string) => {
      reads.push(key);
      return value as never;
    },
    getRaw: async (key: string) => {
      reads.push(key);
      return value as never;
    },
  } as unknown as SettingsManager;
  return { repository: new CoreSettingsRepository(settings), reads };
}

describe("CoreSettingsRepository grammar settings", () => {
  test.each([
    [undefined, DEFAULT_RULES],
    [{}, DEFAULT_RULES],
    [{ capitalizeSentenceStart: false }, DEFAULT_RULES.slice(1)],
    [{ ellipsisShortcut: true }, [...DEFAULT_RULES, "ellipsisShortcut"]],
    [
      ["commaPeriodSpacing"],
      ["englishOrdinalSuffix", "measurementUnitFormatting", "commaPeriodSpacing"],
    ],
    [{ unknownRule: true }, DEFAULT_RULES],
    [{ commaPeriodSpacing: "false" }, []],
  ])("resolves stored grammar setting %j to runtime ids", async (stored, expected) => {
    const { repository, reads } = repositoryWith(stored);

    const result: string[] = await repository.getEnabledGrammarRules();

    expect(result).toEqual(expected);
    expect(reads).toEqual(["enabledGrammarRules"]);
  });
});
