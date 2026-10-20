import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { PhraseRow } from "../englishPhraseTables";
import {
  found,
  frameMatches,
  hasUserOrCasedWord,
  isLang,
  SPACE,
  WORD_END,
} from "../phraseTemplates";
import { quotedMention } from "./grammarStyle1";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { Detector } from "../../engine/reviewRules";
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

// ---------------------------------------------------------------------------- detectors

type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
const AMERICAN: Rule = {
  ruleId: "englishAmericanSpelling",
  messageKey: "review_msg_american_spelling",
};
const BRITISH: Rule = {
  ruleId: "englishBritishSpelling",
  messageKey: "review_msg_british_spelling",
};

// "be on the cards" (British) and "be in the cards" (American): only after a form of "be"
// ("is that just not in the cards?"), so cards on a table ("write it on the cards") stay.
const BE =
  "(?:am|is|are|was|were|be|been|being|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t|its|\\p{L}+['’](?:s|re))";
const CARD_ADVERBS =
  "(?:not|just|really|probably|definitely|certainly|still|also|already|never|ever|likely|possibly|clearly|simply|even|again|all|quite|maybe|perhaps|hardly)";
// The idiom ends its clause or is followed by a function word: "in the cards box" stays.
const CARD_FOLLOWERS =
  "(?:for|at|but|and|or|any|anytime|again|anymore|now|right|yet|either|though|since|so|then|previously|back|soon|until|unless|if|because|as|with|too|just|after|before|when|while|ever|in|this|that|these|those)";
const CARDS = `${BE}(?:${SPACE}(?:that|this|it|they|he|she|we|you))?(?:${SPACE}${CARD_ADVERBS}){0,3}${SPACE}(?<target>(?<prep>on|in)${SPACE}the${SPACE}cards)${WORD_END}(?=[ \\t\\u00a0]{0,8}(?:[^\\p{L} \\t\\u00a0]|$)|${SPACE}${CARD_FOLLOWERS}${WORD_END})`;

function cards(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, CARDS)) {
    const british = m.groups!.prep.toLowerCase() === "on";
    const rule = british ? AMERICAN : BRITISH;
    if (hasUserOrCasedWord(ctx, m.groups!.target)) continue;
    const prep = applyWordCase(british ? "in" : "on", detectWordCase(m.groups!.prep));
    findings.push(found(ctx, m, rule.ruleId, rule.messageKey, [prep], "prep"));
  }
  return findings;
}

// Optional number style: a single-digit count before a plural noun is spelled out ("9 pigs").
// Only after a function word, so labels ("Python 3 users", "step 2 results") stay, and
// only when the sentence has no other figure to keep consistent with.
const NUMBER_WORDS = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const BEFORE_COUNT =
  "(?:the|these|those|my|your|his|her|its|our|their|are|were|is|was|be|been|have|has|had|with|for|of|in|on|at|by|from|to|into|about|around|over|under|nearly|almost|only|just|all|and|or|than|after|within|there|here|another|last|first|next)";
const COUNT = `(?=[2-9]${SPACE})(?<=(?:^|[^\\p{L}])${BEFORE_COUNT}${SPACE})(?<target>[2-9])${SPACE}(?<noun>\\p{L}{3,})${WORD_END}`;

function spelledNumbers(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "en")) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, COUNT)) {
    if (!englishWordInfo(m.groups!.noun)?.plural) continue;
    const [start, end] = m.indices!.groups!.target;
    const sentence = (text: string) => text.split(/[.!?\n]/);
    const before = sentence(ctx.text.slice(Math.max(0, start - 200), start)).pop()!;
    const after = sentence(ctx.text.slice(end, end + 200))[0];
    if (/\p{N}/u.test(before + after)) continue;
    // In all-caps text, the `i` flag lets `\p{Ll}` match the noun. Keep the capitals.
    const word = NUMBER_WORDS[Number(m.groups!.target)];
    findings.push({
      ruleId: "styleSpelledNumbers",
      messageKey: "review_msg_spelled_numbers",
      range: { start, end },
      alternatives: [m[0] === m[0].toUpperCase() ? word.toUpperCase() : word],
      context: { start: start - before.length, end: end + after.length },
    });
  }
  return findings;
}

/** Context detectors appended to REVIEW_DETECTORS. */
const OXFORD: Rule = { ruleId: "englishOxfordSpelling", messageKey: "review_msg_oxford_spelling" };
const ISE_TABLE = new Set(ISE.map(([british]) => british));
// An -ise word, also after a hyphenated prefix ("de-energise"): the -ize spelling is the lexicon's.
const ISE_WORD =
  /(?<![\p{L}\p{N}'’])(?<target>\p{L}+is(?:e|es|ed|ing|ation|ations|ational|ationally|er|ers|able|ability))(?![\p{L}\p{N}'’])/dgiu;

/** "energise", "magnetisable": -ise forms the table lacks whose -ize form the lexicon knows. */
function iseForms(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, ISE_WORD)) {
    const word = m.groups!.target;
    const lower = word.toLowerCase();
    // "prise" (to lever open) and "seise" are words of their own.
    // The table's own words, except after a hyphen it does not match across.
    if (ISE_TABLE.has(lower) && ctx.text[m.index - 1] !== "-") continue;
    if (/^(?:prise|seise)/.test(lower)) continue;
    const ize = lower.replace(
      /is(e|es|ed|ing|ation|ations|ational|ationally|er|ers|able|ability)$/,
      "iz$1",
    );
    if (englishWordInfo(lower) || !englishWordInfo(ize) || hasUserOrCasedWord(ctx, word)) continue;
    const fix = applyWordCase(ize, detectWordCase(word));
    for (const rule of [AMERICAN, OXFORD]) {
      const finding = found(ctx, m, rule.ruleId, rule.messageKey, [fix]);
      if (!quotedMention(ctx, finding)) findings.push(finding);
    }
  }
  return findings;
}

export const PREDICATES = {
  iseForms: iseForms,
  cardSpellings: cards,
  spelledNumbers: spelledNumbers,
} satisfies Record<string, Detector>;
