import { expect, test } from "bun:test";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  reviewRuleIds,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { scan } from "./reviewHarness";

// Default-on English checks that must stay quiet on correct prose. All sentences are our own.
function review(text: string, enabledRules: readonly string[]) {
  return scan(text, { enabledRules: [...enabledRules] }).map(
    (d) => `${d.ruleId}: ${d.original} -> ${d.alternatives[0]?.preview ?? ""}`,
  );
}
const DEFAULTS = reviewRuleIds({ codeMode: false });

const QUIET: string[] = [
  // Abbreviations before a lowercase word.
  "The plates were 3 mm. thick and 12 cm. wide.",
  "We met in Nov. and again in Dec. before the launch.",
  "The essays (ed. and tr. by two scholars) appeared later.",
  "The vase dates from ca. the third century.",
  // A capitalized unknown word is a name, not two glued words.
  "Mr. Wasbourne arrived late.",
  "Ms. Hashby signed the form.",
  // Closed words the dictionary lacks stay whole by default.
  "The rainforest was quiet.",
  "We bred zebrafish in the lab.",
  // Attributive plurals and adjectives after a noun.
  "A fireworks display lit the sky.",
  "She runs an antiques shop in town.",
  "The members present voted yes.",
  // A name after an initial.
  "Our founder, Jonas K. Ive, retired.",
  // Pronoun predicates and stranded prepositions after "it's".
  "I knew at once it's Mira.",
  "Nobody knows whose desk it's on.",
  // "Let" with a capital variable.
  "Let side B be the longer one.",
  // "effect" as "bring about" with a transaction.
  "We effect the payment on Friday.",
  // An elided verb before a purpose clause.
  "You should not have to just to get a refund.",
  // "make her complain" keeps the verb; "an in house tool" is in-house.
  "Cold soup will make her complain.",
  // "if" as "whether".
  "I wonder if she would have agreed.",
  // Time adverbs after "more".
  "We can talk more later.",
  // Paintings.
  "The museum owns three still lifes by her.",
  // Passive with an adverb before "told to".
  "Such stories are rarely told to children.",
  // A participle after "principle".
  "The principle behind it and the principle underlying it differ.",
  // Millions and plural model numbers.
  "The app reached 40m users.",
  "Two Boeing 737s landed.",
  // The okina.
  "We flew to Hawai‘i last spring.",
  // A name opening with "The" after "the", and letters spelled out.
  "It belongs in the The Beatles box set.",
  "Spell it N A A N.",
  // A capitalized unit is part of a title.
  "It topped the 2019 Year-End list.",
  // Titled names written as two words.
  "We watched The Old Home Town again.",
  // A year or a label before a noun.
  "He restored a 1990 car and a pre-1990 truck.",
  // An inverted conditional: "should" before a plural subject.
  "The guards would retreat should raiders cross the river.",
  // A name after a lowercase word; the noun "march".
  "We read stories by Ive Marten tonight.",
  "Every march ends at the square.",
  // An adverb after a plural noun is not a possessed noun.
  "The checks the auditors usually do took a week.",
  // Precision pass of 2026-10 (LT parity). Did and have closing a relative clause.
  "The survey we did showed a clear trend.",
  "Whatever cash she had went to the vet.",
  "Send me the notes you have regarding the move.",
  "Do you have boxes cluttering the hall?",
  // A quoted name after a participle; "to" + a list of nouns; the base verb "found".
  "Did the cat named 'Moss' come home?",
  "The links we have to blogs, shops, and forums are old.",
  "The monks did not found a school in the town.",
  // A pronoun with a noun in apposition, a fronted phrase, an object pronoun and a letter.
  "We nurses often work nights.",
  "Behind it are two old towers.",
  "The day I called you was a Monday.",
  "Suppose the set I is empty.",
  "Tell me, am I nuts here?",
  "Even a slow reader such as I finds it easy.",
  // A label with its number before a noun.
  "He is a grade 9 student.",
  "She sent me a Word 97 file.",
  "Read part 3 of the guide first.",
  // "in hand" after "one of these".
  "We keep one of those in stock.",
  // Purpose to-clauses, a have question, nouns after want and need.
  "What tool do you recommend to edit photos?",
  "How have these changes helped the team?",
  "She wanted tea this morning.",
  "Guests need read access to the wiki.",
  "Once they needed help the town gave it.",
  // Names of things: IS, the or operator, a noun after is, a noun compound.
  "Was IS losing ground?",
  "Use the or operator here.",
  "The best art in town is stuff by local kids.",
  "Tell me what color effects the lamp has.",
  "It is a feedback and review form.",
  // They're before an adverb or a noun phrase; a past "cost"; "too darn many".
  "Water the plants while they're abroad.",
  "They hug like they're old pals.",
  "He said it cost us a lot.",
  "They had too darn many rules.",
  // A letter grade, a class before its members and a list numbered with roman letters.
  "Your A grade surprised us.",
  "It is found in the metals tin, zinc and lead.",
  "Steps: i breath, ii rest.",
  // An abbreviation alone in parentheses before a lowercase word.
  "The score (arr.) and the lyrics (trans.) were new.",
];

