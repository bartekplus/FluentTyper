import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  afterBreak,
  english,
  evidence,
  FUNCTION_WORDS,
  type Token,
  tokensAfter,
} from "./slotWords";

// An adjective where its -ly adverb belongs: between an auxiliary, "to" or a subject and a
// verb ("could possible go", "to easy achieve"), or before another adjective after be
// ("is terrible slow").

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

// Colour and shade words combine with each other ("dark blue"), and these adjectives are
// adverbs too ("fast", "hard", "late", "well").
const NOT_ADVERB_BASE = new Set(
  "dark light bright pale deep red blue green yellow black white brown grey gray pink orange purple fast hard late early well long low high straight free sure dead".split(
    " ",
  ),
);

/** The -ly adverb of an adjective, when the lexicon knows it as an adverb. */
function adverbOf(adjective: string): string | null {
  if (adjective.length < 4 || NOT_ADVERB_BASE.has(adjective) || FUNCTION_WORDS.has(adjective))
    return null;
  const read = englishWordInfo(adjective);
  if (!read?.adjective || read.verbs.length || read.adverb) return null;
  const candidates = [
    adjective.replace(/le$/, "ly"),
    adjective.replace(/ic$/, "ically"),
    adjective.replace(/y$/, "ily"),
    `${adjective}ly`,
  ];
  return (
    candidates.find((c) => c !== adjective && /ly$/.test(c) && !!englishWordInfo(c)?.adverb) ?? null
  );
}

/** A verb form the auxiliary or subject before the adjective takes. */
function verbAfter(
  word: string,
  kind: "base" | "participle" | "finite",
  after: Token | undefined,
  derived: boolean,
): boolean {
  const read = englishWordInfo(word);
  if (!read || FUNCTION_WORDS.has(word))
    return kind === "finite"
      ? /^(?:has|does|had|did)$/.test(word)
      : /^(?:be|have|do|not)$/.test(word);
  // "Would soft wire work", "could private message me": a noun after the adjective, unless
  // the phrase ends there ("could possible work.").
  const nounEnds = !after || after.kind === "end" || after.kind === "comma";
  // "we temporary stay the course": a noun-or-verb with its own object after it. Only for a
  // long derived adverb: "could private message me", "cold transfer" are compound verbs.
  const objectNext =
    derived &&
    after?.kind === "word" &&
    /^(?:the|a|an|my|your|his|her|our|their|this|these|those|it|them|him|us|me|all|some|any)$/.test(
      after.lower,
    );
  if (kind === "base")
    return (
      (!read.noun || nounEnds || objectNext) &&
      read.verbs.some((v) => v.form === "base" && v.lemma === word)
    );
  if (kind === "participle") return read.verbs.some((v) => v.form === "participle");
  return (
    (!read.noun || objectNext) &&
    read.verbs.some((v) => v.form === "past" || v.form === "third" || v.form === "base")
  );
}

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  m: RegExpExecArray,
  adverb: string,
): void {
  const [start, end] = m.indices!.groups!.target;
  if (findings.some((f) => f.range.start === start)) return;
  findings.push({
    ruleId: "englishConfusedWords",
    messageKey: "review_msg_adverb_form",
    range: { start, end },
    alternatives: [adverb],
    context: evidence(ctx, m.index, end + 24),
  });
}

function adjectiveForAdverb(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    // The lead sits in a lookbehind so that "It could possible work" is not consumed by "It".
    `(?<=(?<![\\p{L}'’])(?:could|would|should|can|will|might|must|may|won['’]t|can['’]t|couldn['’]t|didn['’]t|doesn['’]t|don['’]t|does|did|to|have|has|had|I|we|you|they|it|he|she)${SPACE})(?<target>[a-z]+)(?=${SPACE}(?<verb>[a-z]+)${WORD_END})`,
    "target",
  )) {
    const { target, verb } = m.groups!;
    const lead = /([A-Za-z'’]+)[ \t\u00a0]+$/.exec(
      ctx.text.slice(Math.max(0, m.index - 16), m.index),
    )![1];
    if (ctx.dictionary.has(target) || target !== target.toLowerCase()) continue;
    const adverb = adverbOf(target);
    if (!adverb) continue;
    const l = lead.toLowerCase();
    const kind = /^(?:have|has|had)$/.test(l)
      ? "participle"
      : /^(?:i|we|you|they|it|he|she)$/.test(l)
        ? "finite"
        : "base";
    // "to" must be an infinitive marker: "how to quick fix" yes, "close to perfect" no.
    if (
      l === "to" &&
      !/\b(?:how|tried|try|trying|want|wants|need|needs|like|order|able|is|was|are|were)[ \t\u00a0]+to[ \t\u00a0]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 24), m.index),
      )
    )
      continue;
    // "Should intent be part of…": an inverted modal makes the next word its subject.
    if (kind === "base" && afterBreak(ctx, m.index - lead.length - 1)) continue;
    const after = tokensAfter(ctx, m.indices!.groups!.verb[1], 1)[0];
    if (!verbAfter(verb, kind, after, /(?:ily|ally|bly)$/.test(adverb))) continue;
    push(ctx, findings, m, adverb);
  }
  // "Your site is terrible slow": be + adjective + adjective.
  for (const m of frameMatches(
    ctx,
    `(?<=(?:(?<![\\p{L}'’])(?:is|are|was|were|be|been|seems?|seemed|looks?)|[\\p{L}](?:['’]s|['’]m|['’]re))${SPACE})(?<target>[a-z]+)(?=${SPACE}(?<next>[a-z]+)${WORD_END})`,
    "target",
  )) {
    const { target, next } = m.groups!;
    if (target !== target.toLowerCase() || ctx.dictionary.has(target)) continue;
    if (!/(?:ble|al|ary|ic|ent|ous|ive|ful|ple|real|easy)$/.test(target)) continue;
    const adverb = adverbOf(target);
    if (!adverb) continue;
    const read = englishWordInfo(next);
    // The second word must be a predicate adjective or participle, never a noun.
    if (
      !read ||
      read.noun ||
      read.plural ||
      !(read.adjective || read.verbs.some((v) => v.form === "participle"))
    )
      continue;
    if (NOT_ADVERB_BASE.has(next) || FUNCTION_WORDS.has(next)) continue;
    // "be reasonable based on", "necessary soon": a preposition-like participle or an adverb.
    if (
      /^(?:soon|early|late|enough|then|based|compared|given|considering|including|regarding)$/.test(
        next,
      )
    )
      continue;
    push(ctx, findings, m, adverb);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishConfusedWords"], detect: english(adjectiveForAdverb) },
];
