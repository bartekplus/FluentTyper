import { expect, test } from "bun:test";
import {
  englishCountNoun,
  englishNounPair,
  englishWordInfo,
} from "../../src/core/domain/grammar/implementations/helpers/EnglishLexicon";
import {
  ENGLISH_MASS_NOUNS,
  MASS_WITH_COUNT_SENSE,
} from "../../src/core/domain/grammar/implementations/helpers/EnglishCountability";
import {
  REVIEW_RULE_METADATA,
  REVIEW_SUPPORTED_RULE_IDS,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { CatalogRuleId } from "../../src/core/domain/grammar/types";

// English checks added in the eighth LanguageTool parity wave: lexicon plurals and countability.
// All sentences are our own. Every supported rule runs; default-on findings outside style count.
function review(text: string, rules: readonly CatalogRuleId[] = REVIEW_SUPPORTED_RULE_IDS) {
  return detectReviewDiagnostics(
    { id: "wave8", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: rules.filter((id) => id !== "englishBritishSpelling"),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics;
}
const scan = (text: string) =>
  review(text).filter(
    (d) => d.category !== "style" && REVIEW_RULE_METADATA[d.ruleId]?.defaultEnabled,
  );
const fixed = (text: string) => {
  const found = scan(text);
  return {
    count: found.length,
    text: applyEdits(
      text,
      found.flatMap((d) => d.alternatives[0]?.edits ?? []),
    ),
  };
};

test("the lexicon reads plurals the dictionary does not flag, and long plain nouns", () => {
  expect(englishNounPair("month")).toEqual({ singular: "month", plural: "months" });
  expect(englishNounPair("things")).toEqual({ singular: "thing", plural: "things" });
  expect(englishNounPair("lives")).toEqual({ singular: "life", plural: "lives" });
  expect(englishWordInfo("shelves")?.plural).toBe(true);
  expect(englishWordInfo("session")?.noun).toBe(true);
  expect(englishWordInfo("standards")?.plural).toBe(true);
});

test("count nouns come from the n-grams; authored mass nouns never count", () => {
  for (const noun of ["ball", "message", "guy", "question", "week"])
    expect({ noun, count: englishCountNoun(noun) }).toEqual({ noun, count: true });
  for (const noun of ["time", "advice", "information", "work", "money"])
    expect({ noun, count: englishCountNoun(noun) }).toEqual({ noun, count: false });
  expect(ENGLISH_MASS_NOUNS.size).toBeGreaterThan(280);
  for (const noun of MASS_WITH_COUNT_SENSE) expect(ENGLISH_MASS_NOUNS.has(noun)).toBe(true);
});

test.each([
  // A/an before a mass noun behind adjectives.
  ["A cheap accommodation is hard to find.", "Cheap accommodation is hard to find."],
  ["They sprayed a colorful graffiti on it.", "They sprayed colorful graffiti on it."],
  ["She gave us an useful information.", "She gave us useful information."],
  // Count words before a mass noun, with adjectives or a coordinated noun after it.
  ["We sell many cheap luggage.", "We sell much cheap luggage."],
  ["They drink many wine and beer.", "They drink much wine and beer."],
  ["He eats as many food as I do.", "He eats as much food as I do."],
  ["There is few traffic today.", "There is little traffic today."],
  // Count words before a singular count noun.
  ["We found many bug in the code.", "We found many bugs in the code."],
  ["A few week ago, we moved.", "A few weeks ago, we moved."],
  ["There are three kind of tests.", "There are three kinds of tests."],
  // A coordinated object with I.
  ["She sat down with Ben and I and talked.", "She sat down with Ben and me and talked."],
  ["Call Rita or I if you need help.", "Call Rita or me if you need help."],
  ["Please invite Lena and I.", "Please invite Lena and me."],
  ["If you ask Omar and I, it works.", "If you ask Omar and me, it works."],
])("fixes %s", (input, expected) => {
  expect({ input, ...fixed(input) }).toEqual({ input, count: 1, text: expected });
});

test.each([
  "She has a deep respect for her teachers.",
  "It is a food and drink company.",
  "They sell many wine and cheese baskets.",
  "We met at a few music festivals.",
  'A few low budget "Road Trip" films came out.',
  "Many vote in the spring election.",
  "Cholera killed an estimated tens of millions.",
  "He scored an innings of fifty.",
  "One of the battery powered lamps broke.",
  "We can fit one more smaller box.",
  "There is sometimes a delay.",
  "I bought one of these yesterday.",
  "Do you grammar check your essays?",
  "Allow the cake to stand overnight.",
  "You need to password to log in.",
  "The cost of\nthe repairs looks high.",
  "Economic might matters.",
  "We won a prize yesterday.",
  "Lots of rice is left.",
  "The team showed a lot of spark.",
  "I think Tom and I should go.",
  "Then came Tom and I.",
  "When Kim and I arrived, we ate.",
  "We need to monitor the server.",
  "I want to partner with you.",
])("keeps %s", (input) => {
  expect({ input, found: scan(input).map((d) => d.original) }).toEqual({ input, found: [] });
});

test("to + a derived noun before an object is a warning without a fix", () => {
  const found = scan("We need to priority the climate work.");
  expect(found.map((d) => [d.original, d.alternatives.length])).toEqual([["to priority", 0]]);
});

test("a lot of + a lexicon count noun is an opt-in possible error", () => {
  const text = "She knows a lot of guy.";
  expect(scan(text)).toEqual([]);
  const found = review(text, ["englishPossibleErrors"]);
  expect(found.map((d) => [d.ruleId, d.original])).toEqual([["englishPossibleErrors", "guy"]]);
  expect(applyEdits(text, found[0].alternatives[0].edits)).toBe("She knows a lot of guys.");
});

test("the opt-in missing article reads lexicon count nouns after be and an adjective", () => {
  const found = review("Our coach is great runner.", ["englishMissingArticle"]);
  expect(found.map((d) => d.original)).toEqual(["great runner"]);
  expect(review("We sat in quiet park.", ["englishMissingArticle"])).toEqual([]);
});

test("no chunk stalls on runs of this wave's frame words", () => {
  const slowest = (text: string) => {
    const prepared = prepareReview(
      { id: "wave8", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      {
        lang: "en_US",
        enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
      },
    );
    let ms = 0;
    for (const chunk of reviewChunks(prepared)) {
      const start = performance.now();
      scanReviewChunk(prepared, chunk);
      ms = Math.max(ms, performance.now() - start);
    }
    return ms;
  };
  for (const text of [
    "a nice a good a cheap luggage many few several wine ".repeat(500),
    "a lot of ball a bunch of guy is great runner ".repeat(500),
  ])
    expect(Math.min(slowest(text), slowest(text))).toBeLessThan(100);
});
