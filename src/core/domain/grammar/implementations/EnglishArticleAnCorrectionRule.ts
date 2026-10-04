import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { englishInitialSound } from "./helpers/EnglishInitialSound";
import {
  isPartOfTechnicalToken,
  replaceFrom,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { normalizeWordSet } from "./helpers/GenericRuleShared";

// Article, then a finished word. The article must start a token: after a space,
// or after an opening quote/bracket that itself starts a token, so the "an" in
// "Qur'an" or "Xi'an" is never an article.
export const ARTICLE_REGEX = /(?:^|(?<=\s)|(?<=(?:^|\s)["'([“‘]))(a|an|A|An)\s+([A-Za-z]+)$/;
// A capital article is only an article at a sentence start; "grade A apples",
// "Plan A is" use the letter.
export const SENTENCE_START_REGEX = /(?:^|[.!?]\s+|\n\s*)["'([“‘]?$/;
// Knowing a word's sound does not make the "a" before it an article: "keep a
// independent of b", "option a early" and the SQL alias in "from users an group
// by" are identifiers. So the article must also follow a word that is itself
// followed by an article in prose, or open a sentence.
const ARTICLE_CONTEXT_WORDS = new Set(
  (
    "is was are were am be been being isn't wasn't it's that's there's here's what's he's " +
    "she's have has had need needs needed want wants wanted get gets got take takes took buy " +
    "bought wait for with in of to at on about like into after before without within during " +
    "such what quite rather half not just only also and but"
  ).split(" "),
);
// "Is a important here?": a sentence-initial verb inverts a question, so the
// word after it is the subject, which may be a variable.
const QUESTION_OPENERS = new Set(["is", "was", "are", "were", "isn't", "wasn't"]);
const PRECEDING_WORD_REGEX = /(^|\s)([A-Za-z'’]+)\s+$/;

// A lowercase single letter is usually a variable or list item ("vowels are a e
// i"). Lowercase initialisms are read letter by letter ("an sla", "an fyi", "a
// usb"), and only letters whose name sounds unlike their words matter there:
// F H L M N R S X ("ef", "aitch") and U ("you"). Such a word counts as a word
// when it is long and reads like one; these common words do not.
const WORDS_NOT_INITIALISMS = new Set("man new small short friend".split(" "));
// "a information" needs the article dropped, not changed.
const MASS_NOUNS = new Set("information advice equipment evidence".split(" "));

export function isArticleContext(beforeArticle: string): boolean {
  if (SENTENCE_START_REGEX.test(beforeArticle)) return true;
  const match = beforeArticle.match(PRECEDING_WORD_REGEX);
  if (!match || match.index === undefined) return false;
  const preceding = match[2].toLowerCase().replaceAll("’", "'");
  const beforePreceding = beforeArticle.slice(0, match.index + match[1].length);
  if (QUESTION_OPENERS.has(preceding) && SENTENCE_START_REGEX.test(beforePreceding)) {
    return false;
  }
  return ARTICLE_CONTEXT_WORDS.has(preceding);
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
    // Typing fixes lowercase words only: names and initialisms are left to Review.
    if (!match || match.index === undefined || match[2] !== match[2].toLowerCase()) {
      return null;
    }

    const [, article, word] = match;
    const articleStart = match.index;
    const beforeArticle = core.slice(0, articleStart);
    const isTitle = article[0] === "A";
    if (isTitle && !SENTENCE_START_REGEX.test(beforeArticle)) {
      return null;
    }
    if (
      !isArticleContext(beforeArticle) ||
      isPartOfTechnicalToken(core, articleStart, core.length)
    ) {
      return null;
    }

    const corrected = correctArticle(
      article,
      word,
      normalizeWordSet(context.hints?.userDictionary ?? []),
    );
    if (!corrected) {
      return null;
    }

    const between = core.slice(articleStart + article.length, core.length - word.length);
    return replaceFrom(boundaryContext, articleStart, `${corrected}${between}${word}`);
  }
}

/**
 * The article `word` takes when it differs from `article` ("a" before "hour" ->
 * "an"), or null when it matches or the sound is uncertain. Words in `dictionary`
 * (the user's own terms, often names or initialisms) are left alone.
 */
export function correctArticle(
  article: string,
  word: string,
  dictionary?: ReadonlySet<string>,
): string | null {
  const lower = word.toLowerCase();
  if (dictionary?.has(lower) || MASS_NOUNS.has(lower) || (word === lower && mayBeLetters(lower))) {
    return null;
  }
  const sound = englishInitialSound(word);
  const fix = sound === "vowel" ? "an" : sound === "consonant" ? "a" : null;
  if (!fix || fix === article.toLowerCase()) {
    return null;
  }
  return article[0] === "A" ? `A${fix.slice(1)}` : fix;
}

function mayBeLetters(word: string): boolean {
  if (word.length === 1) return true;
  if (WORDS_NOT_INITIALISMS.has(word) || !/^[fhlmnrsxu]/.test(word)) return false;
  // "sla", "html", "usb", "usps"; "house", "ugly", "unit" read as words.
  return (
    word.length < 4 || !(word[0] === "u" ? /[aeiouy]/.test(word.slice(1)) : /^.[aeiouy]/.test(word))
  );
}
