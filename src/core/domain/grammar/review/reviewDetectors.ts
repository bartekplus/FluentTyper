import type { CatalogRuleId } from "../ruleCatalog";
import { SPACE_CHARS } from "../../spacingRules";
import { usesFrenchPunctuationSpacing } from "../typographyProfiles";
import { parseMeasurementExpression } from "../measurement/parser";
import { resolveMeasurementLocale } from "../measurement/registry";
import {
  SENTENCE_OPENING_MARKS,
  TRAILING_PUNCTUATION_REGEX,
  startsSentence,
} from "../implementations/CapitalizeSentenceStartRule";
import { NON_PRONOUN_FOLLOWERS } from "../implementations/EnglishPronounICapitalizationRule";
import {
  normalizeContractionInContext,
  normalizeContractionToken,
} from "../implementations/EnglishContractionNormalizationRule";
import { correctWhitelistedTypo } from "../implementations/EnglishTypoWhitelistCorrectionRule";
import {
  MODAL_OF_REGEX,
  OF_IDIOMS,
  modalHaveWord,
} from "../implementations/EnglishModalOfCorrectionRule";
import {
  YOUR_WELCOME_REGEX,
  correctYourWelcome,
} from "../implementations/EnglishYourWelcomeCorrectionRule";
import {
  THEIR_THERE_BE_REGEX,
  correctTheirBeVerb,
} from "../implementations/EnglishTheirThereBeVerbRule";
import { ALOT_REGEX, correctAlot } from "../implementations/EnglishAlotCorrectionRule";
import {
  AGREEMENT_CORRECTIONS,
  AGREEMENT_REGEX,
  correctPronounVerb,
} from "../implementations/EnglishPronounVerbWhitelistAgreementRule";
import {
  ARTICLE_REGEX,
  SENTENCE_START_REGEX,
  correctArticle,
  isArticleContext,
} from "../implementations/EnglishArticleAnCorrectionRule";
import { ordinalSuffix } from "../implementations/EnglishOrdinalSuffixRule";
import {
  couldEndProperName,
  findProperName,
  isMonthInContext,
  recase,
} from "../implementations/EnglishProperNounCapitalizationRule";
import { CURRENCY_MARKERS } from "../implementations/CurrencySpacingRule";
import { isProsePrefix } from "../implementations/MeasurementUnitFormattingRule";
import {
  PROTECTED_SPAN_OPENERS,
  isInsideProtectedSpan,
} from "../implementations/helpers/ProtectedSpanShared";
import { isLowercaseLetter, isTechnicalToken } from "../implementations/helpers/GenericRuleShared";
import { commonAffixes, isGraphemeBoundary } from "./textRanges";
import type { ReviewEdit, ReviewMessageKey, TextRange } from "./types";

/**
 * Review detectors read ONE immutable snapshot and never mutate it.
 *
 * `text` is the analysis text: the source with protected characters (code,
 * technical tokens, non-editable islands) replaced one-for-one by U+FFFC, so
 * offsets match the source and no match can join prose across a protected span.
 * `source` is the real text; every edit's `original` comes from it.
 *
 * Each detector reuses the typing rule's own patterns, word lists and casing
 * helpers, evaluated at positions in the finished text. No typing events are
 * simulated and no delimiter is appended at the end of the input.
 */
export interface DetectContext {
  source: string;
  text: string;
  /**
   * `text` cut shortly after `to` (and masked at the cut), for forward regex
   * scans: a chunk without matches must not scan the rest of the document.
   * Same offsets as `text`; read context from `text`.
   */
  scanText: string;
  /** Findings are owned by the chunk their range starts in: [from, to). */
  from: number;
  to: number;
  lang: string;
  dictionary: ReadonlySet<string>;
  insertSpaceAfterAutocomplete: boolean;
}

export interface RawFinding {
  ruleId: CatalogRuleId;
  messageKey: ReviewMessageKey;
  range: TextRange;
  /** Replacement for `range`, per alternative. */
  alternatives: string[];
  /** Evidence the decision depended on; defaults to `range`. */
  context?: TextRange;
  /** A finding the rule's metadata would batch but this instance must not. */
  bulkBlock?: "context-dependent" | "ambiguous";
  dictionaryWord?: string;
}

export type Detector = (ctx: DetectContext) => RawFinding[];

