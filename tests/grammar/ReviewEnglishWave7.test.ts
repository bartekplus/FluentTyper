import { expect, setSystemTime, test } from "bun:test";
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

// English grammar frames added in the seventh LanguageTool parity wave. All sentences are our own.
// Every supported rule runs; only default-on findings outside style are compared.
function scan(text: string) {
  return detectReviewDiagnostics(
    { id: "wave7", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      lang: "en_US",
      enabledRules: REVIEW_SUPPORTED_RULE_IDS.filter((id) => id !== "englishBritishSpelling"),
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.filter(
    (d) => d.category !== "style" && REVIEW_RULE_METADATA[d.ruleId]?.defaultEnabled,
  );
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
  // Number after a quantity.
  ["I own a lot of car.", "I own a lot of cars."],
  ["We have a number of issue to fix.", "We have a number of issues to fix."],
  ["We met a few week ago.", "We met a few weeks ago."],
  ["It runs on numerous server.", "It runs on numerous servers."],
  ["It took three month.", "It took three months."],
  // An adjective where its adverb belongs.
  ["You simple need a new cable.", "You simply need a new cable."],
  ["I didn't understandable explain it.", "I didn't understandably explain it."],
  // Short slips: be before an -s verb, than after an auxiliary, out for our, between X and I.
  ["The update is creates a log.", "The update creates a log."],
  ["We will than send the invoice.", "We will then send the invoice."],
  ["Please reply to out support desk.", "Please reply to our support desk."],
  ["Keep this between Lena and I.", "Keep this between Lena and me."],
  // Time possessives.
  ["We loved this evenings concert.", "We loved this evening's concert."],
  ["Did you read todays paper?", "Did you read today's paper?"],
  // Compound modifiers before a noun.
  ["She drives a brand new truck.", "She drives a brand-new truck."],
  ["We got some duty free perfume.", "We got some duty-free perfume."],
  ["It was a do or die moment.", "It was a do-or-die moment."],
])("fixes %s", (input, expected) => {
  expect({ input, ...fixed(input) }).toEqual({ input, count: 1, text: expected });
});

test.each([
  "We waited a ten minutes or more package.",
  "It is an a priori argument.",
  "Making plans is easy.",
  "Lots of rice is left.",
  "Beatles was a great band name.",
  "Jets is the word I meant.",
  "The bread and the jam taste great.",
  "Sometimes, the best plan is to wait.",
  "The test plan the team wrote is good.",
  "The car park a block away is full.",
  "Let the dog walk the cat.",
  "We ask that the user restart the app.",
  "God bless you all.",
  "Pls send the file.",
  "The lamp, the desk and the chair need work.",
  "Python test results show the page.",
  "I hope the cats and the dog get along.",
  "The list of things you need is short.",
  "A lot of work is left.",
  "Many question the plan.",
  "Several report that it works.",
  "It is the basis of all life.",
  "All things living need water.",
  "Is the truck brand new?",
  "It serves a dual purpose.",
  "The new look suits you.",
  "It was the first hand I played.",
  "We cold call them often.",
  "You private message the admin.",
  "What it is means a lot to me.",
  "The only answer there is works.",
  "It is more than ever.",
  "We went out shopping.",
  "They threatened to out him.",
  // Precision: pseudo-clefts, letter plurals, stranded prepositions, nouns with an infinitive.
  "All I ask is be on time.",
  "What we need to do is be patient.",
  "Both b's are silent here.",
  "The friends we spoke to said it was fine.",
  "Never let the chance to learn pass you by.",
])("keeps %s", (input) => {
  const found = scan(input).filter((d) => REVIEW_RULE_METADATA[d.ruleId]?.defaultEnabled);
  expect({ input, found: found.map((d) => input.slice(d.range.start, d.range.end)) }).toEqual({
    input,
    found: [],
  });
});

test("optional typography pairs straight quotes on a line of prose", () => {
  const curly = (text: string) =>
    detectReviewDiagnostics(
      { id: "quotes", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      {
        lang: "en_US",
        enabledRules: ["englishTypography"],
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
      },
    ).diagnostics.map((d) => d.alternatives[0].preview);
  expect(curly('She called it "done" twice.')).toEqual(["“", "”"]);
  expect(curly('Buy a 24" monitor and a "good" chair.')).toEqual(["“", "”"]);
  expect(curly('Set name="demo" first.')).toEqual([]);
  expect(curly('Only one "mark here.')).toEqual([]);
});

test("the missing article check is opt-in and offers a/an or the", () => {
  const articles = (text: string) =>
    detectReviewDiagnostics(
      { id: "articles", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      {
        lang: "en_US",
        enabledRules: ["englishMissingArticle"],
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
      },
    ).diagnostics.map((d) => d.alternatives.map((a) => a.preview));
  expect(articles("My cousin is very kind doctor.")).toEqual([
    ["a very kind doctor", "the very kind doctor"],
  ]);
  expect(articles("We waited near bridge.")).toEqual([["a bridge", "the bridge"]]);
  expect(articles("She found umbrella in the car.")).toEqual([["an umbrella", "the umbrella"]]);
  expect(articles("It was such long song.")).toEqual([["such a"]]);
  for (const fine of [
    "I did it by mistake.",
    "For example, we left.",
    "She is at school.",
    "He came in person.",
    "We met in answer to the call.",
    "Life is short.",
  ])
    expect(articles(fine)).toEqual([]);
  expect(REVIEW_RULE_METADATA.englishMissingArticle.defaultEnabled).toBe(false);
});

test("Oxford spelling is opt-in and writes -ize", () => {
  const oxford = (text: string) =>
    detectReviewDiagnostics(
      { id: "oxford", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      {
        lang: "en_US",
        enabledRules: ["englishOxfordSpelling"],
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
      },
    ).diagnostics.map((d) => d.alternatives[0].preview);
  expect(oxford("Our organisation will prioritise the colour scheme.")).toEqual([
    "organization",
    "prioritize",
  ]);
  expect(oxford("We will organize the programme.")).toEqual([]);
  // -ise forms beyond the table, also after a hyphenated prefix; words of their own stay.
  expect(oxford("Is the alloy magnetisable? We de-energise it first.")).toEqual([
    "magnetizable",
    "energize",
  ]);
  expect(oxford("We advertise, then prise the lid open.")).toEqual([]);
  expect(oxford("The word 'organisation' is British.")).toEqual([]);
  expect(REVIEW_RULE_METADATA.englishOxfordSpelling.defaultEnabled).toBe(false);
});

// A weekday next to a date with no year is checked against this year (the clock is fixed).
test("a weekday on a date with no year is this year's", () => {
  setSystemTime(new Date("2031-05-20T12:00:00Z"));
  try {
    const dates = (text: string) =>
      scan(text)
        .filter((d) => d.ruleId === "englishDateConsistency")
        .map((d) => d.alternatives.map((a) => a.preview));
    // 3 June is a Monday in 2030, a Tuesday in 2031 and a Thursday in 2032.
    expect(dates("Workshop: Friday, 3 June")).toEqual([["Tuesday, 3", "Friday, 6"]]);
    expect(dates("Workshop: Tuesday, 3 June")).toEqual([]);
    // Last or next year's weekday: the writer may mean that year.
    expect(dates("Workshop: Thursday, 3 June")).toEqual([]);
    expect(dates("Workshop: Monday, 3 June")).toEqual([]);
    // A year written nearby is the date's year: 3 June 2025 was a Tuesday.
    expect(dates("Back in 2025 we met on Tuesday, 3 June.")).toEqual([]);
    expect(dates("Leave Tuesday, 3 June and return Friday, 6 June 2025.")).toEqual([]);
  } finally {
    setSystemTime();
  }
});

// Worst cases for this wave's frames: every word opens one, or long space runs between.
test("no chunk stalls on runs of this wave's frame words", () => {
  const slowest = (text: string) => {
    const prepared = prepareReview(
      { id: "wave7", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
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
    "Old cars is good. Maria live in Lisbon. ".repeat(500),
    "is good friend at airport such long song have experienced problem ".repeat(500),
    "a lot of car a few week ago is requires than went to out team ".repeat(500),
    `${"x".repeat(3)}${" ".repeat(20_000)}Monday, 7 October "quoted" organisation`,
    'Monday, 7 October "a" "b" energise '.repeat(800),
  ])
    // The first run compiles the frames; the second is the steady state.
    expect(Math.min(slowest(text), slowest(text))).toBeLessThan(100);
});
