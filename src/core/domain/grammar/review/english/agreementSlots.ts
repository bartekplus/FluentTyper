import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { nounNumber } from "./nounNumberSlots";
import {
  afterBreak,
  caseLike,
  english,
  evidence,
  FUNCTION_WORDS,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";

// Subject-verb number agreement with noun-phrase subjects the lexicon can number: "The dogs
// barks", "Some people thinks", "Do your father live…?", "These includes", "This are".

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const TO_PLURAL: Record<string, string> = {
  is: "are",
  was: "were",
  has: "have",
  does: "do",
  "isn't": "aren't",
  "wasn't": "weren't",
  "hasn't": "haven't",
  "doesn't": "don't",
};
const TO_SINGULAR: Record<string, string> = {
  are: "is",
  were: "was",
  "aren't": "isn't",
  "weren't": "wasn't",
};
// Nouns that take a plural verb in British use or name a group: "The team are…".
const COLLECTIVE = new Set(
  "team staff family police government committee crew band audience public class group majority rest number couple pair lot jury army navy board council club company firm management media data total variety range series species means news remainder masters woods belt".split(
    " ",
  ),
);

const normal = (word: string) => word.toLowerCase().replace("’", "'");

/** The plural form of a singular verb token, or null. */
function pluralOf(token: Token, nextToken: Token | undefined): string | null {
  const word = normal(token.lower);
  if (TO_PLURAL[word]) return TO_PLURAL[word];
  if (!/s$/.test(word) || FUNCTION_WORDS.has(word)) return null;
  const read = englishWordInfo(word);
  if (!read?.verbs.some((v) => v.form === "third")) return null;
  // "barks" is also a plural noun: only a verb when an adverb, object or end follows.
  if (read.noun || read.plural) {
    const next = nextToken?.kind === "word" ? englishWordInfo(nextToken.lower) : null;
    const closed =
      !nextToken ||
      nextToken.kind === "end" ||
      (nextToken.kind === "word" &&
        (/^(?:the|a|an|my|your|his|her|our|their|it|them|me|us|him|you|that|to|in|on|at|with|for)$/.test(
          nextToken.lower,
        ) ||
          (!!next?.adverb && !next.noun)));
    if (!closed) return null;
  }
  return englishLemma(word, "third");
}

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  token: Token,
  replacement: string,
  from: number,
): void {
  if (findings.some((f) => f.range.start === token.start)) return;
  findings.push({
    ruleId: "englishSubjectVerbAgreement",
    messageKey: "review_msg_subject_verb",
    range: { start: token.start, end: token.end },
    alternatives: [caseLike(token.text, replacement)],
    context: evidence(ctx, from, token.end),
  });
}

const CLAUSE_CUE = /^(?:whether|when|if|that|because|since|while|where)$/;
const NUMBERS = /^(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million)$/;
// A conditional or wish keeps "were": "If the county were to build…".
const SUBJUNCTIVE = /\b(?:if|wish|wished|as though|as if|suppose|unless)\b[^.!?;:\n]*$/i;

/** A be/have/modal later in the clause: the -s word before it was a noun ("futures prices… have"). */
function auxiliaryLater(tokens: Token[], from: number): boolean {
  for (const t of tokens.slice(from)) {
    if (t.kind !== "word") return false;
    if (
      /^(?:is|are|was|were|has|have|had|will|would|can|could|should|must|may|might)$/.test(t.lower)
    )
      return true;
  }
  return false;
}

/** An -s word read only as a verb: "includes", "seems", not "flips", "confirms". */
function verbOnlyThird(token: Token | undefined): boolean {
  if (token?.kind !== "word") return false;
  const word = normal(token.lower);
  if (TO_PLURAL[word]) return true;
  const read = englishWordInfo(word);
  return !!read?.verbs.some((v) => v.form === "third") && !read.noun && !read.plural;
}

