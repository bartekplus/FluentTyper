import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
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

// A word of the wrong class in a verb or determiner slot: a noun after a modal ("I would
// opportunity for me") and "it" before a noun it owns ("ten times it size").

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
    if (!start && !/^(?:and|or|times)$/.test(before)) continue;
    const noun = m.groups!.noun;
    if (ctx.dictionary.has(noun) || ADVERBIAL_NOUNS.test(noun) || !nounOnly(noun)) continue;
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

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishAuxiliaryBaseVerb"], detect: english(modalNoun) },
  { rules: ["englishItsContext"], detect: english(itBeforeNoun) },
];
