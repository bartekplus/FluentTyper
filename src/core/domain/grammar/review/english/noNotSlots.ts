import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  afterBreak,
  caseLike,
  english,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  tokensAfter,
  wordBefore,
} from "./slotWords";
import { MASS } from "./nounNumberSlots";
import { finding } from "../finding";

// "no" and "not" swapped: "there is not time" (no), "I have not issues" (no), "I would no do
// this" (not), "I'm no going" (not), "I have no begun" (not).

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

// Quantity and focus words "not" rightly negates: "not enough", "not only", "not one".
const NOT_WORDS = new Set(
  "enough only even one two three four five six seven eight nine ten eleven twelve twenty hundred thousand million dozen few several much many all every quite so too just really always yet nearly exactly merely necessarily least half".split(
    " ",
  ),
);

/**
 * A noun with no verb reading, or one whose other reading cannot follow: after "there is not"
 * a bare verb ("time"), after "have not" an -s verb ("issues").
 */
function bareNoun(word: string, afterHave: boolean): boolean {
  if (FUNCTION_WORDS.has(word) || NOT_WORDS.has(word)) return false;
  // "data" carries no word class in the dictionary.
  if (nounOnly(word) || MASS.has(word) || word === "data") return true;
  const read = englishWordInfo(word);
  if (!afterHave)
    return (
      !!read?.noun &&
      !read.adjective &&
      read.verbs.every((v) => v.form === "base" || v.form === "third")
    );
  // After "have not" an -s verb cannot follow, so "issues", "doubts" are nouns.
  return (
    afterHave && !!read?.plural && !read.adjective && read.verbs.every((v) => v.form === "third")
  );
}

function push(ctx: DetectContext, findings: RawFinding[], m: RegExpExecArray, fix: string): void {
  const [start, end] = m.indices!.groups!.target;
  findings.push({
    ruleId: "englishConfusedWords",
    messageKey: "review_msg_confused_word",
    range: { start, end },
    alternatives: [caseLike(m.groups!.target, fix)],
    context: evidence(ctx, m.index, end),
  });
}

function noForNot(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  // "There is not time", "there are not jaguars", "I have not issues".
  for (const m of frameMatches(
    ctx,
    `(?:(?<there>there)${SPACE}(?:is|are|was|were)|there['’]s|(?<have>i|you|we|they|he|she|it)${SPACE}(?:have|has|had)|(?<have2>i|you|we|they)['’]ve)${SPACE}(?<target>not)${SPACE}(?<word>[a-z]+)${WORD_END}`,
  )) {
    const word = m.groups!.word;
    const [next, after] = tokensAfter(ctx, m.index + m[0].length, 2);
    const have = !!(m.groups!.have ?? m.groups!.have2);
    // "The cooks there are not chefs": "there" after a noun is a place.
    const before = wordBefore(ctx, m.index);
    if (
      before &&
      !FUNCTION_WORDS.has(before) &&
      !/^(?:say|said|think|believe|assume|assuming)$/.test(before)
    )
      continue;
    // "There is not easy way": an adjective before a singular noun that ends its phrase.
    const read = englishWordInfo(word);
    const adjectiveNoun =
      !have &&
      !!read?.adjective &&
      !read.adverb &&
      !NOT_WORDS.has(word) &&
      !FUNCTION_WORDS.has(word) &&
      next?.kind === "word" &&
      !!englishWordInfo(next.lower)?.noun &&
      !englishWordInfo(next.lower)?.plural &&
      !englishWordInfo(next.lower)?.adjective &&
      (!after || after.kind !== "word" || FUNCTION_WORDS.has(after.lower));
    // "there is not time to", "not one", "not much": the noun must head its phrase.
    if (!adjectiveNoun && !bareNoun(word, have)) continue;
    if (!adjectiveNoun && next?.kind === "word" && nounOnly(next.lower) && !have) continue;
    push(ctx, findings, m, "no");
  }
  // "I would no do this", "I'm no going", "I have no begun".
  for (const m of frameMatches(
    ctx,
    `(?:(?<modal>would|will|could|should|can|must|might|may|do|does|did)|(?<be>am|is|are|was|were|['’]m|['’]re)|(?<perfect>have|has|had))${SPACE}(?<target>no)${SPACE}(?<word>[a-z]+)${WORD_END}`,
  )) {
    const { word, modal, be } = m.groups!;
    const read = englishWordInfo(word);
    if (!read || read.adjective) continue;
    // "would no doubt agree": a noun reading keeps "no".
    if (
      (modal && !/^(?:do|go|be|get)$/.test(word) && (read.noun || FUNCTION_WORDS.has(word))) ||
      (!modal && FUNCTION_WORDS.has(word))
    )
      continue;
    const [next] = tokensAfter(ctx, m.index + m[0].length, 1);
    let ok: boolean;
    if (modal) ok = read.verbs.some((v) => v.form === "base" && v.lemma === word);
    else if (be)
      // "It's no laughing matter": a gerund before a noun is a compound.
      ok =
        /ing$/.test(word) &&
        !read.plural &&
        read.verbs.some((v) => v.form === "ing") &&
        (!next || next.kind !== "word" || /^(?:to|back|home|out|away|anywhere)$/.test(next.lower));
    else
      ok =
        !read.noun &&
        read.verbs.some((v) => v.form === "participle") &&
        !read.verbs.some((v) => v.form === "past" || v.form === "base");
    if (ok) push(ctx, findings, m, "not");
  }
  return findings;
}

