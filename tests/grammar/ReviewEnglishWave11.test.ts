import { expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { ALL_RULES, scan, slowestChunkMs } from "./reviewHarness";

// English fixes of the eleventh LanguageTool parity wave. All sentences are our own. Every
// supported rule runs.
const review = (text: string) =>
  scan(text, { enabledRules: ALL_RULES }).filter(
    (d) => d.category !== "style" && d.ruleId !== "typographicQuotes",
  );
const fixes = (text: string) =>
  review(text).map((d) => d.alternatives.map((a) => applyEdits(text, a.edits)));

test("a modal question with a person subject offers only the base verb", () => {
  expect(fixes("When will he arrived?")).toEqual([["When will he arrive?"]]);
  expect(review("When will he arrived?")[0].requiresChoice).toBe(true);
  expect(fixes("Can you elaborated on that?")).toEqual([["Can you elaborate on that?"]]);
  // "it" can still lack a passive be.
  expect(fixes("When will it fixed?")).toEqual([["When will it fix?", "When will it be fixed?"]]);
});

test("please between the subject and the verb", () => {
  expect(fixes("Can you please attached the file?")).toEqual([["Can you please attach the file?"]]);
  expect(fixes("Could you please sent me a copy?")).toEqual([["Could you please send me a copy?"]]);
  for (const text of ["Can you please attach the file?", "They will please customers."])
    expect(review(text)).toEqual([]);
});

const REPAIRS: [string, string][] = [
  // A be before a negative auxiliary.
  ["I'm haven't seen the new office.", "I haven't seen the new office."],
  ["She's still doesn't answer her phone.", "She still doesn't answer her phone."],
  ["We were weren't told about it.", "We weren't told about it."],
  // "'s" before a whole clause.
  ["This is the bug that's we are fixing now.", "This is the bug that we are fixing now."],
  ["Tell me what's he is planning.", "Tell me what he is planning."],
  // A negative be that does not agree with its pronoun.
  ["I isn't sure about the plan.", "I am not sure about the plan."],
  ["I know they isn't coming.", "I know they aren't coming."],
  ["Maybe she weren't at work.", "Maybe she wasn't at work."],
  // A count before "old", a double quote for an apostrophe.
  ["My daughter is 7 year old.", "My daughter is 7 years old."],
  ['They"re late again.', "They're late again."],
  ['Anna"s bike is blue.', "Anna's bike is blue."],
  // Punctuation and number compounds.
  ["Why did you leave so early.", "Why did you leave so early?"],
  ["How can we reach the station.", "How can we reach the station?"],
  ["She called it a “quick fix.”.", "She called it a “quick fix.”"],
  ["“Come in,”said the nurse.", "“Come in,” said the nurse."],
  ["We booked a 12 hour flying lesson.", "We booked a 12-hour flying lesson."],
  ["Sam's one day course was full.", "Sam's one-day course was full."],
  // "a" before bit.
  ["I'm bit tired today.", "I'm a bit tired today."],
  ["The soup is little bit cold.", "The soup is a little bit cold."],
  ["We had bit of a delay.", "We had a bit of a delay."],
];

test.each(REPAIRS)("repairs %s", (input, expected) => {
  expect(fixes(input)).toEqual([[expected]]);
  expect(review(expected)).toEqual([]);
});

test.each([
  "What it is isn't clear to anyone.",
  "That's you in the photo, isn't it?",
  "What's your name?",
  "If I weren't so tired, I would come.",
  "I wish she weren't leaving.",
  "He is a 7-year-old boy.",
  "The baby is one day old.",
  "Our needs changed last year.",
  "The project needs funding.",
  'He said "hello"to me.',
  'The "if"s in this plan worry me.',
  "Why is a good question.",
  "How do you do.",
  "He asked why did she go.",
  "When will it be ready, do you think.",
  "It takes one hour to get there.",
  "That one day changed everything.",
  "The motto is always be prepared.",
  "Every little bit helps.",
  "The dog bit too hard.",
  "Where's he come from?",
  "What's that noise?",
  "Is it love?",
  "Are we friends now?",
  "How's it look now?",
  "Is it work or play?",
  // need/want close a relative clause or meet an imperative: no "to" is missing.
  "Tell me anything you need let me check it.",
  "The parts we need arrive on Monday.",
  "The tools she needs cost too much.",
  "If you want help you can call me.",
  "Which room do you want please?",
  "If it is not what you wanted please tell me.",
  // An informal adverb sure, and a comparison that leaves its verb out.
  "I would sure like to see it.",
  "Cats sleep more than dogs would sitting in the sun.",
  "I wrote as fast as I could making notes on the way.",
])("leaves %s", (text) => {
  expect(review(text).filter((d) => d.ruleId !== "quoteSpacing")).toEqual([]);
});

test("a second be and an inverted be offer a choice", () => {
  expect(fixes("She wasn't ever be able to swim.")).toEqual([
    ["She wasn't ever able to swim.", "She won't ever be able to swim."],
  ]);
  expect(fixes("Are we have to pay now?")).toEqual([
    ["Do we have to pay now?", "Are we having to pay now?"],
  ]);
  expect(review("Are we have to pay now?")[0].requiresChoice).toBe(true);
});

test("opt-in introductory commas after a greeting, a reply word and I for one", () => {
  const commas = (text: string) =>
    scan(text, { enabledRules: ["styleIntroductoryComma"] }).map((d) =>
      applyEdits(text, d.alternatives[0].edits),
    );
  expect(commas("Hey there we missed you.")).toEqual(["Hey there, we missed you."]);
  expect(commas("Perfect thanks for the update.")).toEqual(["Perfect, thanks for the update."]);
  expect(commas("I for one agree with her.")).toEqual(["I, for one, agree with her."]);
  for (const text of ["Hi there and welcome.", "Great work today.", "I came for one reason."])
    expect(commas(text)).toEqual([]);
});

test("needs + participle offers the infinitive or the gerund", () => {
  expect(fixes("The fence needs painted.")).toEqual([
    ["The fence needs to be painted.", "The fence needs painting."],
  ]);
  expect(review("The fence needs painted.")[0].requiresChoice).toBe(true);
});

test("opt-in style: comparatives, reason is because, a second please", () => {
  const style = (text: string) =>
    scan(text, { enabledRules: ["stylePhrasing"] }).map((d) =>
      applyEdits(text, d.alternatives[0].edits),
    );
  expect(style("The new menu is more easy to use.")).toEqual(["The new menu is easier to use."]);
  expect(style("Her answer was more clear than mine.")).toEqual([
    "Her answer was clearer than mine.",
  ]);
  expect(style("The reason I called is because the bill is wrong.")).toEqual([
    "The reason I called is that the bill is wrong.",
  ]);
  expect(style("Please close the door, please.")).toEqual(["Please close the door."]);
  expect(style("The view was very very nice.")).toEqual(["The view was very, very nice."]);
  for (const text of [
    "This is more likely to work.",
    "The tool is more robust than before.",
    "We need more cold water.",
    "The reason is mostly cost.",
    "Please check the list and send it.",
    "Can you say please?",
    "The film was so so.",
  ])
    expect(style(text)).toEqual([]);
});

test("no chunk stalls on runs of this wave's frame words", () => {
  const inputs = [
    "please send it and please ".repeat(600),
    "the reason we left is the reason we ".repeat(400),
    "I'm just haven't he was hasn't it's doesn't ".repeat(400),
    "that's we are what's I'm that's you're ".repeat(400),
    "more easy more clear more simple ".repeat(500),
    "my car needs fixed the walls need painted ".repeat(400),
    'We"ll Tom"s wasn"t "if"s '.repeat(600),
    "is 25 year old turned 7 month old ".repeat(400),
    "Why did you go How can we stay What is it ".repeat(400),
    "very very so so far far ".repeat(600),
    "“a.”.”b,”c ".repeat(800),
  ];
  for (const text of inputs)
    expect(Math.min(slowestChunkMs(text), slowestChunkMs(text))).toBeLessThan(100);
});