test.each(QUIET)("default checks stay quiet: %p", (text) => {
  expect(review(text, DEFAULTS).filter((f) => !f.startsWith("englishPossibleErrors"))).toEqual([]);
});

test('"no" before a participle and its particle stays: only the hyphen is missing', () => {
  expect(review("This app has no built in timer.", DEFAULTS)).toEqual([
    "englishClosedCompounds: built in -> built-in",
  ]);
});

test("glued unknown nouns stay with the dictionary check", () => {
  expect(review("We drank applejuice.", REVIEW_SUPPORTED_RULE_IDS)).toEqual([]);
});

test.each([
  ["I did showed them the plan.", "englishAuxiliaryBaseVerb"],
  ["Did the server crashed?", "englishAuxiliaryBaseVerb"],
  ["You need to goes now.", "englishAuxiliaryBaseVerb"],
  ["We was late again.", "englishPronounVerbWhitelistAgreement"],
  ["It are ready now.", "englishPronounVerbWhitelistAgreement"],
  ["I finds it hard.", "englishPronounVerbWhitelistAgreement"],
  ["We sold 120 car.", "englishNounNumber: car -> cars"],
  ["Many child were sad.", "englishNounNumber"],
  ["I wanted give you a call.", "englishVerbComplements"],
  ["I need advise about this.", "advise -> advice"],
  ["They're car is red.", "englishTheirThereTheyAre"],
  ["She has went home.", "englishPerfectParticiples"],
  ["Your going to love it.", "englishYourYouAre"],
  ["It's to hot.", "englishToToo"],
  ["The dogs collar was too tight.", "englishPossessiveNouns"],
  ["Yesterday i went home.", "englishPronounICapitalization"],
  ["If you want to i can drive.", "englishPronounICapitalization"],
  ["We wanted too have fun.", "englishToToo"],
  ["You need write access codes for each user.", "englishVerbComplements"],
])("the guarded checks still fire: %p", (text, expected) => {
  expect(review(text, DEFAULTS).join("\n")).toContain(expected);
});

test("the guarded checks still fire on real errors", () => {
  expect(review("we met. then we left.", DEFAULTS)).toContain("capitalizeSentenceStart: t -> T");
  expect(review("Ive been there.", DEFAULTS)).toContain(
    "englishContractionNormalization: Ive -> I've",
  );
  expect(review("We hike there every march.", DEFAULTS)).toContain(
    "englishProperNounCapitalization: march -> March",
  );
  expect(review("We sold 120 car.", DEFAULTS)).toContain("englishNounNumber: car -> cars");
  expect(review("The dogs collar was too tight.", DEFAULTS).join()).toContain(
    "englishPossessiveNouns",
  );
  expect(
    review("The 5m rope was short.", DEFAULTS).some((f) =>
      f.startsWith("measurementUnitFormatting"),
    ),
  ).toBe(true);
});
