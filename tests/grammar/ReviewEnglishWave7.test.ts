import { expect, test } from "bun:test";
import {
  REVIEW_RULE_METADATA,
  REVIEW_SUPPORTED_RULE_IDS,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
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
  // Participles after have and be.
  ["The clerk has wave at us.", "The clerk has waved at us."],
  ["Prices have climb so quickly.", "Prices have climbed so quickly."],
  ["We should have plant, but it rained.", "We should have planted, but it rained."],
  [
    "The form can't be submit because it is empty.",
    "The form can't be submitted because it is empty.",
  ],
  ["I am so use to waiting.", "I am so used to waiting."],
  // it's for its.
  ["The club and it's players won.", "The club and its players won."],
  ["When it's lid is open, the light turns on.", "When its lid is open, the light turns on."],
  ["We should replace it's filter.", "We should replace its filter."],
  ["For all it's charm, the hotel was cold.", "For all its charm, the hotel was cold."],
  ["But it's main rival seems stronger.", "But its main rival seems stronger."],
  ["These are people who's homes flooded.", "These are people whose homes flooded."],
  // A tag after a positive clause.
  ["We play on Sundays, aren't we?", "We play on Sundays, don't we?"],
  ["It is cold, doesn't it?", "It is cold, isn't it?"],
  ["She sang well, wasn't she?", "She sang well, didn't she?"],
  // A missing to.
  ["The plumber needs bring a new valve.", "The plumber needs to bring a new valve."],
  ["Could you try use another browser?", "Could you try to use another browser?"],
  ["We want win badly.", "We want to win badly."],
  ["Send the invoice to Rita or myself.", "Send the invoice to Rita or me."],
  // Quantified and coordinated subjects.
  ["Each of the rooms have a balcony.", "Each of the rooms has a balcony."],
  ["The number of orders have doubled.", "The number of orders has doubled."],
  ["Both of them likes jazz.", "Both of them like jazz."],
  ["My aunt and her husband owns a farm.", "My aunt and her husband own a farm."],
  ["Does cats like milk?", "Do cats like milk?"],
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
  "I made dinner for Tom and myself.",
  "A number of guests have left.",
  "Rock and roll is loud.",
  "Our cats and their kittens play all day.",
  // Precision: pseudo-clefts, letter plurals, stranded prepositions, nouns with an infinitive.
  "All I ask is be on time.",
  "What we need to do is be patient.",
  "Both b's are silent here.",
  "The friends we spoke to said it was fine.",
  "Never let the chance to learn pass you by.",
  "I have change for a ten.",
  "We have interest in the project.",
  "Who do I have review the contract?",
  "The best bet may be gold.",
  "It will be fun.",
  "It's beans on toast tonight.",
  "I think it's money well spent.",
  "It's time we left.",
  "Pretend it's dinner for two.",
  "I hope it's nobody we know.",
  "It's water under the bridge.",
  "The file is fine, but it's password protected.",
  "Everybody who's anybody came.",
  "She's got a plan, hasn't she?",
  "You both know the answer, don't you?",
  "We were early, weren't we?",
  "It's possible demand is low.",
])("keeps %s", (input) => {
  const found = scan(input).filter((d) => REVIEW_RULE_METADATA[d.ruleId]?.defaultEnabled);
  expect({ input, found: found.map((d) => input.slice(d.range.start, d.range.end)) }).toEqual({
    input,
    found: [],
  });
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
