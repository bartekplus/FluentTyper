import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  caseLike,
  english,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  tokensAfter,
  wordBefore,
} from "./slotWords";

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
  if (nounOnly(word)) return true;
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
    `(?:(?<there>there)${SPACE}(?:is|are|was|were)|there['’]s|(?<have>i|you|we|they|he|she|it)${SPACE}(?:have|has|had))${SPACE}(?<target>not)${SPACE}(?<word>[a-z]+)${WORD_END}`,
  )) {
    const word = m.groups!.word;
    const [next] = tokensAfter(ctx, m.index + m[0].length, 1);
    const have = !!m.groups!.have;
    // "The cooks there are not chefs": "there" after a noun is a place.
    const before = wordBefore(ctx, m.index);
    if (
      before &&
      !FUNCTION_WORDS.has(before) &&
      !/^(?:say|said|think|believe|assume|assuming)$/.test(before)
    )
      continue;
    // "there is not time to", "not one", "not much": the noun must head its phrase.
    if (!bareNoun(word, have)) continue;
    if (next?.kind === "word" && nounOnly(next.lower) && !have) continue;
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

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishConfusedWords"], detect: english(noForNot) },
];
