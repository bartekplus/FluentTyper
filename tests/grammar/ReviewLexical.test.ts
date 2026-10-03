import { expect, test } from "bun:test";
import {
  englishListedNoun,
  englishListedWithoutPlural,
} from "../../src/core/domain/grammar/implementations/helpers/EnglishLexicon";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { scan, ALL_RULES } from "./reviewHarness";

// Lexicon-backed checks of english/lexical.ts. All sentences are our own.
const RULES = new Set([
  "englishIrregularForms",
  "englishPossessiveNouns",
  "englishAlotCorrection",
  "englishYourYouAre",
  "styleRedundancy",
]);
function review(text: string) {
  return scan(text, { enabledRules: ALL_RULES }).filter((d) => RULES.has(d.ruleId));
}

const positives = [
  // Regularized irregular verbs, past or participle by the word before.
  ["Yesterday I eated two apples.", "Yesterday I ate two apples."],
  ["She has writed three letters.", "She has written three letters."],
  ["We runned to the station.", "We ran to the station."],
  ["They digged a hole and sleeped there.", "They dug a hole and slept there."],
  // Regularized irregular plurals, from the table and from the dictionary's spellings.
  ["The childs are asleep.", "The children are asleep."],
  ["Two womans waved at us.", "Two women waved at us."],
  ["The thiefs ran off.", "The thieves ran off."],
  ["Grandma baked three meatloafs.", "Grandma baked three meatloaves."],
  ["The kittys chased a moth.", "The kitties chased a moth."],
  ["Our heros saved the day.", "Our heroes saved the day."],
  ["The volcanos erupted.", "The volcanoes erupted."],
  ["The shelfs were empty.", "The shelves were empty."],
  // Possessive nouns: owned noun before its verb, after a preposition, after "a".
  ["The dogs collar was too tight.", "The dog's collar was too tight."],
  ["My neighbors fence is falling apart.", "My neighbor's fence is falling apart."],
  ["We sat in the teachers lounge.", "We sat in the teacher's lounge."],
  ["She bought a farmers almanac.", "She bought a farmer's almanac."],
  ["The children shoes were muddy.", "The children's shoes were muddy."],
  ["We watched the dancers performance.", "We watched the dancer's performance."],
  // Misplaced, extra and missing spaces.
  ["Thec at slept.", "The cat slept."],
  ["Sometimes the doo ris locked.", "Sometimes the door is locked."],
  ["Put the bo xon the table.", "Put the box on the table."],
  ["That approach was he retofore untested.", "That approach was heretofore untested."],
  ["We can try thisinstead of waiting.", "We can try this instead of waiting."],
  // "You" before a lone noun.
  ["You mixture of charm and wit.", "Your mixture of charm and wit."],
  // A shouted acronym pair.
  ["WHERE IS THE VIN NUMBER?", "WHERE IS THE VIN?"],
] as const;

test.each(positives)("lexical check repairs %s", (text, expected) => {
  const findings = review(text);
  expect(findings.length).toBeGreaterThan(0);
  expect(
    applyEdits(
      text,
      findings.flatMap((d) => d.alternatives[0].edits),
    ),
  ).toBe(expected);
});

test("possessive and plural findings offer both readings", () => {
  const owner = review("The dogs collar was too tight.")[0];
  expect(owner.alternatives.map((a) => a.preview)).toEqual(["dog's", "dogs'"]);
  expect(owner.requiresChoice).toBe(true);
  expect(review("The childs are asleep.")[0].alternatives.map((a) => a.preview)).toEqual([
    "children",
    "child's",
  ]);
  expect(review("You mixture of charm and wit.")[0].alternatives.map((a) => a.preview)).toEqual([
    "Your",
    "You're a",
  ]);
});

const negatives = [
  // Dictionary plurals and variants, names and mentions.
  "The shamans danced all night.",
  "Our beliefs differ.",
  "The malformed finded token is a test case.",
  "He kneeled by the fire.",
  "The Germans won.",
  "The invoice is pro forma until we sign.",
  "Match ~iscontent tokens in the log.",
  "We ran past the photos and studios.",
  // Plural modifiers, clauses and double objects.
  "The sales team met on Monday.",
  "The dogs bark at night.",
  "What the students need is more time.",
  "All the kids want is cake.",
  "We gave the kids homework.",
  "The settings page is empty.",
  "I talked to the students yesterday.",
  "The kids she met were friendly.",
  "The players all agreed.",
  "The physics teacher was late.",
  "Since the guests arrive late, we wait.",
  // Words of their own beside an unknown one, and deliberate compounds.
  "He learnt it quickly.",
  "We had lessons in the hall.",
  "It ran like an overwound clock.",
  "Our onboarding flow is long.",
  "Offences against the law.",
  // Closed compounds the lexicon lacks stay with dictionary spelling; a capitalized one is a name.
  "The rainforests shelter rare zebrafish and crawfish.",
  "Our homeschool group meets in the roadstead cafe.",
  "Haslam signed the contract.",
  // A dropped "had" and a bare "not" are no agreement errors with a non-word fix.
  "It better be ready by noon.",
  "He not ready yet.",
  // "You" before plurals and verbs.
  "You guys of all people.",
  "You fool of a man.",
  // Acronym plurals and title case stay as they are.
  "Keep your PINs safe.",
  "Check the VIN Number.",
];

test.each(negatives)("lexical checks stay silent: %s", (text) => {
  expect(review(text)).toEqual([]);
});

test("the user dictionary protects a word", () => {
  const text = "Two womans waved at us.";
  const findings = scan(text, { enabledRules: ALL_RULES, userDictionary: ["womans"] }).filter((d) =>
    RULES.has(d.ruleId),
  );
  expect(findings).toEqual([]);
});

test("long plain dictionary nouns are known, and their plural marks are exact", () => {
  expect(englishListedNoun("student")).toBe("singular");
  expect(englishListedNoun("students")).toBe("plural");
  expect(englishListedNoun("thisinstead")).toBe(null);
  expect(englishListedWithoutPlural("punctuation")).toBe(true);
  expect(englishListedWithoutPlural("student")).toBe(false);
  // The plural the n-grams show and a -ves plural count as plurals.
  expect(englishListedWithoutPlural("villager")).toBe(false);
  expect(englishListedWithoutPlural("meatloaf")).toBe(false);
});
