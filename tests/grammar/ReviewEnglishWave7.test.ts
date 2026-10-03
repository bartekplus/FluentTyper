import { expect, setSystemTime, test } from "bun:test";
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
  "Google search results show the page.",
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
])("keeps %s", (input) => {
  const found = scan(input).filter((d) => REVIEW_RULE_METADATA[d.ruleId]?.defaultEnabled);
  expect({ input, found: found.map((d) => input.slice(d.range.start, d.range.end)) }).toEqual({
    input,
    found: [],
  });
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
