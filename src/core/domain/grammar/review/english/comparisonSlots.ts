import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { caseLike, english, evidence, FUNCTION_WORDS, nounOnly, tokensAfter } from "./slotWords";

// Comparison forms: a superlative before its noun takes "the" ("is hottest city", "an oldest
// city"), "less"/"least" take the plain adjective ("less harder"), and a comparative's "then"
// before a count or adjective is "than" ("more then one").

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

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

/** "Kyoto is an oldest city", "Sue is best choice": a superlative before its noun takes "the". */
function superlativeArticle(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:(?<article>an?)|(?<be>is|are|was|were|['’]s|['’]re))${SPACE}(?<adjective>best|worst|[a-z]+est)${SPACE}(?<noun>[a-z]+)${WORD_END}`,
    "adjective",
  )) {
    const { article, adjective, noun } = m.groups!;
    if (!superlative(adjective) || SET_PHRASES.test(noun) || ctx.dictionary.has(noun)) continue;
    if (hasUserOrCasedWord(ctx, `${adjective} ${noun}`)) continue;
    // The noun closes the phrase: "is best known", "is best left" keep best as an adverb.
    const read = englishWordInfo(noun);
    // "best choice": a noun that is also an adjective must close the phrase.
    const closes = /^[ \t\u00a0]*(?:[.!?,;:]|$)/.test(
      ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 4),
    );
    const isNoun = read
      ? read.noun && !read.adverb && (!read.adjective || closes)
      : !!nounOnly(noun);
    if (!isNoun || read?.verbs.some((v) => v.form === "participle" || v.form === "past")) continue;
    // "a best in class service", "are nearest neighbor methods": a classifier compound.
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (FUNCTION_WORDS.has(noun)) continue;
    if (next?.kind === "word" && !FUNCTION_WORDS.has(next.lower)) {
      const after = englishWordInfo(next.lower);
      if (!after || after.noun || after.plural || nounOnly(next.lower)) continue;
    }
    if (article) {
      const [start, end] = m.indices!.groups!.article;
      findings.push(found(ctx, start, end, caseLike(article, "the"), m.index));
    } else {
      const [start] = m.indices!.groups!.adjective;
      findings.push(found(ctx, start, start, "the ", m.index, adjective));
    }
  }
  return findings;
}

function found(
  ctx: DetectContext,
  start: number,
  end: number,
  replacement: string,
  from: number,
  before = "",
): RawFinding {
  // An insertion is shown on the word it precedes: "best" -> "the best".
  const range = before ? { start, end: start + before.length } : { start, end };
  return {
    ruleId: "englishSentenceStructure",
    messageKey: "review_msg_superlative_article",
    range,
    alternatives: [before ? `${replacement}${before}` : replacement],
    context: evidence(ctx, from, range.end),
  };
}

/** "This is less harder", "the least hardest task": less/least take the plain adjective. */
function lessComparative(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<!\\bat${SPACE})(?<degree>less|least)${SPACE}(?<adjective>[a-z]+(?:er|est))${WORD_END}`,
    "adjective",
  )) {
    const { degree, adjective } = m.groups!;
    const plain =
      plainAdjective(adjective, "er") ??
      (degree.toLowerCase() === "least" ? plainAdjective(adjective, "est") : null);
    if (!plain || hasUserOrCasedWord(ctx, adjective)) continue;
    const [start, end] = m.indices!.groups!.adjective;
    findings.push({
      ruleId: "englishDoubledDegree",
      messageKey: "review_msg_doubled_degree",
      range: { start, end },
      alternatives: [plain],
      context: evidence(ctx, m.index, end),
    });
  }
  return findings;
}

/** "return more then one tag", "less then ten", "more then happy": then after a comparison. */
function comparisonThen(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:more|less|fewer|rather)${SPACE}(?<target>then)${SPACE}(?:\\d|(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|hundred|half|once|twice|enough|happy|willing|glad|ever|usual|expected|necessary)${WORD_END})`,
  )) {
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "englishThenThan",
      messageKey: "review_msg_then_than",
      range: { start, end },
      alternatives: [caseLike(m.groups!.target, "than")],
      context: evidence(ctx, m.index, end),
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishSentenceStructure"], detect: english(superlativeArticle) },
  { rules: ["englishDoubledDegree"], detect: english(lessComparative) },
  { rules: ["englishThenThan"], detect: english(comparisonThen) },
];
