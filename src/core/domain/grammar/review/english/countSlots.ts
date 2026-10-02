import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { MASS } from "./nounNumberSlots";
import {
  caseLike,
  english,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  PREPOSITIONS,
  tokensAfter,
  wordBefore,
} from "./slotWords";

// Count words against the noun they count: "less people" (fewer), "too much meetings" (many),
// "many money" (much), and an article before an uncountable noun behind adjectives ("a valuable
// advice").

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

// grammarStyle1's massNouns counts these right after a count word; here only behind adjectives.
const COUNTED_ELSEWHERE = new Set(
  "advice information furniture luggage baggage equipment evidence feedback software hardware clothing".split(
    " ",
  ),
);
// Nouns with an everyday count sense too: "a fine wine", "a rich vocabulary".
const COUNT_SENSE = new Set("wine vocabulary scenery".split(" "));
// Units where "less" reads as an amount: "less dollars", "less hours" are common and contested.
const AMOUNT_UNITS =
  /^(?:dollars|euros|pounds|cents|bucks|hours|minutes|seconds|days|weeks|months|years|miles|kilometers|kilometres|meters|metres|feet|inches|calories|degrees|percent)$/;
// Nouns of address after "thank you so much": "Thanks so much guys".
const VOCATIVES = /^(?:guys|folks|ladies|gentlemen|friends|kids|boys|girls)$/;

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  start: number,
  end: number,
  alternatives: string[],
  from: number,
): void {
  findings.push({
    ruleId: "englishCountability",
    messageKey: "review_msg_countability",
    range: { start, end },
    alternatives,
    context: evidence(ctx, from, end),
  });
}

/** A plural noun the lexicon reads as nothing else, heading its phrase (no noun after it). */
function pluralHead(ctx: DetectContext, noun: string, end: number, verbNext: boolean): boolean {
  // After less/much an -s word is no verb: "engineers" counts though "to engineer" exists.
  const read = FUNCTION_WORDS.has(noun) ? null : englishWordInfo(noun);
  const plural =
    IRREGULAR_PLURALS.test(noun) ||
    (read ? read.plural && !read.adjective : nounOnly(noun) === "plural");
  // "much news", "less physics", "less means": singular in sense.
  if (!plural || AMOUNT_UNITS.test(noun) || MASS.has(noun) || SINGULAR_S.test(noun)) return false;
  const next = tokensAfter(ctx, end, 1)[0];
  if (next?.kind !== "word" || FUNCTION_WORDS.has(next.lower)) return true;
  // "less sales tax": a plural modifier; "how much cats love milk": a verb makes it a clause.
  if (CLAUSE_LINKS.test(next.lower)) return true;
  const after = englishWordInfo(next.lower);
  if (verbNext && after?.verbs.some((v) => v.form !== "base" && v.form !== "ing") && !after.noun)
    return true;
  return !!after?.adverb || (!after?.noun && !after?.verbs.length && !nounOnly(next.lower));
}
const SINGULAR_S =
  /(?:ics|ness)$|^(?:news|means|series|species|thanks|odds|whereabouts|headquarters|lens|gas|bus|plus|bonus|status|campus|virus|census|corpus|focus|genius|sinus|surplus)$/;
const CLAUSE_LINKS = /^(?:after|before|since|until|than|then|ago|when|while)$/;
const IRREGULAR_PLURALS = /^(?:people|children|men|women|feet|teeth|mice|geese)$/;

/** "less people" -> fewer; "too much meetings" -> many. */
function amountBeforePlural(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, `(?<target>less|much)${SPACE}(?<noun>[a-z]+)${WORD_END}`)) {
    const { target, noun } = m.groups!;
    const word = target.toLowerCase();
    const end = m.index + m[0].length;
    if (ctx.dictionary.has(noun) || !pluralHead(ctx, noun, end, word === "less")) continue;
    const before = wordBefore(ctx, m.index);
    // "no less", "more or less", "much less" (let alone) keep their own sense; "a little less
    // points", "is less taxes" weigh an amount; "revenue less expenses" subtracts.
    if (/^(?:no|or|much|any|the|than|little|is|are|was|were|be)$/.test(before)) continue;
    if (/[\d%][ \t\u00a0]*$/.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))) continue;
    if (word === "less" && before && nounOnly(before)) continue;
    if (word === "much") {
      // "how much companies are capable", "not much changes": a clause after much; only a
      // noun-only plural closing its phrase ("this much drugs.", "much videos of it") counts.
      if (before === "how" || nounOnly(noun) !== "plural" || VOCATIVES.test(noun)) continue;
      const next = tokensAfter(ctx, end, 1)[0];
      if (next?.kind === "word" && !PREPOSITIONS.has(next.lower)) continue;
      // "Thank you so much guys", "I miss you so much folks": a vocative, not a count.
      const clause = /[^.!?;:\n]*$/.exec(ctx.text.slice(Math.max(0, m.index - 80), m.index))![0];
      if (/\b(?:thanks?|love|miss|appreciate)\b/i.test(clause)) continue;
    }
    const [start, targetEnd] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      start,
      targetEnd,
      [caseLike(target, word === "less" ? "fewer" : "many")],
      m.index,
    );
  }
  return findings;
}