/** "The dogs barks loudly", "The dog are released": a determiner-led subject and its verb. */
function nounSubject(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<target>the|these|those|my|your|his|her|our|their|many|some|most|both|several|this|that)${SPACE}(?=[a-z])`,
  )) {
    if (!afterBreak(ctx, m.index) && !CLAUSE_CUE.test(wordBefore(ctx, m.index))) continue;
    const det = m.groups!.target.toLowerCase();
    const tokens = tokensAfter(ctx, m.index + m[0].length, 9);
    if (tokens.some((t) => t.kind === "other")) continue;
    // Modifiers and the head noun, then an optional of/in phrase, then the verb.
    let i = 0;
    let head: string | null = null;
    let abort = false;
    while (i < 4 && tokens[i]?.kind === "word" && tokens[i].text === tokens[i].lower) {
      const word = tokens[i].lower;
      if (FUNCTION_WORDS.has(word) || TO_PLURAL[normal(word)] || TO_SINGULAR[normal(word)]) break;
      if (NUMBERS.test(word)) {
        abort = true;
        break;
      }
      const number = nounNumber(word);
      const read = englishWordInfo(word);
      // After the head, an -s word that is also a verb is the verb: "The cats sleeps".
      if (head && /s$/.test(word) && read?.verbs.some((v) => v.form === "third")) break;
      // A postmodifier after the head ("the solvents present in…") or an adjective used as a
      // noun ("the rich"): not this frame.
      if (head && (!number || read?.adjective)) {
        abort = true;
        break;
      }
      if (number) head = word;
      else if (!read?.adjective) break;
      i++;
    }
    if (!head || abort || englishWordInfo(head)?.adjective) continue;
    let verbAt = i;
    if (/^(?:of|in)$/.test(tokens[i]?.lower ?? "")) {
      // "The dogs of war is", "The chemicals in Botox is": skip a short phrase.
      let j = i + 1;
      if (/^(?:the|a|an|my|your|his|her|our|their)$/.test(tokens[j]?.lower ?? "")) j++;
      while (
        j < i + 4 &&
        tokens[j]?.kind === "word" &&
        !TO_PLURAL[normal(tokens[j].lower)] &&
        !TO_SINGULAR[normal(tokens[j].lower)]
      )
        j++;
      verbAt = j;
    }
    const verb = tokens[verbAt];
    if (verb?.kind !== "word" || verb.text !== verb.lower) continue;
    if (
      /^were$/.test(verb.lower) &&
      SUBJUNCTIVE.test(ctx.text.slice(Math.max(0, m.index - 64), m.index))
    )
      continue;
    if (
      !TO_PLURAL[normal(verb.lower)] &&
      !TO_SINGULAR[normal(verb.lower)] &&
      (auxiliaryLater(tokens, verbAt + 1) ||
        // "The public demands answers": the head may itself be the verb.
        !!englishWordInfo(head)?.verbs.some((v) => v.form === "third"))
    )
      continue;
    const number = nounNumber(head)!;
    if (COLLECTIVE.has(head) || COLLECTIVE.has(number.singular)) continue;
    // "this/that" before a noun is singular; plural determiners must have a plural head.
    if (number.number === "plural") {
      if (/^(?:this|that)$/.test(det) && verbAt === i) continue;
      const fix = pluralOf(verb, tokens[verbAt + 1]);
      if (fix) push(ctx, findings, verb, fix, m.index);
    } else if (!/^(?:these|those|many|several|both|some|most)$/.test(det)) {
      const fix = TO_SINGULAR[normal(verb.lower)];
      if (fix) push(ctx, findings, verb, fix, m.index);
    }
  }
  return findings;
}

/** "Some people thinks", "people who knows": irregular plural subjects with a singular verb. */
function irregularPlurals(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:(?<det>some|most|many|these|those|the|our|their|my|your|all|other)${SPACE})?(?<target>people|children|men|women)${SPACE}(?=[a-z])`,
  )) {
    // Only a clause-opening subject: "Meeting new people is hard" has people as an object.
    if (!afterBreak(ctx, m.index) && !CLAUSE_CUE.test(wordBefore(ctx, m.index))) continue;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 2);
    const verb = tokens[0];
    if (verb?.kind !== "word" || verb.text !== verb.lower || !verbOnlyThird(verb)) continue;
    const fix = pluralOf(verb, tokens[1]);
    if (fix) push(ctx, findings, verb, fix, m.index);
  }
  return findings;
}

