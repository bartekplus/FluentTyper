import { describe, expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/ruleCatalog";
import type { PreferredTerm } from "../../src/core/domain/grammar/review/preferredTerminology";
import { lineStart, sentenceStart } from "./reviewLanguageFixtures/capitalization";
import {
  commaPeriodSpacing,
  duplicatePunctuation,
  quoteSpacing,
  repeatedSpaces,
} from "./reviewLanguageFixtures/punctuation";
import { currency, measurement } from "./reviewLanguageFixtures/measurement";
import {
  TERMINOLOGY_ENTRIES,
  canonicalCasing,
  longSentence,
  repeatedWords,
  terminology,
  unclosedQuotation,
} from "./reviewLanguageFixtures/words";
import { MATRIX_LANGUAGES, type RuleFixtures } from "./reviewLanguageFixtures/types";
import { scan } from "./reviewHarness";

/** Every rule Review runs in every supported language, with its fixtures. */
const MATRIX: Array<[CatalogRuleId, RuleFixtures]> = [
  ["capitalizeSentenceStart", sentenceStart],
  ["capitalizeAfterLineBreak", lineStart],
  ["commaPeriodSpacing", commaPeriodSpacing],
  ["collapseRepeatedSpaces", repeatedSpaces],
  ["duplicatePunctuationCollapse", duplicatePunctuation],
  ["quoteSpacing", quoteSpacing],
  ["measurementUnitFormatting", measurement],
  ["currencySpacing", currency],
  ["preferredTerminology", terminology],
  ["englishRepeatedWords", repeatedWords],
  ["englishCanonicalCasing", canonicalCasing],
  ["unclosedQuotation", unclosedQuotation],
  ["styleLongSentence", longSentence],
];

function findings(ruleId: CatalogRuleId, text: string, lang: string) {
  return scan(text, {
    enabledRules: [ruleId],
    lang,
    longSentenceWords: 12,
    preferredTerminology: {
      version: 1,
      enabled: true,
      entries: TERMINOLOGY_ENTRIES as PreferredTerm[],
    },
  }).filter((d) => d.ruleId === ruleId);
}

/** The text with every finding's first alternative applied. */
function repaired(ruleId: CatalogRuleId, text: string, lang: string): string | null {
  const edits = findings(ruleId, text, lang).flatMap((d) => d.alternatives[0]?.edits ?? []);
  return applyEdits(text, edits);
}

describe.each(MATRIX)("%s", (ruleId, fixtures) => {
  test.each([...MATRIX_LANGUAGES])("%s: at least 5 positives and 5 tricky negatives", (lang) => {
    expect(fixtures[lang].pos.length).toBeGreaterThanOrEqual(5);
    expect(fixtures[lang].neg.length).toBeGreaterThanOrEqual(5);
  });
  for (const lang of MATRIX_LANGUAGES) {
    test.each(fixtures[lang].pos)(`${lang} flags %p`, (input, expected) => {
      if (expected === null) expect(findings(ruleId, input, lang).length).toBeGreaterThan(0);
      else expect(repaired(ruleId, input, lang)).toBe(expected);
    });
    test.each(fixtures[lang].neg)(`${lang} keeps %p`, (input) => {
      expect(findings(ruleId, input, lang).map((d) => d.original)).toEqual([]);
    });
  }
});
