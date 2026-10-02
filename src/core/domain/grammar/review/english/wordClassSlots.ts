import { englishInflect } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { PhraseRow } from "../englishPhraseTables";
import { nounNumber } from "./nounNumberSlots";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  afterBreak,
  english,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";

// A word of the wrong class or form in a verb slot: a noun after a modal ("I would opportunity
// for me"), "it" before a noun it owns ("and it suburbs"), a question without do-support
// ("When go you home?") and a simple tense with "since" ("I work here since 2002").

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

// Nouns that stand alone as adverbs or address: "as soon as we can tomorrow", "I will, sir".
const ADVERBIAL_NOUNS =
  /^(?:today|tomorrow|tonight|yesterday|everyday|anytime|sometime|someday|meantime|sir|madam|maam|guys|folks|everyone|everybody|someone|somebody|anyone|anybody|something|anything|everything|nothing|nobody|home|tho|lol|btw|pls|plz|thanks|mom|mum|dad|mother|father|honey|dear|darling|babe|baby|bro|dude|man|buddy|mate|son|kid|nowhere|anywhere|everywhere|somewhere|auto)$/;

/** A closed word after the noun: the clause ends or a new phrase opens. */
function closesAfter(t: Token | undefined): boolean {
  if (!t || t.kind === "end") return true;
  if (t.kind !== "word") return false;
  return (
    t.text !== t.lower ||
    /^(?:the|a|an|my|your|his|her|our|their|its|this|that|these|those|to|for|as|with|at|by|from|me|him|us|them|it)$/.test(
      t.lower,
    )
  );
}

/** "I would opportunity for me", "This will user OpenAI": a noun where the modal needs a verb. */
function modalNoun(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<subject>I|you|we|they|he|she|it|this|that|which|who)(?:${SPACE}(?:usually|really|also|just|probably|definitely|certainly|still|then|now|only))?${SPACE}(?:can|could|will|would|should|must|might|shall)(?:${SPACE}(?:usually|really|also|just|probably|definitely|certainly|still|then|now|only|quickly|easily))?${SPACE}(?<target>[a-z]+)${WORD_END}`,
  )) {
    const subject = m.groups!.subject;
    if (subject !== subject.toLowerCase() && subject !== "I" && !afterBreak(ctx, m.index)) continue;
    const word = m.groups!.target;
    if (FUNCTION_WORDS.has(word) || ADVERBIAL_NOUNS.test(word) || ctx.dictionary.has(word))
      continue;
    // A noun and nothing else: no verb, adjective or adverb reading.
    if (nounOnly(word) !== "singular") continue;
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (!closesAfter(next)) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "englishAuxiliaryBaseVerb",
      messageKey: "review_msg_auxiliary_base",
      range: { start, end },
      alternatives: [],
      warningOnly: true,
      context: evidence(ctx, m.index, end),
    });
  }
  return findings;
}

/**
 * "It origins date back", "Adelaide and it suburbs", "ten times it size": "it" before a noun
 * that cannot be its object's complement is the possessive.
 */
function itBeforeNoun(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, `(?<target>it)${SPACE}(?<noun>[a-z]+)${WORD_END}`)) {
    const it = m.groups!.target;
    const start = afterBreak(ctx, m.index);
    const before = wordBefore(ctx, m.index);
    // "IT infrastructure" names a field.
    if (it !== "it" && (it !== "It" || !start)) continue;
    // "Much of it efforts": after a quantity, "of it" before a noun is "of its".
    const quantity =
      before === "of" &&
      /\b(?:much|most|all|some|none|part|each|any|many|both)[ \t\u00a0]+of[ \t\u00a0]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 16), m.index),
      );
    if (!start && !quantity && !/^(?:and|or|times)$/.test(before)) continue;
    const noun = m.groups!.noun;
    if (ctx.dictionary.has(noun) || ADVERBIAL_NOUNS.test(noun) || !nounOnly(noun)) continue;
    // "most of it beta decays": after a quantity only a plural noun is owned.
    if (quantity && !start && before === "of" && nounOnly(noun) !== "plural") continue;
    // The noun phrase must go on into a verb or end: "It origins date back", "and it suburbs."
    const tokens = tokensAfter(ctx, m.index + m[0].length, 2);
    const next = tokens[0];
    const read = next?.kind === "word" ? englishWordInfo(next.lower) : null;
    const goesOn =
      !next ||
      next.kind === "end" ||
      (next.kind === "comma" && !start) ||
      (next.kind === "word" &&
        (/^(?:is|are|was|were|has|have|had|will|would|can|could|should|may|might|must)$/.test(
          next.lower,
        ) ||
          !!read?.verbs.some((v) => v.form === "third" || v.form === "past") ||
          (!!read?.verbs.length &&
            !FUNCTION_WORDS.has(next.lower) &&
            !/^(?:out|off|up|down|over|back|away)$/.test(next.lower) &&
            nounOnly(noun) === "plural")));
    if (!goesOn) continue;
    const [s, e] = m.indices!.groups!.target;
    findings.push({
      ruleId: "englishItsContext",
      messageKey: "review_msg_its_possessive",
      range: { start: s, end: e },
      alternatives: [it === "It" ? "Its" : "its"],
      context: evidence(ctx, m.index, m.index + m[0].length),
    });
  }
  return findings;
}

/** The base form and tense of a finite lexical verb, or null. */
function finite(word: string): { lemma: string; tense: "base" | "third" | "past" } | null {
  const forms = englishVerbForms(word);
  if (forms) {
    if (forms.past === word && forms.past !== forms.lemma)
      return { lemma: forms.lemma, tense: "past" };
    if (forms.third === word) return { lemma: forms.lemma, tense: "third" };
    if (forms.lemma === word) return { lemma: word, tense: "base" };
    return null;
  }
  const read = englishWordInfo(word);
  const verb = read?.verbs.find(
    (v) => v.form === "past" || v.form === "third" || v.form === "base",
  );
  if (!verb) return null;
  if (verb.form === "base" && verb.lemma !== word) return null;
  return { lemma: verb.lemma, tense: verb.form as "base" | "third" | "past" };
}

// "How come you…", "How dare you…", "What say you": fixed inversions.
const FIXED_INVERSION = /^(?:come|dare|say|be|need|ought|used)$/;

/** "When go you home?", "Where went she?": a fronted lexical verb needs do-support. */
function questionWithoutDo(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<wh>when|why|how|where)${SPACE}(?<target>(?<verb>[a-z]+)${SPACE}(?<subject>you|he|she|we|they|I))${WORD_END}`,
  )) {
    if (!afterBreak(ctx, m.index)) continue;
    const { verb, subject } = m.groups!;
    if (FUNCTION_WORDS.has(verb) || FIXED_INVERSION.test(verb) || ctx.dictionary.has(verb))
      continue;
    // A direct question: the sentence ends in "?".
    if (!/^[^.!\n]*\?/.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 160)))
      continue;
    const read = finite(verb);
    if (!read) continue;
    const singular = /^(?:he|she)$/i.test(subject);
    const aux = read.tense === "past" ? "did" : read.tense === "third" || singular ? "does" : "do";
    if (read.tense === "third" && !singular) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "englishAuxiliaryBaseVerb",
      messageKey: "review_msg_question_do",
      range: { start, end },
      alternatives: [`${aux} ${subject} ${read.lemma}`],
      context: evidence(ctx, m.index, end),
    });
  }
  return findings;
}