const NO_MODAL: Record<string, string> = {
  can: "cannot",
  will: "will not",
  could: "could not",
  would: "would not",
  should: "should not",
};

/**
 * "I no like eggs", "She no like it", "Why you no speak English?", "I no can find it": "no"
 * standing for a missing do-support or "not".
 */
function subjectNoVerb(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<subject>I|you|we|they|he|she)${SPACE}(?<no>no)${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "no",
  )) {
    const { subject, verb } = m.groups!;
    const lower = subject.toLowerCase();
    if (subject !== lower && subject !== "I" && !afterBreak(ctx, m.index)) continue;
    const before = wordBefore(ctx, m.index);
    const why = before === "why";
    if (!afterBreak(ctx, m.index) && !/^(?:but|and|so|why|because|if|when|that)$/.test(before))
      continue;
    const [noStart] = m.indices!.groups!.no;
    const verbEnd = m.indices!.groups!.verb[1];
    const subjectStart = m.indices!.groups!.subject[0];
    const next = tokensAfter(ctx, verbEnd, 1)[0];
    let range: { start: number; end: number };
    let fix: string;
    if (NO_MODAL[verb] && !why) {
      range = { start: noStart, end: verbEnd };
      fix = NO_MODAL[verb];
    } else {
      // "like" is a preposition too; after a subject and "no" it is the verb.
      const read = verb === "like" ? null : englishWordInfo(verb);
      const third = read?.verbs.find((v) => v.form === "third");
      const base =
        verb === "like" || read?.verbs.some((v) => v.form === "base" && v.lemma === verb);
      if ((FUNCTION_WORDS.has(verb) && verb !== "like") || NOT_WORDS.has(verb) || (!base && !third))
        continue;
      // "you no doubt know", "we no sooner…": a noun or comparative reading keeps "no".
      if (/^(?:doubt|matter|sooner|longer|more|less|way|problem|worries|thanks)$/.test(verb))
        continue;
      if (read?.adjective) continue;
      if (
        read?.noun &&
        !(
          !next ||
          next.kind === "end" ||
          (next.kind === "word" &&
            /^(?:the|a|an|my|your|his|her|our|their|it|them|me|us|him|you|this|that|to|english|anything|much)$/.test(
              next.lower,
            ))
        )
      )
        continue;
      const singular = /^(?:he|she)$/.test(lower);
      if (third && !singular) continue;
      const lemma = third ? third.lemma : verb;
      const aux = singular ? "doesn't" : "don't";
      if (why) {
        range = { start: subjectStart, end: verbEnd };
        fix = `${aux} ${subject} ${lemma}`;
      } else {
        range = { start: noStart, end: verbEnd };
        fix = `${aux} ${lemma}`;
      }
    }
    if (findings.some((f) => f.range.start === range.start)) continue;
    findings.push(
      finding("englishConfusedWords", "review_msg_confused_word", range.start, range.end, [fix], {
        context: evidence(ctx, m.index, verbEnd),
      }),
    );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishConfusedWords"], detect: english(noForNot, subjectNoVerb) },
];
