import { expect, test } from "bun:test";
import {
  normalizeReviewRuleOverrides,
  reviewRuleIds,
  reviewRuleSelectionToOverrides,
  REVIEW_SUPPORTED_RULE_IDS,
  REVIEW_RULE_METADATA,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { resolveGrammarRuleSelection } from "../../src/core/domain/grammar/GrammarRuleSettings";

const OPTIONAL_REVIEW_IDS: readonly string[] = [
  "germanAbbreviationSpacing",
  "styleRedundancy",
  "styleLongSentence",
  "ellipsisShortcut",
  "emdashShortcut",
  "primeSymbols",
  "stylePhrasing",
  "styleContractions",
  "styleOxfordComma",
  "styleNoOxfordComma",
  "styleAlternativePhrasing",
  "englishPossibleErrors",
  "englishAmericanSpelling",
  "englishBritishSpelling",
  "styleWordChoice",
  "styleSpelledNumbers",
  "greekStrictFinalNu",
  "greekPunctuation",
  "portugueseTypographyStyle",
  "portugueseAO90",
  "frenchMissingNe",
];
const DEFAULT_REVIEW_IDS = REVIEW_SUPPORTED_RULE_IDS.filter(
  (id) => !OPTIONAL_REVIEW_IDS.includes(id),
);

test("absent Review preferences retain explicit catalog defaults independently of typing", () => {
  expect(reviewRuleIds({ codeMode: false })).toEqual(DEFAULT_REVIEW_IDS);
  expect(normalizeReviewRuleOverrides(undefined)).toEqual({});
  expect(resolveGrammarRuleSelection([])).toEqual([]);
  expect(reviewRuleIds({ codeMode: false })).toContain("englishRepeatedWords");
  for (const id of DEFAULT_REVIEW_IDS)
    expect(REVIEW_RULE_METADATA[id]).toMatchObject({ defaultEnabled: true });
});
test("one choice is sparse, independent and reversible; code mode stays empty", () => {
  const overrides = { englishRepeatedWords: false };
  expect(reviewRuleIds({ codeMode: false, overrides })).toEqual(
    DEFAULT_REVIEW_IDS.filter((id) => id !== "englishRepeatedWords"),
  );
  expect(reviewRuleIds({ codeMode: false, overrides: { englishRepeatedWords: true } })).toContain(
    "englishRepeatedWords",
  );
  expect(
    reviewRuleIds({
      codeMode: true,
      overrides: reviewRuleSelectionToOverrides(REVIEW_SUPPORTED_RULE_IDS),
    }),
  ).toEqual([]);
  expect(reviewRuleIds({ codeMode: false, overrides: {} })).toEqual(DEFAULT_REVIEW_IDS);
});
test("only supported native IDs and boolean choices survive storage validation", () => {
  expect(
    normalizeReviewRuleOverrides({
      englishRepeatedWords: false,
      englishToToo: "true",
      future: true,
      reviewLocalAi: false,
      reviewSpelling: false,
      autoBracketClose: true,
      sentence: "private text",
    }),
  ).toEqual({ englishRepeatedWords: false, englishToToo: false });
  expect(reviewRuleIds({ codeMode: false, overrides: { future: true } })).toEqual(
    DEFAULT_REVIEW_IDS,
  );
  for (const malformed of [null, 42, "sentence", ["englishRepeatedWords"]])
    expect(reviewRuleIds({ codeMode: false, overrides: malformed })).toEqual([]);
});
test("selection serialization and reset never copy typing choices or invalid IDs", () => {
  const saved = reviewRuleSelectionToOverrides([
    "englishRepeatedWords",
    "reviewLocalAi",
    "invented",
  ]);
  expect(Object.keys(saved)).toEqual(REVIEW_SUPPORTED_RULE_IDS);
  expect(reviewRuleIds({ codeMode: false, overrides: saved })).toEqual(["englishRepeatedWords"]);
  expect(reviewRuleIds({ codeMode: false, overrides: reviewRuleSelectionToOverrides([]) })).toEqual(
    [],
  );
  expect(reviewRuleIds({ codeMode: false, overrides: undefined })).toEqual(DEFAULT_REVIEW_IDS);
});
