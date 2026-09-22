import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";

// Article, then a finished word. The article must start a token: after a space,
// or after an opening quote/bracket that itself starts a token, so the "an" in
// "Qur'an" or "Xi'an" is never an article.
const ARTICLE_REGEX = /(?:^|(?<=\s)|(?<=(?:^|\s)["'([“‘]))(a|an|A|An)\s+([a-z]+)$/;
// A capital article is only an article at a sentence start; "grade A apples",
// "Plan A is" use the letter.
const SENTENCE_START_REGEX = /(?:^|[.!?]\s+|\n\s*)["'([“‘]?$/;
// A quote opened right after code punctuation starts a literal: `text = "a error`.
const OPEN_LITERAL_REGEX = /[=(,[{:+]\s*(["'])[^"'\n]*$/;

// Whole words only, never spelling prefixes: "unit" takes "a" but "unitemized"
// takes "an", "one" takes "a" but "onerous" takes "an". Anything unlisted is
// left alone. Words that read naturally after a variable or letter ("let a equal
// b", "option a instead", "if a exists", "a eight") are deliberately absent, so
// only nouns and adjectives that never follow a bare "a" identifier are listed.
const TAKES_AN = new Set([
  "hour",
  "hourly",
  "honest",
  "honor",
  "honour",
  "honorable",
  "honourable",
  "heir",
  "error",
  "idea",
  "example",
  "image",
  "item",
  "article",
  "apple",
  "application",
  "app",
  "office",
  "officer",
  "event",
  "element",
  "engineer",
  "employee",
  "egg",
  "elephant",
  "orange",
  "umbrella",
  "uncle",
  "important",
  "interesting",
  "easy",
  "excellent",
  "old",
  "awful",
  "awesome",
  "amazing",
  "early",
  "extra",
  "entire",
  "unusual",
  "unknown",
  "unexpected",
  "ugly",
  "obvious",
  "independent",
  "internal",
  "external",
  "additional",
  "average",
  "official",
  "original",
  "ordinary",
  "effective",
  "efficient",
  "elegant",
  "essential",
  "enormous",
  "expensive",
  "extreme",
  "evil",
  "opinion",
  "opportunity",
  "argument",
  "adult",
  "animal",
  "actor",
  "artist",
  "author",
  "agent",
  "airport",
  "island",
  "insect",
  "invoice",
  "iphone",
  "ocean",
  "understanding",
  "unfair",
  "unhappy",
  "unlikely",
]);
const TAKES_A = new Set([
  // Vowel letter, consonant sound.
  "university",
  "universe",
  "universal",
  "unit",
  "union",
  "unique",
  "uniform",
  "unicorn",
  "united",
  "user",
  "username",
  "useful",
  "useless",
  "usual",
  "utility",
  "utensil",
  "ukulele",
  "unanimous",
  "euro",
  "eulogy",
  "ewe",
  "one",
  // Consonant words that are never read as initialisms.
  "good",
  "great",
  "big",
  "small",
  "new",
  "year",
  "book",
  "car",
  "day",
  "man",
  "woman",
  "person",
  "problem",
  "question",
  "little",
  "bit",
  "very",
  "really",
  "simple",
  "single",
  "short",
  "long",
  "large",
  "nice",
  "bad",
  "different",
  "specific",
  "special",
  "particular",
  "company",
  "team",
  "test",
  "file",
  "website",
  "page",
  "table",
  "list",
  "number",
  "name",
  "word",
  "way",
  "time",
  "thing",
  "place",
  "group",
  "project",
  "meeting",
  "message",
  "friend",
  "family",
  "child",
  "house",
  "home",
  "job",
  "world",
  "story",
  "second",
  "minute",
  "week",
  "month",
  "bug",
  "feature",
  "request",
  "response",
  "server",
  "function",
  "method",
  "value",
]);

// ponytail: `...`, fences and code-opened quotes are tracked from the text before
// the cursor only; a multi-line string opened in an earlier paragraph is missed.
function isInsideCodeOrLiteral(beforeArticle: string): boolean {
  if ((beforeArticle.match(/`/g)?.length ?? 0) % 2 === 1) return true;
  return OPEN_LITERAL_REGEX.test(beforeArticle);
}

export class EnglishArticleAnCorrectionRule implements GrammarRule {
  readonly id = "englishArticleAnCorrection" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (context.hints?.measurementContext === "protected") {
      return null;
    }
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
      isInsideCodeOrLiteral(beforeArticle) ||
      isLikelyCodeLikeContext(core, articleStart, core.length)
    ) {
      return null;
    }

    const isAn = article.length === 2;
    let corrected: string;
    if (!isAn && TAKES_AN.has(word)) {
      corrected = isTitle ? "An" : "an";
    } else if (isAn && TAKES_A.has(word)) {
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
