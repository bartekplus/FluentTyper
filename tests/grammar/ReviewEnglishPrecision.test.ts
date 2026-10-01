import { expect, test } from "bun:test";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  reviewRuleIds,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";

// Default-on English checks that must stay quiet on correct prose. All sentences are our own.
function review(text: string, enabledRules: readonly string[]) {
  return detectReviewDiagnostics(
    { id: "precision", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    {
      enabledRules: [...enabledRules],
      lang: "en_US",
      userDictionary: [],
      insertSpaceAfterAutocomplete: true,
    },
  ).diagnostics.map((d) => `${d.ruleId}: ${d.original} -> ${d.alternatives[0]?.preview ?? ""}`);
}
const DEFAULTS = reviewRuleIds({}, "en_US");

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
  // Titled names written as two words.
  "We watched The Old Home Town again.",
];

test.each(QUIET)("default checks stay quiet: %p", (text) => {
  expect(review(text, DEFAULTS).filter((f) => !f.startsWith("englishPossibleErrors"))).toEqual([]);
});

test("glued unknown nouns stay with the dictionary check", () => {
  expect(review("We drank applejuice.", REVIEW_SUPPORTED_RULE_IDS)).toEqual([]);
});

test("the guarded checks still fire on real errors", () => {
  expect(review("we met. then we left.", DEFAULTS)).toContain("capitalizeSentenceStart: t -> T");
  expect(review("Ive been there.", DEFAULTS)).toContain(
    "englishContractionNormalization: Ive -> I've",
  );
  expect(review("The dogs collar was too tight.", DEFAULTS).join()).toContain(
    "englishPossessiveNouns",
  );
  expect(
    review("The 5m rope was short.", DEFAULTS).some((f) =>
      f.startsWith("measurementUnitFormatting"),
    ),
  ).toBe(true);
});
