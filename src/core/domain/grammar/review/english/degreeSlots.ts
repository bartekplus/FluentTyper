import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  afterBreak,
  caseLike,
  english,
  evidence,
  info,
  nounOnly,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";
import { finding } from "../finding";

// "to" where the degree adverb "too" is meant, decided by what surrounds it: a linking verb
// before and a predicate adjective after ("it's to late"), a degree word closing the clause
// ("they cost to much"), or "two much".

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const LINKING =
  "(?:is|are|was|were|am|be|been|being|seems?|seemed|looks?|looked|feels?|felt|sounds?|sounded|gets?|got|getting|become|becomes|became|['’]s|['’]re|['’]m|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)";
// Words that may stand between the linking verb and "to": "it's way to late", "not to big".
const BETWEEN =
  "(?:not|way|far|just|much|still|also|really|simply|already|probably|a[ \\t\\u00a0]+bit|definitely|getting|being|kind[ \\t\\u00a0]+of)";
// Degree words that only "too" can take before a clause end.
const DEGREE_WORDS = new Set("much many little few late soon early far long".split(" "));
// What may follow the degree phrase: the end, an infinitive, a for-phrase or a reason.
const AFTER = new Set("to for because now and with in at about from off away ago".split(" "));
// Predicate adjectives the lexicon gives no class.
const PREDICATIVE = new Set("afraid alone awake asleep".split(" "));

/** An adjective (or participle) that cannot be a verb after an infinitive "to". */
function degreeTarget(word: string): boolean {
  if (DEGREE_WORDS.has(word) || PREDICATIVE.has(word)) return true;
  if (/^(?:one|two|three|four|five|six|seven|eight|nine|ten)$/.test(word)) return false;
  const read = info(word);
  // "was to trying…": an -ing form is a verb after "to".
  if (!read || read.verbs.some((v) => v.form === "base" || v.form === "third" || v.form === "ing"))
    return false;
  return read.adjective || read.verbs.some((v) => v.form === "participle");
}

const closesAt = (tokens: Token[], k: number) => {
  const t = tokens[k];
  return !t || t.kind === "end" || t.kind === "comma" || (t.kind === "word" && AFTER.has(t.lower));
};

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  m: RegExpExecArray,
  replacement = "too",
): void {
  const [start, end] = m.indices!.groups!.target;
  const target = m.groups!.target;
  if (findings.some((f) => f.range.start === start) || ctx.dictionary.has(target.toLowerCase()))
    return;
  findings.push(
    finding("englishToToo", "review_msg_to_too", start, end, [caseLike(target, replacement)], {
      context: evidence(ctx, m.index, m.index + m[0].length),
    }),
  );
}

/** The word after "to" is a degree target and the phrase closes there. */
function closedDegree(ctx: DetectContext, end: number, strict: boolean): boolean {
  const tokens = tokensAfter(ctx, end, 4);
  const word = tokens[0];
  if (word?.kind !== "word" || word.text !== word.lower || !degreeTarget(word.lower)) return false;
  // A glued token ("lift.js") or an infinitive that is not a known verb ("to frobnicate", "to.").
  if (tokens.some((t) => t.kind === "other")) return false;
  if (
    tokens[1]?.lower === "to" &&
    !(
      tokens[2]?.kind === "word" &&
      englishWordInfo(tokens[2].lower)?.verbs.some((v) => v.form === "base")
    )
  )
    return false;
  // "much of a stretch"; "much more" is a comparison ("led to much more").
  if (/^(?:much|many)$/.test(word.lower) && tokens[1]?.lower === "of") return !strict;
  return closesAt(tokens, 1) && (!strict || tokens[1]?.kind !== "word");
}

