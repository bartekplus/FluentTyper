import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";

// Article, then a finished all-lowercase word: names, acronyms, numbers and
// hyphenated compounds never match, because their pronunciation is a guess.
const ARTICLE_REGEX = /(^|[\s"'([“‘])(a|an|A|An)\s+([a-z]{2,})$/;
// A capital article is only an article at a sentence start; "grade A apples",
// "Plan A is" use the letter.
const SENTENCE_START_REGEX = /(^|[.!?]\s+|\n\s*)$/;

// The rule is pronunciation, not spelling. Only starts whose sound is certain are
// listed; anything else is left alone.
const SILENT_H_STARTS = ["hour", "honest", "honor", "honour", "heir"];
// Vowel letter, consonant sound: "a university", "a euro", "a one-off".
const CONSONANT_SOUND_VOWEL_STARTS = [
  "eu",
  "ewe",
  "univers",
  "unique",
  "unicorn",
  "uniform",
  "union",
  "unit",
  "unison",
  "unilateral",
  "unanim",
  "use",
  "usu",
  "util",
  "uten",
  "uter",
  "utop",
  "urin",
  "uran",
  "ubiq",
  "ukul",
];
const CONSONANT_SOUND_VOWEL_WORDS = new Set(["one", "once", "ouija"]);
// "u" is split: "an umbrella" but "a unit". "uni" itself is both ("a unicorn",
// "an unimportant"), so it appears in neither list.
const VOWEL_SOUND_U_STARTS = ["um", "up", "ug", "ul", "ud", "urg", "urb", "ush", "utter"];
const VOWEL_SOUND_UN = /^un(?!i|an)/;
// Consonant letters whose sound never varies. "h" (hotel, herb, historic) and
// "x" (x-ray, xylophone) are skipped.
const PLAIN_CONSONANT = /^[bcdfgjklmnpqrstvwyz]/;
// A real word start: consonant + vowel, or a common English cluster. Lowercase
// acronyms ("an sql query", "an mri", "an nda") fail this and are left alone.
// ponytail: word-shaped lowercase acronyms ("an sla") still get "a"; a
// dictionary lookup would close that gap.
const WORD_ONSET =
  /^(?:[bcdfgjklmnpqrstvwz][aeiouy]|bl|br|ch|cl|cr|dr|dw|fl|fr|gl|gn|gr|kn|ph|pl|pr|ps|rh|sc|sh|sk|sl|sm|sn|sp|st|sw|th|tr|tw|wh|wr|y[aeiou])/;
// "a" can be the letter or a variable ("option a or b", "if a is null"); the
// words that follow it then are never ones an article could take.
const NOT_AFTER_ARTICLE = new Set([
  "and",
  "or",
  "is",
  "in",
  "of",
  "on",
  "at",
  "as",
  "if",
  "it",
  "its",
  "are",
  "am",
  "an",
  "into",
  "onto",
  "our",
  "off",
  "out",
  "up",
  "us",
  "each",
  "either",
  "else",
  "even",
  "ever",
  "every",
  "also",
  "all",
  "any",
  "about",
  "after",
  "again",
  "against",
  "among",
  "although",
  "always",
  "until",
  "unless",
  "upon",
  "under",
  "equals",
]);

const startsWithAny = (word: string, starts: readonly string[]): boolean =>
  starts.some((start) => word.startsWith(start));

export function takesAn(word: string): boolean {
  if (startsWithAny(word, SILENT_H_STARTS)) return true;
  if (!/^[aeiou]/.test(word)) return false;
  if (CONSONANT_SOUND_VOWEL_WORDS.has(word)) return false;
  if (startsWithAny(word, CONSONANT_SOUND_VOWEL_STARTS)) return false;
  if (word.startsWith("u")) {
    return VOWEL_SOUND_UN.test(word) || startsWithAny(word, VOWEL_SOUND_U_STARTS);
  }
  return true;
}

export function takesA(word: string): boolean {
  if (CONSONANT_SOUND_VOWEL_WORDS.has(word)) return true;
  if (startsWithAny(word, CONSONANT_SOUND_VOWEL_STARTS)) return true;
  return PLAIN_CONSONANT.test(word) && WORD_ONSET.test(word) && /[aeiouy]/.test(word);
}

export class EnglishArticleAnCorrectionRule implements GrammarRule {
  readonly id = "englishArticleAnCorrection" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const boundaryContext = resolveEnglishBoundaryContext(context);
    if (!boundaryContext) {
      return null;
    }

    const { core } = boundaryContext;
    const match = core.match(ARTICLE_REGEX);
    if (!match || match.index === undefined) {
      return null;
    }

    const [, lead, article, word] = match;
    const articleStart = match.index + lead.length;
    const isTitle = article[0] === "A";
    const beforeArticle = core.slice(0, articleStart).replace(/["'([“‘]$/, "");
    if (isTitle && !SENTENCE_START_REGEX.test(beforeArticle)) {
      return null;
    }
    if (isLikelyCodeLikeContext(core, articleStart, core.length)) {
      return null;
    }

    const isAn = article.length === 2;
    let corrected: string;
    if (!isAn && takesAn(word) && !NOT_AFTER_ARTICLE.has(word)) {
      corrected = isTitle ? "An" : "an";
    } else if (isAn && takesA(word)) {
      corrected = isTitle ? "A" : "a";
    } else {
      return null;
    }

    const between = core.slice(articleStart + article.length, core.length - word.length);
    return {
      replacement: `${corrected}${between}${word}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - articleStart,
      deleteForwards: 0,
    };
  }
}