function participleOf(lemma: string): string | null {
  const forms = englishVerbForms(lemma);
  return forms?.lemma === lemma ? forms.participle : englishInflect(lemma, "past");
}

/** "I work here since 2002", "The boy is here since 10": since + a starting point needs a perfect. */
function sinceWithSimpleTense(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<subject>I|you|we|they|he|she|it|(?:the|my|our|your|his|her|their)${SPACE}[a-z]+)${SPACE}(?<target>[a-z]+)(?:${SPACE}(?:here|there))?${SPACE}since${SPACE}(?<point>[0-9]{1,4}(?![0-9])|last|yesterday|childhood|birth)${WORD_END}`,
  )) {
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:and|but|so|that|because)$/.test(wordBefore(ctx, m.index))
    )
      continue;
    const subject = m.groups!.subject.toLowerCase();
    const word = m.groups!.target;
    if (ctx.dictionary.has(word)) continue;
    // "since 10 people complained": since meaning because.
    const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (
      /^[0-9]/.test(m.groups!.point) &&
      after?.kind === "word" &&
      !/^(?:am|pm|and|or|o)$/.test(after.lower)
    )
      continue;
    let singular = /^(?:he|she|it)$/.test(subject);
    if (/\s/.test(subject)) {
      const number = nounNumber(subject.split(/\s+/).pop()!);
      if (!number) continue;
      singular = number.number === "singular";
    }
    const have = singular ? "has" : "have";
    let perfect: string;
    if (/^(?:am|is|are|was|were)$/.test(word)) {
      if ((word === "am" && subject !== "i") || (word === "is" && !singular)) continue;
      perfect = `${have} been`;
    } else {
      if (FUNCTION_WORDS.has(word)) continue;
      const read = finite(word);
      if (!read || (read.tense === "third" && !singular) || (read.tense === "base" && singular))
        continue;
      const participle = participleOf(read.lemma);
      if (!participle) continue;
      perfect = `${have} ${participle}`;
    }
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "englishTenseConsistency",
      messageKey: "review_msg_since_perfect",
      range: { start, end },
      alternatives: [perfect],
      context: evidence(ctx, m.index, m.index + m[0].length),
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishAuxiliaryBaseVerb"], detect: english(modalNoun, questionWithoutDo) },
  { rules: ["englishTenseConsistency"], detect: english(sinceWithSimpleTense) },
  { rules: ["englishItsContext"], detect: english(itBeforeNoun) },
];
