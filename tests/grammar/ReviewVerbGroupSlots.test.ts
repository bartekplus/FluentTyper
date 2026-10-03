import { expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";

const RULES = new Set([
  "englishPerfectParticiples",
  "englishAuxiliaryBaseVerb",
  "englishSentenceStructure",
]);
function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "verbs", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: reviewRuleIds({ codeMode: false }),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter((d) => RULES.has(d.ruleId));
}

test("a verb group's second verb takes the form its auxiliary needs", () => {
  for (const [input, expected] of [
    ["She has already decide.", "She has already decided."],
    ["We could have avoid it.", "We could have avoided it."],
    ["The parcel was deliver yesterday.", "The parcel was delivered yesterday."],
    ["It can be install by anyone.", "It can be installed by anyone."],
    ["The letter got lose by the courier.", "The letter got lost by the courier."],
    ["He did went home.", "He did go home."],
    ["Which one would you bought?", "Which one would you buy?"],
    ["She is always goes there.", "She always goes there."],
    ["I seen him yesterday.", "I have seen him yesterday."],
    ["You could been hurt.", "You could have been hurt."],
    ["We have was here before.", "We have been here before."],
    ["Where have they were all day?", "Where have they been all day?"],
    ["She has writes the letter.", "She has written the letter."],
    ["When was it deliver?", "When was it delivered?"],
    ["Our choir has often sang carols.", "Our choir has often sung carols."],
    ["The tide has rose already.", "The tide has risen already."],
    // A noun-or-verb base: an aspect adverb, a preposition and its pronoun, or "that" + noun.
    ["It has often snow in May.", "It has often snowed in May."],
    ["They have already hire three cooks.", "They have already hired three cooks."],
    ["She has shout at us twice.", "She has shouted at us twice."],
    ["I have chat with them online.", "I have chatted with them online."],
    ["We have watch that show twice.", "We have watched that show twice."],
    ["I have like him since school.", "I have liked him since school."],
    ["She did jogged to the lake.", "She did jog to the lake."],
    ["It did happened again.", "It did happen again."],
  ]) {
    const found = scan(input);
    expect({ input, count: found.length }).toEqual({ input, count: 1 });
    expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
    expect(scan(expected)).toEqual([]);
  }
});

test("possession, clefts, lexical do and predicates stay silent", () => {
  for (const text of [
    "All you need to do is install the app.",
    "What it does matters most.",
    "I have work tomorrow.",
    "We have dinner at six.",
    "I have class the next day.",
    "Let it be.",
    "He had better leave.",
    "I have put it away.",
    "They have read it.",
    "Whatever it is seems fine.",
    "Get help now.",
    "She did testing for a show.",
    "Why did related plants grow?",
    "Have Tom and I done enough?",
    "Have them call me.",
    "I have to polish my essay.",
    "The room we had was tiny.",
    "All they have are photos.",
    'The "extras" we have are free.',
    "She has needs that matter.",
    "He has kids my age.",
    "The heater I have has a timer.",
    "Is it time to go?",
    "Is it work or play?",
    "We weren't awake.",
    "The results you get depend on the input.",
    "The cans I have do not fit.",
    "His age was wrong by ten years.",
    "You should have write access.",
    "Be home by ten.",
    "Have Tom report to me at once.",
    "I have never time for chess.",
    "We have word that rain is coming.",
    "We have room for them.",
    "I have change for you.",
    "They did needed repairs on the roof.",
    "She did advanced drills.",
  ])
    expect({ text, found: scan(text).map((d) => d.original) }).toEqual({ text, found: [] });
});
