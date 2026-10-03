import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "adverbs", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.messageKey === "review_msg_adverb_form");
}

test("an adjective modifying a verb or adjective becomes its -ly adverb", () => {
  for (const [input, expected] of [
    ["It could possible work.", "It could possibly work."],
    ["We tried to easy open the jar.", "We tried to easily open the jar."],
    ["It probable has a simple cause.", "It probably has a simple cause."],
    ["They temporary closed the road.", "They temporarily closed the road."],
    ["I have probable finished it.", "I have probably finished it."],
    ["The page is terrible slow.", "The page is terribly slow."],
    ["The result is possible useful.", "The result is possibly useful."],
    ["It was real nice.", "It was really nice."],
    ["It could possible hurt you.", "It could possibly hurt you."],
    ["We probable should wait.", "We probably should wait."],
    ["It is safer to temporary disable it.", "It is safer to temporarily disable it."],
    ["We could easy run out.", "We could easily run out."],
  ]) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("colours, compounds and predicate adjectives stay silent", () => {
  for (const text of [
    "You could private message me.",
    "We could cold call them.",
    "It is close to perfect now.",
    "The sky is dark blue.",
    "It is simple enough.",
    "This is close to perfect.",
    "Would soft wire work better?",
    "It might be necessary soon.",
    "That would be reasonable based on cost.",
    "The things that were dangerous had to go.",
    "When We Dead Awaken is a play.",
    "He came close to perfect harmony.",
    "It is hard to believe.",
  ])
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
});