/** "These includes", "Those two is", "This are my notes": a demonstrative and its verb. */
function demonstratives(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<target>these|those)(?:${SPACE}(?:two|three|four|five|both|all))?${SPACE}(?=[a-z])`,
  )) {
    if (!afterBreak(ctx, m.index) && !CLAUSE_CUE.test(wordBefore(ctx, m.index))) continue;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 2);
    const verb = tokens[0];
    if (verb?.kind !== "word" || verb.text !== verb.lower || !verbOnlyThird(verb)) continue;
    if (!TO_PLURAL[normal(verb.lower)] && auxiliaryLater(tokensAfter(ctx, verb.end, 6), 0))
      continue;
    const fix = pluralOf(verb, tokens[1]);
    if (fix) push(ctx, findings, verb, fix, m.index);
  }
  for (const m of frameMatches(ctx, `(?<target>this|that)${SPACE}(?<verb>are|were)${WORD_END}`)) {
    if (!afterBreak(ctx, m.index)) continue;
    const target = m.groups!.target;
    const [start, end] = m.indices!.groups!.target;
    if (findings.some((f) => f.range.start === start)) continue;
    findings.push({
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start, end },
      alternatives: [caseLike(target, target.toLowerCase() === "this" ? "these" : "those")],
      context: evidence(ctx, m.index, end + 5),
    });
  }
  return findings;
}

/** "Do your father live…?", "Has your parents told…?", "Where is your dogs?": an inverted aux. */
function invertedAuxiliary(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const singular: Record<string, string> = { do: "does", have: "has", are: "is", were: "was" };
  const plural: Record<string, string> = { does: "do", has: "have", is: "are", was: "were" };
  for (const m of frameMatches(
    ctx,
    `(?<aux>do|does|have|has|is|are|was|were)${SPACE}(?:the|your|my|his|her|our|their)${SPACE}(?<noun>[a-z]+)(?:${SPACE}(?<verb>[a-z]+))?${WORD_END}`,
    "aux",
  )) {
    const before = wordBefore(ctx, m.index);
    if (!afterBreak(ctx, m.index) && !/^(?:what|where|when|why|how|who|which)$/.test(before))
      continue;
    const { aux, noun, verb } = m.groups!;
    const a = aux.toLowerCase();
    const number = nounNumber(noun);
    if (!number || COLLECTIVE.has(number.singular) || NUMBERS.test(noun)) continue;
    const read = verb ? englishWordInfo(verb) : null;
    // A verb must follow do/have ("Do your homework" is an order); be may end the question.
    if (/^(?:do|does)$/.test(a) && !read?.verbs.some((v) => v.form === "base" && v.lemma === verb))
      continue;
    if (/^(?:have|has)$/.test(a) && !read?.verbs.some((v) => v.form === "participle")) continue;
    if (
      /^(?:is|are|was|were)$/.test(a) &&
      verb &&
      !read?.verbs.some((v) => v.form === "ing" || v.form === "participle")
    )
      continue;
    if (
      /^(?:is|are|was|were)$/.test(a) &&
      !verb &&
      !/^(?:what|where|when|why|how|who|which)$/.test(before)
    )
      continue;
    // "Do your parents…" vs "Does your father…": the noun's number decides.
    if (verb && read?.plural) continue;
    // "Do the zip file installation steps work…": the noun phrase goes on.
    const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (verb && read?.noun && after?.kind === "word" && nounNumber(after.lower)) continue;
    const fix = number.number === "plural" ? plural[a] : singular[a];
    if (!fix) continue;
    const [start, end] = m.indices!.groups!.aux;
    findings.push({
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start, end },
      alternatives: [caseLike(aux, fix)],
      context: evidence(ctx, m.index, m.index + m[0].length),
    });
  }
  // "Does you have…?", "Does anyone knows?": do + a pronoun or indefinite subject.
  for (const m of frameMatches(
    ctx,
    `(?<aux>does)${SPACE}(?<subject>you|I|we|they)${WORD_END}`,
    "aux",
  )) {
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:but|and|so|what|where|when|why|how)$/.test(wordBefore(ctx, m.index))
    )
      continue;
    const [start, end] = m.indices!.groups!.aux;
    findings.push({
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start, end },
      alternatives: [caseLike(m.groups!.aux, "do")],
      context: evidence(ctx, m.index, m.index + m[0].length),
    });
  }
  for (const m of frameMatches(
    ctx,
    `(?:does|do|did)${SPACE}(?:anyone|anybody|someone|somebody|everyone|nobody)(?:${SPACE}here)?${SPACE}(?<verb>[a-z]+s)${WORD_END}`,
    "verb",
  )) {
    const verb = m.groups!.verb;
    const forms = englishVerbForms(verb);
    const lemma =
      verb === "has" ? "have" : forms?.third === verb ? forms.lemma : englishLemma(verb, "third");
    if (!lemma || lemma === verb || !englishInflect(lemma, "third")) continue;
    const [start, end] = m.indices!.groups!.verb;
    findings.push({
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start, end },
      alternatives: [lemma],
      context: evidence(ctx, m.index, end),
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishSubjectVerbAgreement"],
    detect: english(nounSubject, irregularPlurals, demonstratives, invertedAuxiliary),
  },
];