function toForToo(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  // A linking verb: "It's to late.", "The box is not to heavy to carry."
  for (const m of frameMatches(
    ctx,
    `(?:[a-z]+(?=['’]))?${LINKING}(?:${SPACE}${BETWEEN}){0,2}${SPACE}(?<target>to)(?=${SPACE}[a-z])`,
  ))
    if (closedDegree(ctx, m.index + m[0].length, false)) push(ctx, findings, m);
  // A degree adverb: "came much to soon", "way to early".
  for (const m of frameMatches(ctx, `(?:much|far|way)${SPACE}(?<target>to)(?=${SPACE}[a-z])`)) {
    const before = wordBefore(ctx, m.index);
    // "the way to go", "a long way to …", "how far to drive": "to" heads an infinitive.
    if (/^(?:the|a|this|that|one|no|best|which|how|so|as|too)$/.test(before)) continue;
    if (closedDegree(ctx, m.index + m[0].length, true)) push(ctx, findings, m);
  }
  // A clause-final degree word after a lexical verb: "They cost to much.", "It fails to often."
  for (const m of frameMatches(
    ctx,
    `(?<verb>[a-z]+)${SPACE}(?<target>to)${SPACE}(?<degree>much|often|soon|late)(?=[ \\t\\u00a0]{0,8}(?:[.!?;)]|$))`,
  )) {
    // "amount to much", "come to much", "up to much", "set it to late": "to" is a preposition.
    if (
      /^(?:amounts?|amounted|comes?|came|coming|up|set|sets|switch|changed?|moved?|default|defaults|postponed?|delayed?|back|down)$/.test(
        m.groups!.verb,
      )
    )
      continue;
    const read = info(m.groups!.verb);
    if (!read?.verbs.length) continue;
    push(ctx, findings, m);
  }
  // Trying hard: "I was trying to hard."
  for (const m of frameMatches(
    ctx,
    `(?:try|tries|tried|trying|push|pushing|pushed|work|working|worked)${SPACE}(?<target>to)${SPACE}hard(?=[ \\t\\u00a0]{0,8}(?:[.!?;,)]|$))`,
  ))
    push(ctx, findings, m);
  // A measured excess: "10 percent to high", "5% to much", "two days to late".
  for (const m of frameMatches(
    ctx,
    `(?:[0-9]+(?:[ \\t\\u00a0]?%|${SPACE}(?:percent|per[ \\t\\u00a0]?cent))|(?:[0-9]+|a|one|two|three|few|several)${SPACE}(?:years?|months?|weeks?|days?|hours?|minutes?|seconds?))${SPACE}(?<target>to)(?=${SPACE}[a-z])`,
  ))
    if (closedDegree(ctx, m.index + m[0].length, true)) push(ctx, findings, m);
  // An excessive amount as an object: "She has to much work", "We spent to much money".
  for (const m of frameMatches(
    ctx,
    `(?<verb>has|have|had|having|spent|spend|spends|spending|ate|eat|eats|drank|drink|drinks|avoid|avoided|gave|give|gives)${SPACE}(?<target>to)${SPACE}(?<amount>much|many)${SPACE}(?<noun>[a-z]+)${WORD_END}`,
  )) {
    const { verb, amount, noun } = m.groups!;
    // "gave to many charities": a recipient.
    if (amount === "many" && /^g[ai]ve/.test(verb)) continue;
    if (nounOnly(noun) || info(noun)?.noun) push(ctx, findings, m);
  }
  // A clause-opening quantity subject: "because to much snow fell", "To many people came."
  for (const m of frameMatches(
    ctx,
    `(?<target>to)${SPACE}(?:much|many)${SPACE}(?<noun>[a-z]+)${SPACE}(?<verb>is|was|are|were|will|would|has|have|had|can|could|[a-z]+ed)${WORD_END}`,
  )) {
    const before = wordBefore(ctx, m.index);
    if (!afterBreak(ctx, m.index) && !/^(?:because|since|as|when|if|and|but|so|that)$/.test(before))
      continue;
    if (!nounOnly(m.groups!.noun) && !info(m.groups!.noun)?.noun) continue;
    push(ctx, findings, m);
  }
  // "two much", "two many" (not "two much bigger rooms"); "one to many beers".
  for (const m of frameMatches(ctx, `(?<target>two)${SPACE}(?:much|many)${WORD_END}`)) {
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (next?.kind === "word" && /(?:er|more|less)$/.test(next.lower)) continue;
    push(ctx, findings, m);
  }
  for (const m of frameMatches(
    ctx,
    `one${SPACE}(?<target>to)${SPACE}many${SPACE}(?<noun>[a-z]+)${WORD_END}`,
  )) {
    const noun = m.groups!.noun;
    if (nounOnly(noun) === "plural" || info(noun)?.plural) push(ctx, findings, m);
  }
  // A sentence opening "To late." or "To bad that…", also after an interjection ("Ah to late").
  for (const m of frameMatches(ctx, `(?<target>[Tt]o)${SPACE}(?<word>[a-z]+)${WORD_END}`)) {
    if (!afterBreak(ctx, m.index) && !/^(?:ah|oh|aw)$/.test(wordBefore(ctx, m.index))) continue;
    const word = m.groups!.word;
    if (word !== word.toLowerCase() || !degreeTarget(word)) continue;
    if (DEGREE_WORDS.has(word) && word !== "late" && word !== "much") continue;
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (next && next.kind === "word" && next.lower !== "that") continue;
    push(ctx, findings, m);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishToToo"], detect: english(toForToo) },
];
