import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { COLLECTIVE } from "./agreementSlots";
import { nounNumber } from "./nounNumberSlots";
import {
  ADVERBS,
  afterBreak,
  caseLike,
  nounOnly,
  evidence,
  FUNCTION_WORDS,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";

// Subject-verb agreement across a relative clause that has its own verb and complements:
// "The laptop that she bought last week run hot", "The keys that I left on the table belongs
// to Sam". The clause is read token by token; anything it cannot read ends the check.
// The frames are in grammar/rules/en.yaml.

// Not "and": "The cups and the plate that sit there are clean" coordinates the subject.
const CLAUSE_CUE = /^(?:whether|when|if|that|because|since|while|where|but|so)$/;
const SUBJECT = /^(?:i|you|he|she|we|they)$/;
const NP_DET =
  /^(?:the|a|an|my|your|his|her|our|their|its|this|that|these|those|some|every|each|other|no)$/;
const AUX =
  /^(?:will|would|can|could|shall|should|may|might|must|do|does|did|don't|doesn't|didn't|won't|can't|cannot|couldn't|wouldn't|shouldn't|has|have|had|hasn't|haven't|hadn't|is|are|was|were|isn't|aren't|wasn't|weren't|am)$/;
// Clause verbs that take a bare verb or a second complement after their object: "helps pay",
// "made run", "watched chase", "call home", "noticed leave".
const BARE_OR_SECOND =
  /^(?:help|let|make|have|see|watch|hear|feel|notice|bid|call|name|elect|consider|find|keep|appoint|deem|label|dub|think|get|want|need|like|prefer|go|come|try|dare)$/;
const TIME_NOUN =
  /^(?:week|month|year|night|morning|afternoon|evening|day|weekend|summer|winter|spring|autumn|fall|time)$/;
const TIME_WORD =
  /^(?:yesterday|today|tonight|now|then|earlier|later|again|recently|once|twice|daily|weekly|monthly|yearly|here|there|ago)$/;
const PARTICLE = /^(?:in|out|up|down|off|on|away|back|over|around)$/;
// Prepositions that open a phrase inside the clause; "to" only before a determiner.
const PREPOSITION =
  /^(?:at|on|in|to|for|from|with|by|of|about|into|onto|across|near|under|over|behind|after|before|during|through|around|inside|outside|between|among|without|along)$/;

const normal = (word: string) => word.toLowerCase().replaceAll("’", "'");
const read = (t: Token | undefined) =>
  t?.kind === "word" && !FUNCTION_WORDS.has(t.lower) ? englishWordInfo(t.lower) : null;
const isVerb = (t: Token | undefined) => !!read(t)?.verbs.length;
// Unknown lowercase words count: the lexicon leaves out many plain nouns ("critics").
const isNoun = (t: Token | undefined) =>
  t?.kind === "word" &&
  (t.text !== t.lower
    ? t.lower !== "i"
    : !FUNCTION_WORDS.has(t.lower) &&
      (!englishWordInfo(t.lower) || !!read(t)?.noun || !!nounNumber(t.lower)));
const OBJECT = /^(?:me|him|her|us|them|it|you)$/;
const adverbish = (t: Token | undefined) => {
  if (t?.kind !== "word") return false;
  if (ADVERBS.has(t.lower) || TIME_WORD.test(t.lower)) return true;
  const r = englishWordInfo(t.lower);
  return !!r?.adverb && !r.noun && !r.verbs.length && /ly$/.test(t.lower);
};

/** "last week", "every morning", "each afternoon": a time phrase's length, or 0. */
function timePhrase(tokens: Token[], j: number): number {
  if (
    /^(?:last|every|each|this|next)$/.test(tokens[j]?.lower ?? "") &&
    TIME_NOUN.test(tokens[j + 1]?.lower ?? "")
  )
    return 2;
  return adverbish(tokens[j]) ? 1 : 0;
}

/**
 * A noun phrase from `j` (determiners, modifiers, head): its end index, or -1. A subject phrase
 * ends at the first word after a noun that can be a verb ("the critics praised").
 */
function nounPhrase(tokens: Token[], j: number, maxWords: number, subject = false): number {
  let k = j;
  while (tokens[k]?.kind === "word" && NP_DET.test(tokens[k].lower)) k++;
  if (tokens[k]?.kind === "number") k++;
  const start = k;
  while (k < start + maxWords && isNoun(tokens[k])) {
    k++;
    if (subject ? isVerb(tokens[k]) : candidateAfterNoun(tokens, k)) break;
  }
  // A modifier-only phrase ("the big") cannot end the clause; nor can a phrase that took
  // no word after its determiner.
  return k > start ? k : -1;
}

/** Whether the word at `k` (after a noun) can only be read as a verb. */
function candidateAfterNoun(tokens: Token[], k: number): boolean {
  const r = read(tokens[k]);
  return !!r?.verbs.length && !r.noun && !r.adjective;
}

/** The main-verb candidate after the relative clause that starts at `tokens[0]`, or -1. */
function mainVerbIndex(tokens: Token[]): { index: number; free: boolean } | null {
  let j = 0;
  let objectGap = false;
  // The clause's own subject: "that she bought", "that the critics praised", "that people use".
  if (tokens[j]?.kind === "word" && (SUBJECT.test(tokens[j].lower) || tokens[j].text === "I")) {
    j++;
    objectGap = true;
  } else if (
    tokens[j]?.kind === "word" &&
    (/^(?:people|men|women|children)$/.test(tokens[j].lower) || nounOnly(tokens[j].lower)) &&
    isVerb(tokens[j + 1])
  ) {
    j++;
    objectGap = true;
  } else if (tokens[j]?.kind === "word" && NP_DET.test(tokens[j].lower)) {
    const end = nounPhrase(tokens, j, 3, true);
    if (end < 0) return null;
    j = end;
    objectGap = true;
  }
  while (adverbish(tokens[j])) j++;
  // The clause's verb group.
  let verb: Token | undefined;
  if (AUX.test(normal(tokens[j]?.lower ?? ""))) {
    j++;
    while (tokens[j]?.lower === "not" || adverbish(tokens[j])) j++;
    if (/^(?:been|being|be)$/.test(tokens[j]?.lower ?? "")) j++;
    if (!isVerb(tokens[j])) return null;
    verb = tokens[j++];
  } else if (isVerb(tokens[j]) && tokens[j].text === tokens[j].lower) {
    verb = tokens[j++];
  } else return null;
  const r = englishWordInfo(verb.lower);
  const lemmas = r?.verbs.map((v) => v.lemma) ?? [];
  if (lemmas.some((l) => BARE_OR_SECOND.test(l))) return null;
  if (tokens[j]?.lower === "to" && !NP_DET.test(tokens[j + 1]?.lower ?? "")) return null;
  // "that he uses run on": with the relative pronoun as its object, the clause verb has no
  // object of its own, so a verb right after it is the main verb.
  // "built stone by stone": a repeated noun is an adverbial.
  if (
    objectGap &&
    !PARTICLE.test(tokens[j]?.lower ?? "") &&
    !timePhrase(tokens, j) &&
    !(tokens[j + 1]?.lower === "by" && tokens[j + 2]?.lower === tokens[j]?.lower)
  ) {
    const next = read(tokens[j]);
    if (next?.verbs.length) return { index: j, free: true };
  }
  let tookObject = objectGap;
  for (let guard = 0; guard < 6 && j < tokens.length; guard++) {
    const t = tokens[j];
    if (t.kind !== "word") return null;
    const time = timePhrase(tokens, j);
    if (time) {
      j += time;
      if (isVerb(tokens[j]) && tokens[j].text === tokens[j].lower) return { index: j, free: true };
      continue;
    }
    if (PARTICLE.test(t.lower) && !NP_DET.test(tokens[j + 1]?.lower ?? "")) {
      j++;
      continue;
    }
    if (PREPOSITION.test(t.lower)) {
      if (t.lower === "to" && !NP_DET.test(tokens[j + 1]?.lower ?? "")) return null;
      const end = nounPhrase(tokens, j + 1, 3);
      if (end < 0) return null;
      j = end;
      tookObject = true;
      if (candidate(tokens, j)) return { index: j, free: false };
      continue;
    }
    if (!tookObject && OBJECT.test(t.lower)) {
      j++;
      tookObject = true;
      continue;
    }
    if (!tookObject && (NP_DET.test(t.lower) || isNoun(t))) {
      const end = nounPhrase(tokens, j, 3);
      if (end < 0) return null;
      j = end;
      tookObject = true;
      if (candidate(tokens, j)) return { index: j, free: false };
      continue;
    }
    return candidate(tokens, j) ? { index: j, free: false } : null;
  }
  return null;
}

/** A word right after a noun phrase that is read as a verb (and not only as more noun). */
function candidate(tokens: Token[], j: number): boolean {
  const t = tokens[j];
  if (t?.kind !== "word" || t.text !== t.lower) return false;
  if (AUX.test(normal(t.lower))) return true;
  const r = t.lower === "own" ? englishWordInfo("own") : read(t);
  if (!r?.verbs.length) return false;
  if (!r.noun && !r.adjective) return true;
  // "at my birthdays ask my mom": a bare verb after a plural noun cannot extend that noun.
  const prev = tokens[j - 1];
  return (
    prev?.kind === "word" &&
    nounNumber(prev.lower)?.number === "plural" &&
    r.verbs.some((v) => v.form === "base") &&
    !r.plural
  );
}

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
  "aren't": "isn't",
  have: "has",
  "haven't": "hasn't",
  do: "does",
  "don't": "doesn't",
};

/** A closed word after the main verb: its object, a particle, an adverb or the clause end. */
function closes(t: Token | undefined): boolean {
  if (!t || t.kind === "end" || t.kind === "comma") return true;
  if (t.kind !== "word") return false;
  if (
    /^(?:the|a|an|my|your|his|her|our|their|its|it|them|me|us|him|you|this|that|these|those|to|in|on|at|with|for|up|down|out|off|through|into|about|from|by|over|under|every|each|some|any|no|well|very|so|too|more|less)$/.test(
      t.lower,
    )
  )
    return true;
  const r = englishWordInfo(t.lower);
  // A capitalized word is a name: "tour Europe".
  return t.text !== t.lower || adverbish(t) || (!!r && !r.verbs.length && (r.noun || r.adjective));
}

const MODAL = /^(?:will|can|may|must|shall|ought)$/;
// Nouns whose "that" opens a complement clause, not a relative one: "the fact that…".
const CONTENT_NOUN =
  /^(?:fact|idea|belief|claim|news|notion|hope|fear|chance|possibility|rumou?r|sense|feeling|thought|view|argument|assumption|evidence|proof|sign|point|suggestion|impression|doubt|realization|knowledge|risk|danger|theory|statement|report|message|announcement|promise|condition|requirement|reminder)$/;

/**
 * The agreeing form of `verb`, or null. `free`: right after the clause verb, where a noun
 * reading is unlikely; `aside`: right after a closing comma, where it is the verb.
 */
function fixFor(
  verb: Token,
  next: Token | undefined,
  plural: boolean,
  free: boolean,
  aside = false,
) {
  const word = normal(verb.lower);
  if (MODAL.test(word) || (/^(?:need|dare)$/.test(word) && next?.lower === "not")) return null;
  if (plural) {
    if (TO_PLURAL[word]) return TO_PLURAL[word];
    if (!/s$/.test(word)) return null;
    const r = englishWordInfo(word);
    if (!r?.verbs.some((v) => v.form === "third")) return null;
    // An -s word that is also a plural noun: only after the clause verb or before a closed word.
    if ((r.noun || r.plural) && !aside && !(free && closes(next))) return null;
    return englishVerbForms(word)?.third === word
      ? englishVerbForms(word)!.lemma
      : englishLemma(word, "third");
  }
  if (TO_SINGULAR[word]) return TO_SINGULAR[word];
  const r = englishWordInfo(word);
  if (!r?.verbs.some((v) => v.form === "base" && v.lemma === word)) return null;
  // "put", "cut": the same spelling is a past tense.
  const forms = englishVerbForms(word);
  if (forms?.past === word) return null;
  if ((r.adjective && !aside) || ((r.noun || r.plural) && !closes(next) && !aside)) return null;
  return englishInflect(word, "third");
}

const SAME_PLURAL = /^(?:fish|deer|moose|salmon|trout|cod|bison|swine|offspring|aircraft|craft)$/;
const ASIDE_OPENER =
  /^(?:for|in|of|however|therefore|though|too|who|which|whose|mostly|mainly|largely|chiefly|primarily|especially)$/;
const ASIDE_FIXED =
  /^(?:for example|for instance|in fact|in particular|in turn|in general|of course|however|therefore|though|too|mostly|mainly|largely|chiefly|primarily|especially|who|which|whose)\b/;

/** The index just past a comma-closed aside that starts at `j` ("for example,", "who is 8,"), or -1. */
function asideEnd(tokens: Token[], j: number): number {
  const opener = tokens[j];
  if (opener?.kind !== "word" || !ASIDE_OPENER.test(opener.lower)) return -1;
  const phrase = tokens
    .slice(j, j + 2)
    .map((t) => t.lower)
    .join(" ");
  if (!ASIDE_FIXED.test(phrase)) return -1;
  for (let k = j + 1; k < Math.min(tokens.length, j + 14); k++) {
    if (tokens[k].kind === "comma") return k + 1;
    if (tokens[k].kind !== "word" && tokens[k].kind !== "number") return -1;
  }
  return -1;
}

function agreementFinding(ctx: DetectContext, verb: Token, fix: string, from: number): RawFinding {
  return {
    ruleId: "englishSubjectVerbAgreement",
    messageKey: "review_msg_subject_verb",
    range: { start: verb.start, end: verb.end },
    alternatives: [caseLike(verb.text, fix)],
    context: evidence(ctx, from, verb.end),
  };
}

// "What time the shop opens…", "What size shoes…": nouns that "what" modifies.
const WHAT_NOUNS =
  /^(?:time|kind|sort|type|size|colou?r|way|place|part|use|name|number|day|year|age|price|level|page|line|version|model|brand|course|book|song|film|movie|team|language|shape|form|stage|step|role|job|work|food|sport|subject)$/;

const THIRD_AUX: Record<string, string> = {
  have: "has",
  do: "does",
  are: "is",
  "haven't": "hasn't",
  "don't": "doesn't",
  "aren't": "isn't",
};

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  /**
   * "The laptop that she bought last week run hot", "The keys that I left on the table belongs
   * to Sam": the verb after a relative clause agrees with the noun before who/that.
   */
  clauseAgreementRelativeClauseVerb: (m, ctx) => {
    if (!afterBreak(ctx, m.index) && !CLAUSE_CUE.test(wordBefore(ctx, m.index))) return null;
    if (!/[ \t ](?:who|that)[ \t ]+$/.test(m[0])) return null;
    const words = m.groups!.head.split(/[ \t ]+/);
    if (words.some((w) => FUNCTION_WORDS.has(w) || AUX.test(w))) return null;
    if (words.slice(0, -1).some((w) => englishWordInfo(w)?.verbs.some((v) => v.form !== "base")))
      return null;
    const head = words.at(-1)!;
    if (CONTENT_NOUN.test(head) || CONTENT_NOUN.test(head.replace(/s$/, ""))) return null;
    const det = m.groups!.det.toLowerCase();
    const headRead = englishWordInfo(head);
    // "painting", "guys": the lexicon's noun reading where the noun pairs have none.
    const number =
      head === "one"
        ? { singular: "one", number: "singular" as const }
        : (nounNumber(head) ??
          (headRead?.noun
            ? {
                singular: head,
                number:
                  headRead.plural && /s$/.test(head) ? ("plural" as const) : ("singular" as const),
              }
            : null));
    if (!number || COLLECTIVE.has(number.singular)) return null;
    const plural = number.number === "plural";
    if (
      plural
        ? /^(?:a|an|this|that|every|each)$/.test(det)
        : /^(?:these|those)$/.test(det) || (head !== "one" && headRead?.adjective)
    )
      return null;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 16);
    if (tokens.some((t) => t.kind === "other")) return null;
    const found = mainVerbIndex(tokens);
    if (!found) return null;
    const verb = tokens[found.index];
    if (verb?.kind !== "word" || verb.text !== verb.lower || ctx.dictionary.has(verb.lower))
      return null;
    // "were" after a singular head may be a subjunctive.
    if (!plural && verb.lower === "were") return null;
    const fix = fixFor(verb, tokens[found.index + 1], plural, found.free);
    if (!fix || fix === verb.lower) return null;
    return {
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start: verb.start, end: verb.end },
      alternatives: [caseLike(verb.text, fix)],
      context: evidence(ctx, m.index, verb.end),
    };
  },
  /**
   * "My mother, for example, are a doctor", "The dog, whose owner likes you, eat", "Marketing,
   * for instance, mean trouble": the verb after a comma-closed aside agrees with the subject
   * before it.
   */
  clauseAgreementAsideSubject: (m, ctx) => {
    if (!afterBreak(ctx, m.index) && !CLAUSE_CUE.test(wordBefore(ctx, m.index))) return null;
    const det = m.groups!.det?.toLowerCase();
    const tokens = tokensAfter(ctx, m.index, 24);
    let j = det ? 1 : 0;
    // Modifiers, the head, and an optional "in Asia"/"of war" phrase before the comma.
    let head: Token | undefined;
    while (j < 5 && tokens[j]?.kind === "word") {
      if (/^(?:in|of|from)$/.test(tokens[j].lower) && head) {
        j++;
        if (NP_DET.test(tokens[j]?.lower ?? "")) j++;
        if (tokens[j]?.kind !== "word") break;
        j++;
        break;
      }
      head = tokens[j++];
    }
    if (!head || tokens[j]?.kind !== "comma") return null;
    const word = head.lower;
    let plural: boolean;
    if (det) {
      if (head.text !== word || FUNCTION_WORDS.has(word)) return null;
      const number = nounNumber(word);
      if (!number || COLLECTIVE.has(number.singular) || SAME_PLURAL.test(word)) return null;
      // Modifiers before the head must not be verbs: "The man running, …".
      if (
        tokens
          .slice(1, tokens.indexOf(head))
          .some((t) => t.kind !== "word" || englishWordInfo(t.lower)?.verbs.length)
      )
        return null;
      plural = number.number === "plural";
      if (plural ? /^(?:this|that)$/.test(det) : /^(?:these|those|many|most)$/.test(det))
        return null;
    } else {
      // Without a determiner: a capitalized gerund ("Marketing") or a name before who/whose.
      if (tokens.indexOf(head) !== 0 || head.text === word) return null;
      const aside = tokens[j + 1]?.lower ?? "";
      const gerund = /^[A-Z][a-z]+ing$/.test(head.text) && !!englishWordInfo(word)?.noun;
      const name =
        /^[A-Z][a-z]+$/.test(head.text) && !englishWordInfo(word) && /^(?:who|whose)$/.test(aside);
      if (!gerund && !name) return null;
      plural = false;
    }
    const end = asideEnd(tokens, j + 1);
    if (end < 0) return null;
    const verb = tokens[end];
    if (verb?.kind !== "word" || verb.text !== verb.lower || ctx.dictionary.has(verb.lower))
      return null;
    if (!plural && verb.lower === "were") return null;
    const fix = fixFor(verb, tokens[end + 1], plural, true, true);
    if (!fix || fix === verb.lower) return null;
    return {
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start: verb.start, end: verb.end },
      alternatives: [caseLike(verb.text, fix)],
      context: evidence(ctx, m.index, verb.end),
    };
  },
  /** "Who send the invoices?", "What make the sky blue?": a subject wh-word takes the -s form. */
  clauseAgreementWhSubject: (m, ctx) => {
    if (!afterBreak(ctx, m.index)) return null;
    const wh = m.groups!.wh.toLowerCase();
    const [verb, next] = tokensAfter(ctx, m.index + m[0].length, 2);
    if (verb?.kind !== "word" || verb.text !== verb.lower || ctx.dictionary.has(verb.lower))
      return null;
    if (
      (FUNCTION_WORDS.has(verb.lower) && verb.lower !== "own") ||
      AUX.test(verb.lower) ||
      MODAL.test(verb.lower)
    )
      return null;
    // A determiner or object pronoun next: the word between is the verb.
    if (
      next?.kind !== "word" ||
      !/^(?:the|a|an|my|your|our|their|his|its|this|these|those|me|him|us|them)$/.test(next.lower)
    )
      return null;
    const r = englishWordInfo(verb.lower);
    if (!r?.verbs.some((v) => v.form === "base" && v.lemma === verb.lower) || r.adjective)
      return null;
    if (englishVerbForms(verb.lower)?.past === verb.lower) return null;
    if (wh === "what" && r.noun && WHAT_NOUNS.test(verb.lower)) return null;
    const fix = englishInflect(verb.lower, "third");
    if (fix && fix !== verb.lower) return agreementFinding(ctx, verb, fix, m.index);
  },
  /**
   * "A study like this one rely on…", "Cars like these only takes…": "like this" or "such as
   * that one" between a subject and its verb.
   */
  clauseAgreementLikeThisSubject: (m, ctx) => {
    if (!afterBreak(ctx, m.index) && !CLAUSE_CUE.test(wordBefore(ctx, m.index))) return null;
    const { det, pronoun, one } = m.groups!;
    const head = m.groups!.head?.toLowerCase();
    let plural = false;
    if (head) {
      const number = nounNumber(head);
      if (!number || COLLECTIVE.has(number.singular) || SAME_PLURAL.test(head)) return null;
      plural = number.number === "plural";
      // Without a determiner, only a plural noun opening its clause: "Phones such as these…",
      // not a verb ("Looks like this is live").
      if (
        !det &&
        (!plural ||
          !afterBreak(ctx, m.index) ||
          (!/such/i.test(m[0]) && englishWordInfo(head)?.verbs.some((v) => v.form === "third")))
      )
        return null;
      if (
        det &&
        (plural ? /^(?:a|an|this|that|every|each|any)$/i.test(det) : /^(?:these|those)$/i.test(det))
      )
        return null;
    } else if (!pronoun) return null;
    // "Anything like this exist?": a question that dropped its "does".
    if (/^[^.!?\n]*\?/.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 200)))
      return null;
    const tokens = tokensAfter(ctx, m.index + m[0].length, 3);
    let j = 0;
    while (j < 2 && adverbish(tokens[j])) j++;
    const verb = tokens[j];
    if (verb?.kind !== "word" || verb.text !== verb.lower || ctx.dictionary.has(verb.lower))
      return null;
    // Without "one" or an adverb, "like this" may be a determiner: "like this research shows".
    const r = englishWordInfo(verb.lower);
    if (!one && j === 0 && !AUX.test(normal(verb.lower)) && (r?.noun || r?.adjective || r?.plural))
      return null;
    if (!plural && verb.lower === "were") return null;
    const fix = fixFor(verb, tokens[j + 1], plural, true, true);
    if (fix && fix !== verb.lower) return agreementFinding(ctx, verb, fix, m.index);
  },
  /**
   * "Have she bought a ticket?", "When have he arrived?", "Do he know?": an inverted auxiliary
   * before he/she takes the third-person form.
   */
  clauseAgreementInvertedThirdPerson: (m, ctx) => {
    const before = wordBefore(ctx, m.index);
    if (!afterBreak(ctx, m.index) && !/^(?:when|where|why|how|what|who|which)$/.test(before))
      return null;
    const { aux, subject, next } = m.groups!;
    const fix = THIRD_AUX[normal(aux)];
    if (!fix) return null;
    // The frame is case-blind: only he/she, as typed.
    if (!/^(?:he|she)$/.test(subject)) return null;
    // A question: the sentence ends in "?".
    if (!/^[^.!\n]*\?/.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 160)))
      return null;
    // The verb after the subject fits the auxiliary.
    const read = englishWordInfo(next);
    const a = normal(aux).replace("n't", "");
    const fits =
      a === "have"
        ? next === "been" || !!read?.verbs.some((v) => v.form === "participle")
        : a === "do"
          ? !!read?.verbs.some((v) => v.form === "base" && v.lemma === next)
          : !!read?.adjective ||
            !!read?.verbs.some((v) => v.form === "ing" || v.form === "participle");
    if (!fits) return null;
    const [start, end] = m.indices!.groups!.aux;
    return {
      ruleId: "englishSubjectVerbAgreement",
      messageKey: "review_msg_subject_verb",
      range: { start, end },
      alternatives: [caseLike(aux, fix.replaceAll("'", aux.includes("’") ? "’" : "'"))],
      context: evidence(ctx, m.index, m.index + m[0].length),
    };
  },
} satisfies Record<string, MatchFixer>;
