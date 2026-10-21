import type { PhraseRow } from "../englishPhraseTables";
import type { RawFinding } from "../reviewDetectors";
import { table } from "./tables";

// British and American forms are both correct English, so each direction is an
// opt-in rule: whoever picks a dialect gets the other one's forms converted. The frames are in
// grammar/rules/en.yaml.

/** [British, American]: the dialect tables hold one plain form of each per row. */
type Pair = readonly [british: string, american: string];

/** Spellings each dialect writes its own way; converted in both directions. */
const BOTH = table("dialects.both") as readonly Pair[];

/** -ise and -isation forms; Oxford spelling and American English write -ize. */
const ISE = table("dialects.ise") as readonly Pair[];

/** British forms American English never uses, while British English also writes the American one. */
// Oxford spelling writes -ize too, so only the American and Oxford rules convert -ise.
const AMERICAN_ONLY = [...ISE, ...(table("dialects.americanOnly") as readonly Pair[])];

/** Authored accepted spellings. Dictionary fallback must not turn these into dialect corrections. */
const DIALECT_WORDS = new Set([...BOTH, ...AMERICAN_ONLY].flat().map((word) => word.toLowerCase()));
export function isAcceptedEnglishDialectWord(word: string): boolean {
  return DIALECT_WORDS.has(word.toLowerCase());
}

/** Opt-in tables with their own rules, indexed with the phrase corrections. */
export const OPTIONAL_TABLES: readonly {
  rows: readonly PhraseRow[];
  ruleId: RawFinding["ruleId"];
  messageKey: RawFinding["messageKey"];
}[] = [
  {
    rows: [...BOTH, ...AMERICAN_ONLY, ...table("dialects.prepone")],
    ruleId: "englishAmericanSpelling",
    messageKey: "review_msg_american_spelling",
  },
  {
    rows: [
      ...BOTH.map(([british, american]): PhraseRow => [american, british]),
      ...table("dialects.britishOnly"),
    ],
    ruleId: "englishBritishSpelling",
    messageKey: "review_msg_british_spelling",
  },
  { rows: ISE, ruleId: "englishOxfordSpelling", messageKey: "review_msg_oxford_spelling" },
  {
    rows: table("dialects.wordChoice"),
    ruleId: "styleWordChoice",
    messageKey: "review_msg_word_choice",
  },
  {
    rows: table("dialects.possibleErrors"),
    ruleId: "englishPossibleErrors",
    messageKey: "review_msg_possible_error",
  },
  {
    rows: table("dialects.alternativePhrasing"),
    ruleId: "styleAlternativePhrasing",
    messageKey: "review_msg_alternative_phrasing",
  },
];
