import type { MatchFixer, MatchResult } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import {
  adjectiveOf,
  finiteVerb,
  impersonalVerb,
  listedVerb,
  nounTags,
  pastByShape,
  VERB,
} from "./lexicon";
import { findingAt, userOrNamed } from "./shared";

/*
 * A sentence that is only an adverbial participle phrase: "Przechodząc obok sklepu.",
 * "Sąsiad, który mieszkał obok, będąc chorym." No verb stands outside its subordinate
 * clauses. Opt-in (englishSentenceFragment): notes and headings can be fragments on purpose.
 */

const RULE = "englishSentenceFragment" as const;

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

function fragments(sentence: RegExpExecArray, ctx: DetectContext): MatchResult {
  // Quick gate: most sentences have no "-ąc" word.
  if (!sentence[0].includes("ąc")) return null;
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
  if (!target || verb) return null;
  return {
    ...findingAt(ctx, target.start, target.end, [], RULE, "review_msg_sentence_fragment"),
    context: { start: sentence.index, end: sentence.index + sentence[0].length },
  };
}

/** The named frame fixes of the fragment rule of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = { fragments } satisfies Record<string, MatchFixer>;
