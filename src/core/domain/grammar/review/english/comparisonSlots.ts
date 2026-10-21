import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { hasUserOrCasedWord } from "../phraseTemplates";
import type { MatchFixer } from "../../engine/reviewRules";
import { caseLike, evidence, FUNCTION_WORDS, nounOnly, tokensAfter } from "./slotWords";
import { finding } from "../finding";

// Comparison forms: a superlative before its noun takes "the" ("is hottest city", "an oldest
// city"), "less"/"least" take the plain adjective ("less harder"), and a comparative's "then"
// before a count or adjective is "than" ("more then one"). The frames are in
// grammar/rules/en.yaml.

/** The plain adjective behind a regular -er or -est form ("hotter", "happiest"), or null. */
function plainAdjective(word: string, suffix: "er" | "est"): string | null {
  // "number" is a noun, not numb + -er.
  const read = englishWordInfo(word);
  if (!word.endsWith(suffix) || !read?.adjective || read.noun) return null;
  const stem = word.slice(0, -suffix.length);
  const candidates = [
    stem, // hard-er
    `${stem}e`, // nic-er
    /i$/.test(stem) ? `${stem.slice(0, -1)}y` : "", // happi-er
    /([b-df-hj-np-tv-z])\1$/.test(stem) ? stem.slice(0, -1) : "", // bigg-er
  ];
  return candidates.find((c) => c.length > 2 && englishWordInfo(c)?.adjective) ?? null;
}

const superlative = (word: string) =>
  word === "best" || word === "worst" || !!plainAdjective(word, "est");

// Superlatives that name a thing or a role without "the": "best friends", "best man", "best
// practice", "worst case", "best value", "highest priority".
const SET_PHRASES =
  /^(?:friends?|man|men|practices?|case|value|priority|quality|effort|seller|sellers|interests?|regards|wishes)$/;

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  /**
   * "Kyoto is an oldest city": a/an before a superlative and its noun is "the". A bare one after
   * be ("is hottest city") is articles.ts's superlativeThe.
   */
  comparisonSuperlativeArticle: (m, ctx) => {
    const { article, adjective, noun } = m.groups!;
    if (!superlative(adjective) || SET_PHRASES.test(noun) || ctx.dictionary.has(noun)) return null;
    if (FUNCTION_WORDS.has(noun) || hasUserOrCasedWord(ctx, m[0])) return null;
    const read = englishWordInfo(noun);
    // "a best choice": a noun that is also an adjective must close the phrase.
    const end = m.index + m[0].length;
    const closes = /^[ \t\u00a0]{0,8}(?:[.!?,;:]|$)/.test(ctx.text.slice(end, end + 10));
    const isNoun = read
      ? read.noun && !read.adverb && (!read.adjective || closes)
      : !!nounOnly(noun);
    if (!isNoun || read?.verbs.some((v) => v.form === "participle" || v.form === "past"))
      return null;
    // "a best in class service", "a latest cell phone": a classifier compound.
    const next = tokensAfter(ctx, end, 1)[0];
    if (next?.kind === "word" && !FUNCTION_WORDS.has(next.lower)) {
      const after = englishWordInfo(next.lower);
      if (!after || after.noun || after.plural || nounOnly(next.lower)) return null;
    }
    const [start, articleEnd] = m.indices!.groups!.article;
    return {
      ruleId: "englishPhraseCorrections",
      messageKey: "review_msg_superlative_the",
      range: { start, end: articleEnd },
      alternatives: [caseLike(article, "the")],
      context: evidence(ctx, m.index, end),
    };
  },
  /** "This is less harder", "the least hardest task": less/least take the plain adjective. */
  comparisonLessComparative: (m, ctx) => {
    const { degree, adjective } = m.groups!;
    const plain =
      plainAdjective(adjective, "er") ??
      (degree.toLowerCase() === "least" ? plainAdjective(adjective, "est") : null);
    if (!plain || hasUserOrCasedWord(ctx, adjective)) return null;
    const [start, end] = m.indices!.groups!.adjective;
    return finding("englishDoubledDegree", "review_msg_doubled_degree", start, end, [plain], {
      context: evidence(ctx, m.index, end),
    });
  },
  /** "return more then one tag", "less then ten", "more then happy": then after a comparison. */
  comparisonComparisonThen: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    return {
      ruleId: "englishThenThan",
      messageKey: "review_msg_then_than",
      range: { start, end },
      alternatives: [caseLike(m.groups!.target, "than")],
      context: evidence(ctx, m.index, end),
    };
  },
} satisfies Record<string, MatchFixer>;
