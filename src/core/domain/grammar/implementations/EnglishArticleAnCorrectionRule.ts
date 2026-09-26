import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { isPartOfTechnicalToken, resolveEnglishBoundaryContext } from "./helpers/EnglishRuleShared";

// Article, then a finished word. The article must start a token: after a space,
// or after an opening quote/bracket that itself starts a token, so the "an" in
// "Qur'an" or "Xi'an" is never an article.
export const ARTICLE_REGEX = /(?:^|(?<=\s)|(?<=(?:^|\s)["'([“‘]))(a|an|A|An)\s+([a-z]+)$/;
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
const PRECEDING_WORD_REGEX = /(^|\s)([A-Za-z']+)\s+$/;

// Whole words only, never spelling prefixes: "unit" takes "a" but "unitemized"
// takes "an", "one" takes "a" but "onerous" takes "an". Anything unlisted is
// left alone, and so is any word with more than one accepted initial sound
// ("a ukulele" and "an ukulele" are both correct).
const TAKES_AN = new Set(
  (
    "hour hourly honest honor honour honorable honourable heir error idea example image item " +
    "article apple application app office officer event element engineer employee egg " +
    "elephant orange umbrella uncle important interesting easy excellent old awful awesome " +
    "amazing early extra entire unusual unknown unexpected ugly obvious independent internal " +
    "external additional average official original ordinary effective efficient elegant " +
    "essential enormous expensive extreme evil opinion opportunity argument adult animal " +
    "actor artist author agent airport island insect invoice iphone ocean understanding " +
    "unfair unhappy unlikely"
  ).split(" "),
);
const TAKES_A = new Set(
  // Vowel letter, consonant sound.
  (
    "university universe universal unit union unique uniform unicorn united user username " +
    "useful useless usual utility utensil unanimous euro eulogy ewe one " +
    // Consonant words that are never read as initialisms.
    "good great big small new year book car day man woman person problem question little bit " +
    "very really simple single short long large nice bad different specific special " +
    "particular company team test file website page table list number name word way time " +
    "thing place group project meeting message friend family child house home job world " +
    "story second minute week month bug feature request response server function method value"
  ).split(" "),
);

export function isArticleContext(beforeArticle: string): boolean {
  if (SENTENCE_START_REGEX.test(beforeArticle)) return true;
  const match = beforeArticle.match(PRECEDING_WORD_REGEX);
  if (!match || match.index === undefined) return false;
  const preceding = match[2].toLowerCase();
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
    if (!match || match.index === undefined) {
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

    const corrected = correctArticle(article, word);
    if (!corrected) {
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

/** The article `word` takes when it differs from `article` ("a" before "hour" -> "an"). */
export function correctArticle(article: string, word: string): string | null {
  const fix = article.length === 2 ? TAKES_A.has(word) && "a" : TAKES_AN.has(word) && "an";
  if (!fix) {
    return null;
  }
  return article[0] === "A" ? `A${fix.slice(1)}` : fix;
}
