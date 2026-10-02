import { expect, test } from "bun:test";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";

// english/fixedFrames.ts: real words slipped into fixed phrases. All sentences are our own.
function scan(text: string): ReviewDiagnostic[] {
  return detectReviewDiagnostics(
    { id: "frames", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishPhraseCorrections");
}
const fixAll = (text: string, ds: ReviewDiagnostic[]) =>
  applyEdits(
    text,
    ds.flatMap((d) => d.alternatives[0].edits),
  );

test.each([
  ["They walked down the isle in June.", "They walked down the aisle in June."],
  ["I am looking foreword to it.", "I am looking forward to it."],
  ["She bought a bran new bike.", "She bought a brand new bike."],
  ["Write for farther details.", "Write for further details."],
  ["We have no excess to the roof.", "We have no access to the roof."],
  ["This is so exiting!", "This is so exciting!"],
  ["It doesn't see to be broken.", "It doesn't seem to be broken."],
  ["Please feel tree to ask.", "Please feel free to ask."],
  ["It is on of the best films.", "It is one of the best films."],
  ["We sell it all over the word.", "We sell it all over the world."],
  ["Do not add salt to injury.", "Do not add insult to injury."],
  ["That job is right in my alley.", "That job is right up my alley."],
  ["On Sundays we do jogging.", "On Sundays we go jogging."],
  ["After school they did soccer.", "After school they played soccer."],
  ["Prices are superior than before.", "Prices are superior to before."],
  ["I will call you today evening.", "I will call you this evening."],
  ["Take it into count, please.", "Take it into account, please."],
  ["She is passionate by music.", "She is passionate about music."],
  ["We finally got rid from it.", "We finally got rid of it."],
  ["He does n't know.", "He doesn't know."],
])("fixes %p", (text, expected) => {
  expect(fixAll(text, scan(text))).toBe(expected);
});

test.each([
  ["Come a long with us.", "Come along with us."],
  ["We found an out of the way inn.", "We found an out-of-the-way inn."],
  ["She is a well known painter.", "She is a well-known painter."],
  ["That plan is do able.", "That plan is doable."],
])("joins or hyphenates %p", (text, expected) => {
  const ds = detectReviewDiagnostics(
    { id: "frames", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: [...REVIEW_SUPPORTED_RULE_IDS],
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => d.ruleId === "englishClosedCompounds");
  expect(fixAll(text, ds)).toBe(expected);
});

test.each([
  "How does jogging help the heart?",
  "The last minute of the game was wild.",
  "Will a god send help?",
  "There was a drop in sales.",
  "Did running make you tired?",
  "We went to Home Depot.",
  "Look, the door is open.",
  "The isle of Skye is lovely.",
  "Excess baggage costs more.",
  "He kept the air apparently clean.",
  "They knocked the door down.",
  "The one I need helps others.",
])("keeps %p", (text) => {
  expect(scan(text)).toEqual([]);
});