export const MASK_CHAR = "\uFFFC";
// Enough context for every phrase pattern; the patterns themselves are shorter.
const PHRASE_WINDOW = 96;
const WORD_CHAR = /[\p{L}\p{N}_'’]/u;
// Characters that glue a word into a mention, path, file or dotted name.
const TECHNICAL_GLUE = /[@#/\\_=$]/;

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && SPACE_CHARS.includes(ch);
}

/** True when [start, end) is glued to a technical token in `text` ("@i", "src/dont", "teh.com"). */
function isGluedToTechnical(text: string, start: number, end: number): boolean {
  const before = text[start - 1] ?? "";
  const after = text[end] ?? "";
  if (TECHNICAL_GLUE.test(before) || TECHNICAL_GLUE.test(after)) return true;
  if (before === MASK_CHAR || after === MASK_CHAR) return true;
  // A period is a sentence end unless a word character continues the token.
  if (before === "." && WORD_CHAR.test(text[start - 2] ?? "")) return true;
  return after === "." && WORD_CHAR.test(text[end + 1] ?? "");
}

/** Word starts and ends of ASCII-letter words ([A-Za-z]+) owned by the chunk. */
function* asciiWords(ctx: DetectContext, lookback = 0): Generator<TextRange> {
  const regex = /[A-Za-z]+/g;
  regex.lastIndex = Math.max(0, ctx.from - lookback);
  for (let match = regex.exec(ctx.scanText); match; match = regex.exec(ctx.scanText)) {
    if (match.index >= ctx.to + lookback) return;
    const start = match.index;
    const end = start + match[0].length;
    // Letters glued to other word characters are part of a longer token ("teh2").
    if (WORD_CHAR.test(ctx.text[start - 1] ?? "") || WORD_CHAR.test(ctx.text[end] ?? "")) {
      continue;
    }
    yield { start, end };
  }
}

/**
 * `text.lastIndexOf(needle, position)` for non-decreasing positions, reading
 * each character once: per-match line or paragraph lookups on a long line
 * would otherwise rescan it for every match.
 */
function lastIndexFinder(text: string, needle: string): (position: number) => number {
  let searched = 0;
  let last = -1;
  return (position) => {
    if (position < searched) return text.lastIndexOf(needle, position);
    const found = text.slice(searched, position + needle.length).lastIndexOf(needle);
    if (found >= 0) last = searched + found;
    searched = position + 1;
    return last;
  };
}

/** Matches of a global `regex` that start in the chunk, scanned on its bounded view. */
function* ownedMatches(ctx: DetectContext, regex: RegExp): Generator<RegExpExecArray> {
  regex.lastIndex = ctx.from;
  for (
    let match = regex.exec(ctx.scanText);
    match && match.index < ctx.to;
    match = regex.exec(ctx.scanText)
  ) {
    yield match;
  }
}

function owned(ctx: DetectContext, start: number): boolean {
  return start >= ctx.from && start < ctx.to;
}

function graphemeEnd(text: string, index: number): number {
  let end = index + 1;
  while (end < text.length && !isGraphemeBoundary(text, end)) end += 1;
  return end;
}

// Words after which a lowercase "i" names something ("the variable i"): an identifier.
const IDENTIFIER_WORDS = "each|every|the|a|index|variable|counter|iterator|loop";
const IDENTIFIER_BEFORE = new RegExp(`\\b(?:${IDENTIFIER_WORDS})\\s+$`, "i");
// Words naming a numbered part: "Part i.", "Appendix i." is the roman numeral.
const NUMERAL_BEFORE =
  /\b(?:part|chapter|section|appendix|volume|vol|book|act|phase|step|stage|level|type|class|article|annex|item|figure|fig|table|option|case|grade|war|page|no)\s+$/i;
// "i is"/"i has" is a variable after a condition too ("while i has items");
// "if i go" is still the pronoun, so conditions only guard those verbs.
const VARIABLE_CONTEXT_BEFORE = new RegExp(
  `\\b(?:if|while|until|unless|whether|when|where|${IDENTIFIER_WORDS})\\s+$`,
  "i",
);

// Words after which "im"/"ive" is a noun or tag, not "I'm"/"I've".
const DETERMINER_BEFORE =
  /\b(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their|each|every|no)\s+$/i;

/**
 * Start of the `count` whitespace-separated tokens before `index` (at most 64
 * characters back): the evidence a sentence-start decision reads.
 */
function previousTokensStart(text: string, index: number, count: number): number {
  const limit = Math.max(0, index - 64);
  let position = index;
  for (let token = 0; token < count && position > limit; token += 1) {
    while (position > limit && /\s/.test(text[position - 1])) position -= 1;
    while (position > limit && !/\s/.test(text[position - 1])) position -= 1;
  }
  return position;
}

/** True when `index` opens a clause: text start, a line start, or after . ! ? , ; : or an opening mark. */
function opensClause(text: string, index: number): boolean {
  const i = lastNonBlankBefore(text, index);
  return i < 0 || /[\n.!?,;:([{"“‘«—–-]/.test(text[i]);
}

/** Where the clause-opening evidence for a phrase at `index` starts. */
function clauseEvidenceStart(text: string, index: number): number {
  return Math.max(0, lastNonBlankBefore(text, index));
}

/** Index of the last character before `index` that is not a space, tab or no-break space (-1: none). */
function lastNonBlankBefore(text: string, index: number): number {
  let i = index - 1;
  while (i >= 0 && (text[i] === " " || text[i] === "\t" || text[i] === "\u00A0")) i -= 1;
  return i;
}

// ---------------------------------------------------------------- capitalization

const capitalizeStarts: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  const regex = /[^\s\uFFFC]+/gu;
  for (const match of ownedMatches(ctx, regex)) {
    const wordStart = match.index;
    // A token must start after whitespace or at the text start.
    if (wordStart > 0 && !/\s/.test(ctx.text[wordStart - 1])) continue;
    const word = match[0];
    const letterIndex = wordStart + (SENTENCE_OPENING_MARKS.has(word[0]) ? 1 : 0);
    if (!isLowercaseLetter(ctx.text[letterIndex] ?? "")) continue;
    const letterEnd = graphemeEnd(ctx.text, letterIndex);
    const letter = ctx.source.slice(letterIndex, letterEnd);
    const bare = word.replace(TRAILING_PUNCTUATION_REGEX, "");
    // "iPhone", "eBay", "macOS": a capital later in the word means deliberate casing.
    if (isTechnicalToken(bare) || /\p{Lu}/u.test(bare.slice(1)) || /\p{N}/u.test(bare)) continue;
    const upper = letter.toUpperCase();
    if (upper === letter) continue;
    const range = { start: letterIndex, end: letterEnd };
    const wordEnd = wordStart + bare.length;

    if (startsSentence(ctx.text, wordStart, ctx.lang)) {
      // The mark AND the word it closes decide it: "etc." or, when the mark
      // stands alone, the word before it ("approx .", "etc .").
      const previous = previousTokensStart(ctx.text, wordStart, 1);
      const evidence = /[\p{L}\p{N}]/u.test(ctx.text.slice(previous, wordStart))
        ? previous
        : previousTokensStart(ctx.text, wordStart, 2);
      findings.push({
        ruleId: "capitalizeSentenceStart",
        messageKey: "review_msg_sentence_start",
        range,
        alternatives: [upper],
        context: { start: evidence, end: wordEnd },
      });
      continue;
    }
    const lineBreak = lineBreakBefore(ctx.text, wordStart);
    if (lineBreak !== null && previousLineEndsParagraphOrSentence(ctx.text, lineBreak)) {
      findings.push({
        ruleId: "capitalizeAfterLineBreak",
        messageKey: "review_msg_line_start",
        range,
        alternatives: [upper],
        context: { start: lineBreak, end: wordEnd },
      });
    }
  }
  return findings;
};

/** Index of the newline that starts the line `wordStart` is the first word of, or null. */
function lineBreakBefore(text: string, wordStart: number): number | null {
  let i = wordStart - 1;
  while (i >= 0 && isSpace(text[i])) i -= 1;
  return i >= 0 && text[i] === "\n" ? i : null;
}

/**
 * Line starts are only flagged where the previous line closes a sentence or
 * a paragraph: continuation lines of hard-wrapped text stay lowercase.
 */
function previousLineEndsParagraphOrSentence(text: string, lineBreak: number): boolean {
  const previousStart = text.lastIndexOf("\n", lineBreak - 1) + 1;
  const previous = text.slice(previousStart, lineBreak).trim();
  if (previous === "") return true;
  return /[.!?]["'”’)\]]*$/u.test(previous) && !previous.endsWith(MASK_CHAR);
}

const pronounI: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  const regex = /(?<![\p{L}\p{N}_'’])i(?![\p{L}\p{N}_])/gu;
  for (const match of ownedMatches(ctx, regex)) {
    const start = match.index;
    const before = ctx.text[start - 1] ?? "";
    if (/[@#/\\.=$\-([]/.test(before) || before === MASK_CHAR) continue;
    if (IDENTIFIER_BEFORE.test(ctx.text.slice(Math.max(0, start - 24), start))) continue;
    const rest = ctx.text.slice(start + 1, start + 1 + 40);
    let contextEnd = start + 1;
    let sentenceEnd = false;
    if (/^['’](?:m|ve|ll|d)(?![\p{L}\p{N}])/u.test(rest)) {
      contextEnd += rest.match(/^['’]\w+/)![0].length;
    } else if (/^[,;!?]/.test(rest)) {
      contextEnd += 1;
    } else if (/^\.(?:\s|$)/u.test(rest)) {
      // Unlike typing, what follows the period is here: not "i.e.", so "than i." ends
      // a sentence. A roman numeral opening a list line or naming a part is not.
      const lineStart = ctx.text.lastIndexOf("\n", start - 1) + 1;
      if (ctx.text.slice(lineStart, start).trim() === "") continue;
      if (NUMERAL_BEFORE.test(ctx.text.slice(Math.max(0, start - 24), start))) continue;
      contextEnd += 1;
      sentenceEnd = true;
    } else {
      // Whitespace alone does not say pronoun or variable; the next word does.
      const next = rest.match(/^[ \t\u00A0]+(\S+)/);
      if (!next) continue;
      const following = next[1].replace(TRAILING_PUNCTUATION_REGEX, "");
      // Unlike typing, the next word is complete here: "i don't" is the pronoun too.
      if (
        !/^\p{L}+(?:['’]\p{L}+)?$/u.test(following) ||
        NON_PRONOUN_FOLLOWERS.has(following.toLowerCase())
      ) {
        continue;
      }
      contextEnd += next[0].length;
    }
    findings.push({
      ruleId: "englishPronounICapitalization",
      messageKey: "review_msg_pronoun_i",
      range: { start, end: start + 1 },
      alternatives: ["I"],
      // The word before decided it as well as the one after.
      context: { start: previousTokensStart(ctx.text, start, 1), end: contextEnd },
      // "increment i." can still be a variable: one at a time.
      bulkBlock: sentenceEnd ? "context-dependent" : undefined,
    });
  }
  return findings;
};

// -------------------------------------------------------------------- spelling

const wordSpelling: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  for (const { start, end } of asciiWords(ctx)) {
    if (isGluedToTechnical(ctx.text, start, end)) continue;
    const word = ctx.text.slice(start, end);
    const range = { start, end };
    const typo = correctWhitelistedTypo(word, ctx.dictionary);
    if (typo) {
      findings.push({
        ruleId: "englishTypoWhitelistCorrection",
        messageKey: "review_msg_typo",
        range,
        alternatives: [typo],
        dictionaryWord: word,
      });
      continue;
    }
    const before = ctx.text.slice(Math.max(0, start - PHRASE_WINDOW), start);
    const contraction = ctx.dictionary.has(word.toLowerCase())
      ? null
      : normalizeContractionToken(word, before);
    // "the im tag", "an ive file": after a determiner it is a word, not "I'm".
    const pronounForm = /^i(?:m|ve)$/i.test(word);
    if (contraction && !(pronounForm && DETERMINER_BEFORE.test(before))) {
      findings.push({
        ruleId: "englishContractionNormalization",
        messageKey: "review_msg_contraction",
        range,
        alternatives: [contraction],
        // The name guard reads the previous word on the line.
        context: { start: Math.max(0, ctx.text.lastIndexOf(" ", start - 2) + 1), end },
        // "im"/"ive" can still be a tag, an abbreviation or a name: one at a time.
        bulkBlock: pronounForm ? "ambiguous" : undefined,
      });
      continue;
    }
    // Unlike typing, the next word is here: "i cant go" is "can't", "the cant" is not.
    const after = ctx.text.slice(end, end + 40);
    const inContext = ctx.dictionary.has(word.toLowerCase())
      ? null
      : normalizeContractionInContext(word, before, after);
    if (inContext) {
      const verbEnd = end + (/^[ \t]+\p{L}+(?:[ \t]+\p{L}+)?/u.exec(after)?.[0].length ?? 0);
      findings.push({
        ruleId: "englishContractionNormalization",
        messageKey: "review_msg_contraction",
        range,
        alternatives: [inContext],
        context: { start: previousTokensStart(ctx.text, start, 1), end: verbEnd },
        bulkBlock: "context-dependent",
      });
      continue;
    }
    if (ALOT_REGEX.test(word) && !ctx.dictionary.has("alot")) {
      findings.push({
        ruleId: "englishAlotCorrection",
        messageKey: "review_msg_alot",
        range,
        alternatives: [correctAlot(word)],
        dictionaryWord: word,
      });
    }
  }
  return findings;
};

// --------------------------------------------------------------------- grammar

interface PhraseMatch {
  match: RegExpExecArray;
  start: number;
  end: number;
}

function isWhitespaceAt(text: string, index: number): boolean {
  return /\s/.test(text[index] ?? "");
}

/**
 * Runs a typing rule's end-anchored pattern at every word end of the chunk.
 * The window holds the last `tokens` whitespace-separated tokens up to the
 * word: all the pattern can span, and it starts on a token boundary so "^" in
 * a pattern never lands mid-text.
 */
function* phraseMatches(
  ctx: DetectContext,
  pattern: RegExp,
  tokens: number,
): Generator<PhraseMatch> {
  const regex = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}d`);
  for (const word of asciiWords(ctx, PHRASE_WINDOW)) {
    const limit = Math.max(0, word.end - PHRASE_WINDOW);
    let windowStart = word.start;
    while (windowStart > limit && !isWhitespaceAt(ctx.text, windowStart - 1)) windowStart -= 1;
    if (windowStart > 0 && !isWhitespaceAt(ctx.text, windowStart - 1)) continue;
    for (let count = 1; count < tokens; count += 1) {
      let i = windowStart;
      while (i > limit && isWhitespaceAt(ctx.text, i - 1)) i -= 1;
      while (i > limit && !isWhitespaceAt(ctx.text, i - 1)) i -= 1;
      if (i > 0 && !isWhitespaceAt(ctx.text, i - 1)) break;
      windowStart = i;
    }
    const match = regex.exec(ctx.text.slice(windowStart, word.end));
    if (!match) continue;
    const start = windowStart + match.index;
    if (!owned(ctx, start) || isGluedToTechnical(ctx.text, start, word.end)) continue;
    // Absolute group indices.
    match.indices = match.indices?.map((pair) =>
      pair ? [pair[0] + windowStart, pair[1] + windowStart] : pair,
    ) as RegExpIndicesArray;
    yield { match, start, end: word.end };
  }
}

function groupRange(match: RegExpExecArray, group: number): TextRange {
  const [start, end] = match.indices![group]!;
  return { start, end };
}

const modalOf: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  for (const { match, start, end } of phraseMatches(ctx, MODAL_OF_REGEX, 3)) {
    if (OF_IDIOMS.has(match[2].toLowerCase())) continue;
    const modal = groupRange(match, 1);
    let ofStart = modal.end;
    while (/\s/.test(ctx.text[ofStart] ?? "")) ofStart += 1;
    const ofRange = { start: ofStart, end: ofStart + 2 };
    if (ctx.text.slice(ofRange.start, ofRange.end).toLowerCase() !== "of") continue;
    findings.push({
      ruleId: "englishModalOfCorrection",
      messageKey: "review_msg_modal_of",
      range: { start, end: ofRange.end },
      alternatives: [`${ctx.source.slice(start, ofRange.start)}${modalHaveWord(match[1])}`],
      context: { start, end },
    });
  }
  return findings;
};

const yourWelcome: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  for (const { match, start, end } of phraseMatches(ctx, YOUR_WELCOME_REGEX, 2)) {
    // "Your welcome email" is possessive: only the sentence-final phrase counts.
    // The end of the whole text ends the sentence too; nothing is appended.
    if (end < ctx.text.length && !/^[.!?\n]/.test(ctx.text[end])) continue;
    // "Thank you all for your welcome." is possessive too: the reply opens its clause.
    if (!opensClause(ctx.text, start)) continue;
    const phrase = match[0];
    const firstToken = phrase.split(/\s+/)[0];
    const [you, welcome] = correctYourWelcome(firstToken);
    const gap = phrase.slice(firstToken.length, phrase.length - "welcome".length);
    findings.push({
      ruleId: "englishYourWelcomeCorrection",
      messageKey: "review_msg_your_welcome",
      range: { start, end },
      alternatives: [`${you}${gap}${welcome}`],
      context: {
        start: clauseEvidenceStart(ctx.text, start),
        end: Math.min(ctx.text.length, end + 1),
      },
    });
  }
  return findings;
};

const theirThere: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  for (const { match, start, end } of phraseMatches(ctx, THEIR_THERE_BE_REGEX, 2)) {
    const phrase = match[0];
    const their = phrase.split(/\s+/)[0];
    const [there, verb] = correctTheirBeVerb(their, match[1]);
    const gap = phrase.slice(their.length, phrase.length - match[1].length);
    findings.push({
      ruleId: "englishTheirThereBeVerb",
      messageKey: "review_msg_their_there",
      range: { start, end },
      alternatives: [`${there}${gap}${verb}`],
    });
  }
  return findings;
};

const pronounVerb: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  for (const { match, end } of phraseMatches(ctx, AGREEMENT_REGEX, 3)) {
    const phrase = match[1];
    const corrected = AGREEMENT_CORRECTIONS.get(phrase.toLowerCase().replace(/\s+/, " "));
    if (!corrected) continue;
    const [pronoun, verb] = correctPronounVerb(phrase, corrected);
    const [inputPronoun, inputVerb] = phrase.split(/\s+/);
    const phraseRange = groupRange(match, 1);
    // A lowercase "i" before "is" is usually a variable ("if i is None"); the
    // pronoun rule leaves it alone for the same reason. "i has" is too after a
    // condition or determiner ("while i has items", "the i has").
    if (inputPronoun === "i") {
      if (NON_PRONOUN_FOLLOWERS.has(inputVerb.toLowerCase())) continue;
      if (
        VARIABLE_CONTEXT_BEFORE.test(
          ctx.text.slice(Math.max(0, phraseRange.start - 24), phraseRange.start),
        )
      ) {
        continue;
      }
    }
    const gap = phrase.slice(inputPronoun.length, phrase.length - inputVerb.length);
    // The pronoun "i" is always capitalized; the case rule would flag it anyway.
    const fixedPronoun = pronoun === "i" ? "I" : pronoun;
    findings.push({
      ruleId: "englishPronounVerbWhitelistAgreement",
      messageKey: "review_msg_pronoun_verb",
      range: phraseRange,
      alternatives: [`${fixedPronoun}${gap}${verb}`],
      // The word before the pronoun decided it.
      context: { start: previousTokensStart(ctx.text, phraseRange.start, 1), end },
    });
  }
  return findings;
};

const articleAn: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  const newlineBefore = lastIndexFinder(ctx.text, "\n");
  for (const { match, start, end } of phraseMatches(ctx, ARTICLE_REGEX, 2)) {
    const [, article, word] = match;
    const lineStart = newlineBefore(start - 1) + 1;
    const sliceStart = Math.max(lineStart, start - 400);
    // A cut-off slice must not look like a line start to the sentence-start test.
    const beforeArticle = `${sliceStart > lineStart ? "x " : ""}${ctx.text.slice(sliceStart, start)}`;
    if (article[0] === "A" && !SENTENCE_START_REGEX.test(beforeArticle)) continue;
    if (!isArticleContext(beforeArticle)) continue;
    const corrected = correctArticle(article, word);
    if (!corrected) continue;
    const articleRange = groupRange(match, 1);
    findings.push({
      ruleId: "englishArticleAnCorrection",
      messageKey: "review_msg_article",
      range: { start: articleRange.start, end },
      alternatives: [`${corrected}${ctx.source.slice(articleRange.end, end)}`],
      context: { start: Math.max(0, start - 24), end },
    });
  }
  return findings;
};

// ------------------------------------------------------------------ typography

// How much of a paragraph the quotation check re-reads for one finding.
const MAX_QUOTE_LOOKBACK = 4_000;

/** Positions in [from, to) of characters that can open a quotation or code span. */
function openerPositions(text: string, from: number, to: number): number[] {
  const positions: number[] = [];
  for (let i = from; i < to; i += 1) {
    if (PROTECTED_SPAN_OPENERS.includes(text[i])) positions.push(i);
  }
  return positions;
}

/** True when sorted `positions` has one in [from, to). */
function hasPositionIn(positions: readonly number[], from: number, to: number): boolean {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (positions[middle] < from) low = middle + 1;
    else high = middle;
  }
  return low < positions.length && positions[low] < to;
}

const ordinal: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  let openers: number[] | null = null;
  const blankLineBefore = lastIndexFinder(ctx.text, "\n\n");
  const regex = /(?<=^|[\s([])(\d+)(nd|th)(?![\p{L}\p{N}])/gu;
  for (const match of ownedMatches(ctx, regex)) {
    const start = match.index;
    const [token, digits, suffix] = match;
    const expected = ordinalSuffix(digits);
    const end = start + token.length;
    if (suffix === expected || isGluedToTechnical(ctx.text, start, end)) continue;
    // Quoted text is often a deliberate example; the typing rule leaves it too.
    const paragraphStart = Math.max(0, blankLineBefore(start) + 1);
    openers ??= openerPositions(ctx.text, paragraphStart, ctx.to);
    if (hasPositionIn(openers, paragraphStart, start)) {
      // Too far to re-read per match: leave it rather than guess.
      if (start - paragraphStart > MAX_QUOTE_LOOKBACK) continue;
      if (isInsideProtectedSpan(ctx.text.slice(paragraphStart, start), { quotations: true })) {
        continue;
      }
    }
    findings.push({
      ruleId: "englishOrdinalSuffix",
      messageKey: "review_msg_ordinal",
      range: { start, end },
      alternatives: [`${digits}${expected}`],
    });
  }
  return findings;
};

const properNoun: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  // Word ends, digits included: "may 15" is decided at the end of "15".
  const regex = /[\p{L}\p{N}]+(?:['’]s)?(?![\p{L}\p{N}_])/gu;
  regex.lastIndex = Math.max(0, ctx.from - 32);
  for (let match = regex.exec(ctx.scanText); match; match = regex.exec(ctx.scanText)) {
    const wordEnd = match.index + match[0].length;
    if (match.index >= ctx.to + 32) break;
    const before = ctx.text.slice(Math.max(0, match.index - 12), match.index);
    if (!couldEndProperName(match[0], before)) continue;
    const windowStart = Math.max(0, wordEnd - 160);
    const core = ctx.text.slice(windowStart, wordEnd);
    // Unlike typing, the words after it are here too: "in may," is the month.
    const found =
      findProperName(core) ??
      (isMonthInContext(
        match[0],
        ctx.text.slice(Math.max(0, match.index - 48), match.index),
        ctx.text.slice(wordEnd, wordEnd + 24),
      )
        ? {
            start: core.length - match[0].length,
            end: core.length,
            canonical: match[0][0].toUpperCase() + match[0].slice(1),
            contextual: true,
          }
        : null);
    if (!found) continue;
    const start = windowStart + found.start;
    const end = windowStart + found.end;
    if (!owned(ctx, start) || isGluedToTechnical(ctx.text, start, wordEnd)) continue;
    const typed = ctx.text.slice(start, end);
    const replaced = recase(typed, found.canonical);
    if (
      replaced === typed ||
      ctx.dictionary.has(typed.toLowerCase()) ||
      ctx.dictionary.has(found.canonical.toLowerCase())
    ) {
      continue;
    }
    findings.push({
      ruleId: "englishProperNounCapitalization",
      messageKey: "review_msg_proper_noun",
      range: { start, end },
      alternatives: [replaced],
      // may/march/august needed a date or a clause end next to them; that is evidence.
      context: found.contextual ? { start: Math.max(0, start - 16), end: wordEnd + 16 } : undefined,
      bulkBlock: found.contextual ? "context-dependent" : undefined,
    });
  }
  // "christmas" is found at its own end and again inside "christmas eve": keep the longer name.
  return findings.filter(
    (finding) =>
      !findings.some(
        (other) =>
          other !== finding &&
          other.range.start <= finding.range.start &&
          other.range.end >= finding.range.end &&
          other.range.end - other.range.start > finding.range.end - finding.range.start,
      ),
  );
};

// ------------------------------------------------------ punctuation and spacing

const commaPeriodSpacing: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  // Space before a comma: "word , next".
  const before = /(?<=[\p{L}\p{N})\]"”’])[ \u00A0]+(?=[,،](?![,،]))/gu;
  for (const match of ownedMatches(ctx, before)) {
    const start = match.index;
    const end = start + match[0].length;
    findings.push({
      ruleId: "commaPeriodSpacing",
      messageKey: "review_msg_space_before_comma",
      range: { start, end: end + 1 },
      alternatives: [ctx.source[end]],
      context: { start: start - 1, end: end + 1 },
    });
  }

  // Space before a sentence mark followed by whitespace or the end: "Hello . Next".
  const frenchSpacing = usesFrenchPunctuationSpacing(ctx.lang);
  const mark = /(?<=[\p{L}\p{N})\]}"”’»])[ \u00A0]+([.?!])(?=\s|$)/gu;
  for (const match of ownedMatches(ctx, mark)) {
    const start = match.index;
    if (match[1] !== "." && frenchSpacing) continue;
    const end = start + match[0].length;
    findings.push({
      ruleId: "commaPeriodSpacing",
      messageKey: "review_msg_space_before_mark",
      range: { start, end },
      alternatives: [match[1]],
      context: { start: start - 1, end },
    });
  }

  // Missing space after a comma between words: "one,two". Only between words
  // of two or more letters, never in a comma-separated token ("a,b", "x,y,z").
  if (!ctx.insertSpaceAfterAutocomplete) return findings;
  const after = /(?<=\p{L}{2})[,،](?=\p{L}{2})/gu;
  for (const match of ownedMatches(ctx, after)) {
    const start = match.index;
    let tokenStart = start;
    while (tokenStart > 0 && !/\s/.test(ctx.text[tokenStart - 1])) tokenStart -= 1;
    let tokenEnd = start;
    while (tokenEnd < ctx.text.length && !/\s/.test(ctx.text[tokenEnd])) tokenEnd += 1;
    const token = ctx.text.slice(tokenStart, tokenEnd);
    if ((token.match(/[,،]/g)?.length ?? 0) > 1 || /[\uFFFC@#/\\_=.:;]/u.test(token)) continue;
    findings.push({
      ruleId: "commaPeriodSpacing",
      messageKey: "review_msg_space_after_comma",
      range: { start, end: start + 1 },
      alternatives: [`${ctx.source[start]} `],
      context: { start: tokenStart, end: tokenEnd },
    });
  }
  return findings;
};

const repeatedSpaces: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  // Per line start: a long line is measured once, not once per gap.
  const gapCounts = new Map<number, number>();
  const newlineBefore = lastIndexFinder(ctx.text, "\n");
  const regex = /(?<=[^\s])[ \u00A0]{2,}(?=[^\s])/gu;
  for (const match of ownedMatches(ctx, regex)) {
    const start = match.index;
    const lineStart = newlineBefore(start) + 1;
    // Several wide gaps on one line are alignment (a plain-text table), not typos.
    if (!gapCounts.has(lineStart)) {
      let lineEnd = ctx.text.indexOf("\n", start);
      if (lineEnd < 0) lineEnd = ctx.text.length;
      const gaps = ctx.text.slice(lineStart, lineEnd).match(/(?<=\S)[ \u00A0]{2,}(?=\S)/gu);
      gapCounts.set(lineStart, gaps?.length ?? 0);
    }
    if (gapCounts.get(lineStart)! > 1) continue;
    const end = start + match[0].length;
    // Keep the first space: a no-break space placed on purpose stays.
    findings.push({
      ruleId: "collapseRepeatedSpaces",
      messageKey: "review_msg_repeated_spaces",
      range: { start, end },
      alternatives: [ctx.source[start]],
    });
  }
  return findings;
};

const duplicatePunctuation: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  // ",," ";;" ", ," and the Arabic equivalents. ":" is left out: "std::vector".
  const run = /([,;،؛])(?:[ \u00A0]*\1)+/gu;
  for (const match of ownedMatches(ctx, run)) {
    const start = match.index;
    const end = start + match[0].length;
    if (isGluedToTechnical(ctx.text, start, start)) continue;
    findings.push({
      ruleId: "duplicatePunctuationCollapse",
      messageKey: "review_msg_duplicate_punctuation",
      range: { start, end },
      alternatives: [match[1]],
    });
  }
  // "word.." (never "..." or "../"): one period too many at a sentence end.
  const periods = /(?<=[\p{L}\p{N})\]"”’])\.\.(?=\s|$)/gu;
  for (const match of ownedMatches(ctx, periods)) {
    const start = match.index;
    findings.push({
      ruleId: "duplicatePunctuationCollapse",
      messageKey: "review_msg_duplicate_punctuation",
      range: { start, end: start + 2 },
      alternatives: ["."],
    });
  }
  return findings;
};

function measurementLike(
  ctx: DetectContext,
  ruleId: "measurementUnitFormatting" | "currencySpacing",
): RawFinding[] {
  const locale = resolveMeasurementLocale(ctx.lang);
  if (!locale) return [];
  const findings: RawFinding[] = [];
  // Tokens, then a digit test: a "[^\s]*\d[^\s]*" pattern backtracks on long tokens.
  const regex = /[^\s\uFFFC]+/gu;
  regex.lastIndex = Math.max(0, ctx.from);
  // Back up to the start of a token cut by `from`.
  while (regex.lastIndex > 0 && !/[\s\uFFFC]/u.test(ctx.text[regex.lastIndex - 1])) {
    regex.lastIndex -= 1;
  }
  for (let match = regex.exec(ctx.scanText); match; match = regex.exec(ctx.scanText)) {
    if (match.index >= ctx.to + 64) break;
    // Only a unit glued to its number is a finding ("10kg", "5$"); plain numbers
    // skip the window parse, which dominates number-heavy text.
    if (!/\p{Nd}[^\p{Nd}\s.,]/u.test(match[0])) continue;
    const bare = match[0].replace(/[.,;:!?)\]]+$/u, "");
    const tokenEnd = match.index + bare.length;
    const windowStart = Math.max(0, tokenEnd - 160);
    const prefix = ctx.text.slice(windowStart, tokenEnd);
    const parsed =
      ruleId === "currencySpacing"
        ? parseMeasurementExpression(prefix, locale, (value, start) =>
            CURRENCY_MARKERS.has(value.slice(start)),
          )
        : parseMeasurementExpression(prefix, locale);
    if (!parsed || parsed.unitStart !== parsed.numberEnd) continue;
    const unit = prefix.slice(parsed.unitStart);
    if (ruleId === "measurementUnitFormatting" && /^([A-Z]|[dg])$/.test(unit)) continue;
    if (!isProsePrefix(prefix.slice(0, parsed.start))) continue;
    const start = windowStart + parsed.start;
    if (!owned(ctx, start)) continue;
    const numberEnd = windowStart + parsed.numberEnd;
    findings.push({
      ruleId,
      messageKey:
        ruleId === "currencySpacing"
          ? "review_msg_currency_spacing"
          : "review_msg_measurement_spacing",
      range: { start, end: tokenEnd },
      alternatives: [
        `${ctx.source.slice(start, numberEnd)}${locale.separator}${ctx.source.slice(numberEnd, tokenEnd)}`,
      ],
    });
  }
  return findings;
}

/** Review detectors by rule. Rules absent here are excluded from review (see reviewCatalog). */
export const REVIEW_DETECTORS: ReadonlyArray<{ rules: CatalogRuleId[]; detect: Detector }> = [
  { rules: ["capitalizeSentenceStart", "capitalizeAfterLineBreak"], detect: capitalizeStarts },
  { rules: ["englishPronounICapitalization"], detect: pronounI },
  {
    rules: [
      "englishTypoWhitelistCorrection",
      "englishContractionNormalization",
      "englishAlotCorrection",
    ],
    detect: wordSpelling,
  },
  { rules: ["englishModalOfCorrection"], detect: modalOf },
  { rules: ["englishYourWelcomeCorrection"], detect: yourWelcome },
  { rules: ["englishTheirThereBeVerb"], detect: theirThere },
  { rules: ["englishPronounVerbWhitelistAgreement"], detect: pronounVerb },
  { rules: ["englishArticleAnCorrection"], detect: articleAn },
  { rules: ["englishOrdinalSuffix"], detect: ordinal },
  { rules: ["englishProperNounCapitalization"], detect: properNoun },
  { rules: ["commaPeriodSpacing"], detect: commaPeriodSpacing },
  { rules: ["collapseRepeatedSpaces"], detect: repeatedSpaces },
  { rules: ["duplicatePunctuationCollapse"], detect: duplicatePunctuation },
  {
    rules: ["measurementUnitFormatting"],
    detect: (ctx) => measurementLike(ctx, "measurementUnitFormatting"),
  },
  { rules: ["currencySpacing"], detect: (ctx) => measurementLike(ctx, "currencySpacing") },
];

/** Minimal edits turning source[start, start+original.length) into `replacement`. */
export function minimalEdits(
  source: string,
  start: number,
  end: number,
  replacement: string,
): ReviewEdit[] {
  const original = source.slice(start, end);
  if (original === replacement) return [];
  const originalTokens = original.split(/(\s+)/);
  const replacementTokens = replacement.split(/(\s+)/);
  const aligned =
    originalTokens.length === replacementTokens.length &&
    originalTokens.every((token, index) => index % 2 === 0 || token === replacementTokens[index]);
  if (aligned && originalTokens.length > 1) {
    const edits: ReviewEdit[] = [];
    let offset = start;
    originalTokens.forEach((token, index) => {
      if (index % 2 === 0)
        edits.push(...trimmedEdit(source, offset, token, replacementTokens[index]));
      offset += token.length;
    });
    return edits;
  }
  return trimmedEdit(source, start, original, replacement);
}

/** One edit with the common prefix/suffix trimmed back to grapheme boundaries. */
function trimmedEdit(
  source: string,
  start: number,
  original: string,
  replacement: string,
): ReviewEdit[] {
  if (original === replacement) return [];
  let { prefix, suffix } = commonAffixes(original, replacement);
  while (prefix > 0 && !isGraphemeBoundary(source, start + prefix)) prefix -= 1;
  while (suffix > 0 && !isGraphemeBoundary(source, start + original.length - suffix)) suffix -= 1;
  let editStart = start + prefix;
  let editEnd = start + original.length - suffix;
  let insertion = replacement.slice(prefix, replacement.length - suffix);
  // A pure insertion is anchored on the character before it (or after it at
  // the start), so it maps to one text node and takes that node's formatting.
  if (editStart === editEnd) {
    if (prefix > 0) {
      const anchorStart = previousBoundary(source, editStart);
      insertion = source.slice(anchorStart, editStart) + insertion;
      editStart = anchorStart;
    } else {
      const anchorEnd = graphemeEnd(source, editEnd);
      insertion += source.slice(editEnd, anchorEnd);
      editEnd = anchorEnd;
    }
  }
  return [
    {
      start: editStart,
      end: editEnd,
      original: source.slice(editStart, editEnd),
      replacement: insertion,
    },
  ];
}

function previousBoundary(text: string, index: number): number {
  let start = index - 1;
  while (start > 0 && !isGraphemeBoundary(text, start)) start -= 1;
  return start;
}
