import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { PhraseRow } from "../englishPhraseTables";
import { found, hasUserOrCasedWord } from "../phraseTemplates";
import type { RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { table } from "./tables";

// British and American forms are both correct English, so each direction is an
// opt-in rule: whoever picks a dialect gets the other one's forms converted.

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

// ---------------------------------------------------------------------------- frame fixes

const AMERICAN = {
  ruleId: "englishAmericanSpelling",
  messageKey: "review_msg_american_spelling",
} as const;
const BRITISH = {
  ruleId: "englishBritishSpelling",
  messageKey: "review_msg_british_spelling",
} as const;
const OXFORD = {
  ruleId: "englishOxfordSpelling",
  messageKey: "review_msg_oxford_spelling",
} as const;

// Optional number style: the number words of the single-digit counts.
const NUMBER_WORDS = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const ISE_TABLE = new Set(ISE.map(([british]) => british));

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  /** "energise", "magnetisable": -ise forms the table lacks whose -ize form the lexicon knows. */
  iseForm: (m, ctx) => {
    const word = m.groups!.target;
    const lower = word.toLowerCase();
    // "prise" (to lever open) and "seise" are words of their own.
    // The table's own words, except after a hyphen it does not match across.
    if (ISE_TABLE.has(lower) && ctx.text[m.index - 1] !== "-") return null;
    if (/^(?:prise|seise)/.test(lower)) return null;
    const ize = lower.replace(
      /is(e|es|ed|ing|ation|ations|ational|ationally|er|ers|able|ability)$/,
      "iz$1",
    );
    if (englishWordInfo(lower) || !englishWordInfo(ize) || hasUserOrCasedWord(ctx, word))
      return null;
    const fix = applyWordCase(ize, detectWordCase(word));
    return [AMERICAN, OXFORD].map((rule) => found(ctx, m, rule.ruleId, rule.messageKey, [fix]));
  },
  /** "be on the cards" (British) and "be in the cards" (American) in the other dialect. */
  cardSpelling: (m, ctx) => {
    const british = m.groups!.prep.toLowerCase() === "on";
    const rule = british ? AMERICAN : BRITISH;
    if (hasUserOrCasedWord(ctx, m.groups!.target)) return null;
    const prep = applyWordCase(british ? "in" : "on", detectWordCase(m.groups!.prep));
    return found(ctx, m, rule.ruleId, rule.messageKey, [prep], "prep");
  },
  spelledNumber: (m, ctx) => {
    if (!englishWordInfo(m.groups!.noun)?.plural) return null;
    const [start, end] = m.indices!.groups!.target;
    const sentence = (text: string) => text.split(/[.!?\n]/);
    const before = sentence(ctx.text.slice(Math.max(0, start - 200), start)).pop()!;
    const after = sentence(ctx.text.slice(end, end + 200))[0];
    if (/\p{N}/u.test(before + after)) return null;
    // In all-caps text, the `i` flag lets `\p{Ll}` match the noun. Keep the capitals.
    const word = NUMBER_WORDS[Number(m.groups!.target)];
    return {
      ruleId: "styleSpelledNumbers",
      messageKey: "review_msg_spelled_numbers",
      range: { start, end },
      alternatives: [m[0] === m[0].toUpperCase() ? word.toUpperCase() : word],
      context: { start: start - before.length, end: end + after.length },
    };
  },
} satisfies Record<string, MatchFixer>;
