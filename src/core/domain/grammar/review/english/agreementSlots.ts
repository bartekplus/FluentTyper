import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { nounNumber } from "./nounNumberSlots";
import {
  ADVERBS,
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

// Adjectives that name a group as a noun: "the public", "the rich", "the elderly".
const GROUP_ADJECTIVES =
  /^(?:public|rich|poor|elderly|young|old|wealthy|unemployed|homeless|sick|dead|living|blind|deaf|faithful|wise|british|french|english|irish|dutch|welsh|chinese|japanese|swiss)$/;

const normal = (word: string) => word.toLowerCase().replace("’", "'");

/** The plural form of a singular verb token, or null. */
function pluralOf(token: Token, nextToken?: Token, afterNext?: Token): string | null {
  const word = normal(token.lower);
  if (TO_PLURAL[word]) return TO_PLURAL[word];
  if (!/s$/.test(word) || FUNCTION_WORDS.has(word)) return null;
  const read = englishWordInfo(word);
  if (!read?.verbs.some((v) => v.form === "third")) return null;
  // "barks" is also a plural noun: only a verb when an adverb, object or end follows.
  if (read.noun || read.plural) {
    const next = nextToken?.kind === "word" ? englishWordInfo(nextToken.lower) : null;
    // "The properties files still contained…": an adverb before a verb leaves "files" a noun.
    const verbAfter =
      afterNext?.kind === "word" &&
      !!englishWordInfo(afterNext.lower)?.verbs.some(
        (v) => v.form === "past" || v.form === "third",
      );
    const adverbNext =
      nextToken?.kind === "word" &&
      !verbAfter &&
      (ADVERBS.has(nextToken.lower) ||
        /^(?:late|early|fast|hard|well|today|tonight|loudly|everywhere|together)$/.test(
          nextToken.lower,
        ) ||
        (!!next?.adverb && !next.noun));
    const closed =
      !nextToken ||
      nextToken.kind === "end" ||
      adverbNext ||
      (nextToken.kind === "word" &&
        /^(?:the|a|an|my|your|his|her|our|their|it|them|me|us|him|you|that|to|in|on|at|with|for|every|each)$/.test(
          nextToken.lower,
        ));
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
      // An adjective read as the head gives way to a plural noun after it: "The black cats sleeps".
      if (
        head &&
        /s$/.test(word) &&
        read?.verbs.some((v) => v.form === "third") &&
        !(read.plural && englishWordInfo(head)?.adjective && /s$/.test(tokens[i + 1]?.lower ?? ""))
      )
        break;
      // A bare verb with no noun reading after a singular head: "The dog eat.", "Our success
      // depend on…".
      if (head && !number && bareVerbOnly(word)) break;
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
      const object = j;
      while (
        j < i + 4 &&
        tokens[j]?.kind === "word" &&
        !TO_PLURAL[normal(tokens[j].lower)] &&
        !TO_SINGULAR[normal(tokens[j].lower)] &&
        // "The users in Asia wants": an -s verb after the phrase's noun.
        !(
          j > object &&
          tokens[j].text === tokens[j].lower &&
          /s$/.test(tokens[j].lower) &&
          englishWordInfo(tokens[j].lower)?.verbs.some((v) => v.form === "third")
        )
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
        // "The public demands answers": after an adjective used as a noun, the head may itself
        // be the verb.
        (tokens.slice(0, i).some((t) => GROUP_ADJECTIVES.test(t.lower)) &&
          !!englishWordInfo(head)?.verbs.some((v) => v.form === "third")))
    )
      continue;
    const number = nounNumber(head)!;
    if (COLLECTIVE.has(head) || COLLECTIVE.has(number.singular)) continue;
    // "this/that" before a noun is singular; plural determiners must have a plural head.
    if (number.number === "plural") {
      if (/^(?:this|that)$/.test(det) && verbAt === i) continue;
      const fix = pluralOf(verb, tokens[verbAt + 1], tokens[verbAt + 2]);
      if (fix) push(ctx, findings, verb, fix, m.index);
    } else if (!/^(?:these|those|many|several|both|some|most)$/.test(det)) {
      let fix = TO_SINGULAR[normal(verb.lower)];
      // "We ask that the user restart": a mandative subjunctive keeps the bare verb.
      if (
        !fix &&
        verbAt === i &&
        !/^(?:that|lest)$/.test(wordBefore(ctx, m.index)) &&
        bareVerbOnly(verb.lower) &&
        closedAfter(tokens[verbAt + 1])
      )
        fix = englishInflect(verb.lower, "third") ?? "";
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
    const tokens = tokensAfter(ctx, m.index + m[0].length, 3);
    const verb = tokens[0];
    if (verb?.kind !== "word" || verb.text !== verb.lower || !verbOnlyThird(verb)) continue;
    const fix = pluralOf(verb, tokens[1], tokens[2]);
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
    const tokens = tokensAfter(ctx, m.index + m[0].length, 3);
    const verb = tokens[0];
    if (verb?.kind !== "word" || verb.text !== verb.lower || !verbOnlyThird(verb)) continue;
    if (!TO_PLURAL[normal(verb.lower)] && auxiliaryLater(tokensAfter(ctx, verb.end, 6), 0))
      continue;
    const fix = pluralOf(verb, tokens[1], tokens[2]);
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

const RELATIVE_SUBJECT = `(?<det>the|these|those|my|our|their|his|her|your|all|many|some|most|this|that|a|an|every|each)${SPACE}(?<head>(?:[a-z]+${SPACE}){0,2}?[a-z]+)${SPACE}(?:who|that)${SPACE}(?=[a-z])`;
const PRONOUN_HEAD = `(?<head>anyone|anybody|someone|somebody|everyone|everybody|nobody)${SPACE}who${SPACE}(?=[a-z])`;
// Words after which a bare verb continues the clause: "helped clean", "made me laugh".
const CATENATIVE =
  /^(?:help|helps|helped|let|lets|make|makes|made|watch|watched|see|saw|seen|hear|heard|have|has|had|do|does|did|will|would|can|could|shall|should|may|might|must|to|not|never|dare|rather|better)$/;
const TIME_WORDS =
  /^(?:yesterday|today|tonight|now|then|before|earlier|later|here|there|again|early|late|hard|fast|well)$/;
const SINGULAR_FIX: Record<string, string> = { have: "has", are: "is", were: "was", do: "does" };

const BE_OR_AUX =
  /^(?:is|are|was|were|am|has|have|had|do|does|did|will|would|can|could|should|may|might|must)$/;

/**
 * "The ladies who talk loudly annoys me", "The tall woman that I met yesterday manage the team":
 * the main verb after a relative clause agrees with the noun before who/that. The clause must
 * have its own verb, and the main verb must follow an adverb, a time word or that verb.
 */
function relativeClauseSubject(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const pattern of [RELATIVE_SUBJECT, PRONOUN_HEAD])
    for (const m of frameMatches(ctx, pattern, null)) {
      if (!afterBreak(ctx, m.index) && !CLAUSE_CUE.test(wordBefore(ctx, m.index))) continue;
      // "A new WHO report": the relative pronoun is lowercase.
      if (!/[ \t\u00a0](?:who|that)[ \t\u00a0]+$/.test(m[0])) continue;
      const words = m.groups!.head.split(/[ \t ]+/);
      if (process.env.DBG) console.log("PRE", m[0]);
      const head = words.at(-1)!;
      if (words.some((w) => FUNCTION_WORDS.has(w) || BE_OR_AUX.test(w))) continue;
      // Modifiers before the head are adjectives or nouns, never verbs.
      if (words.slice(0, -1).some((w) => englishWordInfo(w)?.verbs.some((v) => v.form !== "base")))
        continue;
      const headRead = englishWordInfo(head);
      const number = !m.groups!.det
        ? { singular: head, plural: head, number: "singular" as const }
        : (nounNumber(head) ??
          // "guys" is also a verb the noun pairs skip: the lexicon's plural reading.
          (headRead?.noun && headRead.plural && /s$/.test(head)
            ? { singular: head.slice(0, -1), plural: head, number: "plural" as const }
            : null));
      if (!number || COLLECTIVE.has(number.singular) || NUMBERS.test(head)) continue;
      const det = (m.groups!.det ?? "").toLowerCase();
      const plural = number.number === "plural";
      if (
        plural
          ? /^(?:a|an|this|that|every|each)$/.test(det)
          : /^(?:these|those|many|all|most)$/.test(det)
      )
        continue;
      if (process.env.DBG) console.log("REL", m[0], number);
      const tokens = tokensAfter(ctx, m.index + m[0].length, 10);
      // The clause's own verb; the main verb comes right after it or after adverbs.
      let clauseVerb = -1;
      for (let j = 0; j < tokens.length; j++) {
        const t = tokens[j];
        if (t.kind !== "word" || (t.text !== t.lower && t.text !== "I")) break;
        if (/^(?:and|but|or|because|if|when|which|who|that|while)$/.test(t.lower)) break;
        const read = englishWordInfo(t.lower);
        const verb =
          BE_OR_AUX.test(t.lower) || (!!read?.verbs.length && !FUNCTION_WORDS.has(t.lower));
        if (clauseVerb < 0) {
          if (verb) clauseVerb = j;
          continue;
        }
        const prev = tokens[j - 1];
        const prevRead = englishWordInfo(prev.lower);
        const adverbBefore =
          ADVERBS.has(prev.lower) ||
          TIME_WORDS.test(prev.lower) ||
          (!!prevRead?.adverb && !prevRead.noun && !prevRead.adjective && !prevRead.verbs.length);
        const afterClauseVerb = j - 1 === clauseVerb && !CATENATIVE.test(prev.lower);
        // "that he can not use", "its gonna randomly scramble": a bare verb after a modal.
        if (
          tokens
            .slice(clauseVerb, j)
            .some((w) => CATENATIVE.test(w.lower) || /^(?:gonna|wanna|gotta)$/.test(w.lower))
        )
          break;
        if (!adverbBefore && !afterClauseVerb) {
          if (verb) break;
          continue;
        }
        if (!verb) continue;
        // Right after the clause verb a noun reading may be its object ("who play sports").
        if (adverbBefore || (!read?.noun && !read?.adjective)) {
          let fix: string | null = null;
          if (plural) fix = pluralOf(t, tokens[j + 1], tokens[j + 2]);
          else if (SINGULAR_FIX[t.lower]) fix = SINGULAR_FIX[t.lower];
          else if (
            read?.verbs.some((v) => v.form === "base" && v.lemma === t.lower) &&
            (adverbBefore || !read.adjective) &&
            (!read.noun || closedAfter(tokens[j + 1]))
          )
            fix = englishInflect(t.lower, "third");
          if (fix && fix !== t.lower) push(ctx, findings, t, fix, m.index);
        } else if (read?.noun) continue; // "who answers calls rarely forget": an object.
        break;
      }
    }
  return findings;
}

/** A base verb and nothing else: no noun, adjective or same-spelled past ("let", "put"). */
function bareVerbOnly(word: string): boolean {
  // "Your ticket please.": a politeness word, not a verb.
  if (FUNCTION_WORDS.has(word) || /s$|^(?:please|thank|beware)$/.test(word)) return false;
  const read = englishWordInfo(word);
  const forms = englishVerbForms(word);
  return (
    !!read &&
    read.verbs.some((v) => v.form === "base" && v.lemma === word) &&
    read.verbs.every((v) => v.form === "base") &&
    !read.noun &&
    !read.adjective &&
    !read.adverb &&
    !nounNumber(word) &&
    !(forms && (forms.past === word || forms.participle === word))
  );
}

/** An object, particle, preposition, adverb or the clause end after a verb that is also a noun. */
function closedAfter(t: Token | undefined): boolean {
  if (!t || t.kind === "end") return true;
  if (t.kind !== "word") return false;
  return (
    /^(?:the|a|an|my|your|his|her|our|their|it|them|me|us|him|you|this|that|to|in|on|at|with|for|up|down|out|off|through|into|again|every|each)$/.test(
      t.lower,
    ) || ADVERBS.has(t.lower)
  );
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishSubjectVerbAgreement"],
    detect: english(
      nounSubject,
      irregularPlurals,
      demonstratives,
      invertedAuxiliary,
      relativeClauseSubject,
    ),
  },
];