const MASS_COUNT: Record<string, string> = {
  many: "much",
  few: "little",
  several: "some",
  fewer: "less",
};

/** "many money", "a few homework": a count word before an uncountable noun. */
function countBeforeMass(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<target>many|few|several|fewer)${SPACE}(?<noun>${MASS_WORDS})${WORD_END}`,
  )) {
    const { target, noun } = m.groups!;
    if (COUNTED_ELSEWHERE.has(noun) || COUNT_SENSE.has(noun)) continue;
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    // "many research papers": the noun modifies the next one.
    if (compound(ctx, m.index + m[0].length)) continue;
    const [start, end] = m.indices!.groups!.target;
    push(ctx, findings, start, end, [caseLike(target, MASS_COUNT[target.toLowerCase()])], m.index);
  }
  return findings;
}

/** The next word continues a compound noun ("a research paper", "much news coverage"). */
function compound(ctx: DetectContext, end: number): boolean {
  const next = tokensAfter(ctx, end, 1)[0];
  if (next?.kind !== "word" || FUNCTION_WORDS.has(next.lower) || CLAUSE_LINKS.test(next.lower))
    return false;
  const read = englishWordInfo(next.lower);
  // "A wisdom comes with age": an -s verb, not a compound's plural head.
  if (read?.verbs.some((v) => v.form === "third")) return false;
  // An unknown or classless word ("toolkit", "app") is most likely a noun.
  if (!read || !(read.noun || read.adjective || read.adverb || read.verbs.length)) return true;
  return read.noun || read.plural;
}

const MASS_WORDS = [...MASS].join("|");

/** "A knowledge is power", "an incorrect advice": a/an before an uncountable noun. */
function articleBeforeMass(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<=(?<![\\p{L}'’-])(?<article>an?)(?<adjectives>(?:${SPACE}[a-z]{1,30}){0,3}?)${SPACE})(?<noun>${MASS_WORDS})${WORD_END}`,
    "article",
  )) {
    const { article, adjectives, noun } = m.groups!;
    if (COUNT_SENSE.has(noun)) continue;
    const words = adjectives.trim().split(/\s+/).filter(Boolean);
    // Right after the article, grammarStyle1's massNouns owns these nouns.
    if (!words.length && COUNTED_ELSEWHERE.has(noun)) continue;
    // "a little advice", "a lot of": only plain adjectives (and degree words) stand between.
    if (
      !words.every(
        (w, i) =>
          (i < words.length - 1 && /^(?:very|really|quite|rather|truly)$/.test(w)) ||
          (w !== "little" &&
            !FUNCTION_WORDS.has(w) &&
            !!englishWordInfo(w)?.adjective &&
            !englishWordInfo(w)?.plural),
      )
    )
      continue;
    const end = m.index + m[0].length;
    // "a good knowledge of French" is standard; "a research project" is a compound.
    const next = tokensAfter(ctx, end, 1)[0];
    if ((noun === "knowledge" && next?.lower === "of") || compound(ctx, end)) continue;
    if (hasUserOrCasedWord(ctx, ctx.text.slice(m.indices!.groups!.article[0], end))) continue;
    const rest = ctx.text.slice(m.indices!.groups!.article[1], end).replace(/^[ \t\u00a0]+/, "");
    const [start] = m.indices!.groups!.article;
    push(ctx, findings, start, end, [caseLike(article, rest)], start);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishCountability"],
    detect: english(amountBeforePlural, countBeforeMass, articleBeforeMass),
  },
];
