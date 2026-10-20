import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  adjectiveOf,
  finiteVerb,
  impersonalVerb,
  listedVerb,
  nounTags,
  pastByShape,
  VERB,
} from "./lexicon";
import { findingAt, isPl, owned, userOrNamed } from "./shared";

/*
 * A sentence that is only an adverbial participle phrase: "Przechodząc obok sklepu.",
 * "Sąsiad, który mieszkał obok, będąc chorym." No verb stands outside its subordinate
 * clauses. Opt-in (englishSentenceFragment): notes and headings can be fragments on purpose.
 */

const RULE = "englishSentenceFragment" as const;

/** A sentence on one line that starts with a capital and ends with a full stop. */
const SENTENCE =
  /(?<=^|[.!?…][ \t \n]{1,8})\p{Lu}[^.!?…\n]{0,400}\.(?=[ \t \n]{1,8}[\p{Lu}„"—–-]|[ \t \n]*$)/gu;
/** Commas, dashes and brackets end a part of the sentence. */
const PART = /[^,;:—–()]+/gu;
/** Words that open a subordinate clause: its verb is not the sentence's verb. */
const SUBORDINATE =
  /^(?:któr\p{L}*|gdzie|dokąd|skąd|kiedy|gdy|że|iż|aby|żeby|by|bo|ponieważ|gdyż|jeśli|jeżeli|gdyby|choć|chociaż|co|czego|czym|kto|kogo|jak|jaki\p{L}*|jakby|zanim|dopóki|odkąd|skoro)$/iu;
/** Set phrases that comment on the sentence: "krótko mówiąc", "nie licząc", "rzecz biorąc". */
const COMMENT =
  /^(?:mówiąc|biorąc|licząc|wyłączając|sumując|reasumując|podsumowując|wliczając|uwzględniając|zakładając|abstrahując|pomijając|zaczynając|kończąc)$/iu;
/** Predicates that are no verb form: "to", "trzeba", "można", "widać". */
const PREDICATIVE =
  /^(?:to|jest|są|trzeba|można|warto|wolno|widać|słychać|szkoda|należy|brak|niech|oto|czas)$/iu;

function participle(word: string): boolean {
  return /^\p{L}{2,}ąc$/u.test(word) && !nounTags(word) && !adjectiveOf(word);
}

/** The word can be a verb form. Unknown words in "-i", "-y" are read as verbs ("śpi"). */
function verbLike(word: string): boolean {
  if (PREDICATIVE.test(word) || /[ćc]$/u.test(word)) return true;
  if (finiteVerb(word) || listedVerb(word) || pastByShape(word) || impersonalVerb(word))
    return true;
  const tags = nounTags(word);
  if (tags & VERB) return true;
  return !tags && !adjectiveOf(word) && /[iy]$/u.test(word) && word.length > 2;
}

function fragments(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const sentence of owned(ctx, SENTENCE)) {
    // Quick gate: most sentences have no "-ąc" word.
    if (!sentence[0].includes("ąc")) continue;
    let target: { start: number; end: number } | undefined;
    let verb = false;
    for (const part of sentence[0].matchAll(PART)) {
      const words = [...part[0].matchAll(/\p{L}+/gu)];
      if (words.length === 0 || SUBORDINATE.test(words[0][0])) continue;
      for (const word of words) {
        const lower = word[0].toLowerCase();
        if (participle(lower)) {
          if (!target && !COMMENT.test(lower) && !userOrNamed(ctx, word[0])) {
            const start = sentence.index + part.index + word.index;
            target = { start, end: start + word[0].length };
          }
        } else if (verbLike(lower)) verb = true;
      }
    }
    if (!target || verb) continue;
    findings.push({
      ...findingAt(ctx, target.start, target.end, [], RULE, "review_msg_sentence_fragment"),
      context: { start: sentence.index, end: sentence.index + sentence[0].length },
    });
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [RULE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) => (isPl(ctx) ? fragments(ctx) : []),
  },
];
