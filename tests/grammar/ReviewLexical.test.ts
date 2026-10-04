import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deriveEnglishLexicon, LEXICON_SOURCES } from "../../scripts/generate-english-lexicon";
import {
  englishListedNoun,
  englishListedWithoutPlural,
} from "../../src/core/domain/grammar/implementations/helpers/EnglishLexicon";
import { REVIEW_SUPPORTED_RULE_IDS } from "../../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { expectChunkSplitParity, prepared, review as runReview } from "./grammarTestUtils";

// Lexicon-backed checks of english/lexical.ts. All sentences are our own.
const RULES = new Set([
  "englishIrregularForms",
  "englishPossessiveNouns",
  "englishAlotCorrection",
  "englishYourYouAre",
  "styleRedundancy",
]);
const review = (text: string) =>
  runReview(text, {}, { enabledRules: REVIEW_SUPPORTED_RULE_IDS }).diagnostics.filter((d) =>
    RULES.has(d.ruleId),
  );

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
  // "You" before plurals and verbs.
  "You guys of all people.",
  "You fool of a man.",
  // Acronym plurals and title case stay as they are.
  "Keep your PINs safe.",
  "Check the VIN Number.",
  // A long run of spaces inside a sentence does not open a clause.
  `He said${" ".repeat(45)}You combination of artist and teacher.`,
];

test.each(negatives)("lexical checks stay silent: %s", (text) => {
  expect(review(text)).toEqual([]);
});

test("a chunk cut between the two words keeps the finding", () => {
  for (const text of ["Sometimes the doo ris locked."]) {
    const { diagnostics } = runReview(text);
    expect(diagnostics).toHaveLength(1);
    const enabledRules = [diagnostics[0].ruleId];
    expectChunkSplitParity(prepared(text, {}, { enabledRules }), text, diagnostics);
  }
});

test("the user dictionary protects a word", () => {
  const text = "Two womans waved at us.";
  const findings = runReview(
    text,
    {},
    {
      enabledRules: REVIEW_SUPPORTED_RULE_IDS,
      userDictionary: ["womans"],
    },
  ).diagnostics.filter((d) => RULES.has(d.ruleId));
  expect(findings).toEqual([]);
});

test("left-out dictionary nouns are known, and their plural marks are exact", () => {
  const omitted: string[] = [];
  deriveEnglishLexicon(
    readFileSync(LEXICON_SOURCES.dic, "utf8"),
    readFileSync(LEXICON_SOURCES.aff, "utf8"),
    omitted,
  );
  const noPlural = new Set(omitted.filter((w) => w.startsWith("!")).map((w) => w.slice(1)));
  const nouns = omitted.filter((w) => !w.startsWith("!"));
  expect(nouns.length).toBeGreaterThan(10000);
  for (const noun of nouns) {
    if (englishListedNoun(noun) !== "singular") throw new Error(`not known: ${noun}`);
    if (englishListedWithoutPlural(noun) !== noPlural.has(noun))
      throw new Error(`plural mark: ${noun}`);
  }
  expect(englishListedNoun("students")).toBe("plural");
  expect(englishListedNoun("thisinstead")).toBe(null);
});
