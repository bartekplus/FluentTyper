import { expect, test } from "bun:test";
import {
  REVIEW_RULE_METADATA,
  REVIEW_SUPPORTED_RULE_IDS,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

// English grammar frames added in the seventh LanguageTool parity wave. All sentences are our own.
// Every supported rule runs; only grammar and spelling findings are compared.
function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "wave7", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: REVIEW_SUPPORTED_RULE_IDS.filter((id) => id !== "englishBritishSpelling"),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.category === "grammar" || d.category === "spelling");
}
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

test.each([
  // A coordinated subject keeps its whole span in the fix.
  ["Sam and I going to the park.", "Sam and I are going to the park."],
  // Two articles in a row: one finding drops one.
  ["She has a an idea.", "She has an idea."],
  [
    "After a twenty minutes or so of waiting, we left.",
    "After twenty minutes or so of waiting, we left.",
  ],
  ["Update - this it the same bug as before.", "Update - this is the same bug as before."],
  // Subject-verb agreement: bare plurals, later clause openers, names, verbs with a noun reading.
  ["Old laptops is slow to boot.", "Old laptops are slow to boot."],
  ["Wild geese migrates south.", "Wild geese migrate south."],
  ["Frozen pipes really bursts in winter.", "Frozen pipes really burst in winter."],
  ["Water bills has gone up.", "Water bills have gone up."],
  ["After the storm, the roads was closed.", "After the storm, the roads were closed."],
  [
    "We left early although the trains was on time.",
    "We left early although the trains were on time.",
  ],
  ["The chart show a steady rise.", "The chart shows a steady rise."],
  ["The printer need to be fixed.", "The printer needs to be fixed."],
  ["Maria live in Lisbon.", "Maria lives in Lisbon."],
  ["Netflix offer a free month.", "Netflix offers a free month."],
  ["She live near the coast.", "She lives near the coast."],
  ["He open the shop at nine.", "He opens the shop at nine."],
  ["Oh, these leather boots looks nice.", "Oh, these leather boots look nice."],
])("fixes %s", (input, expected) => {
  expect({ input, ...fixed(input) }).toEqual({ input, count: 1, text: expected });
});

test.each(["We waited a ten minutes or more package.", "It is an a priori argument."])(
  "keeps %s",
  (input) => {
    const found = scan(input).filter((d) => REVIEW_RULE_METADATA[d.ruleId]?.defaultEnabled);
    expect({ input, found: found.map((d) => input.slice(d.range.start, d.range.end)) }).toEqual({
      input,
      found: [],
    });
  },
);
