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
import { normalizeContractionToken } from "../implementations/EnglishContractionNormalizationRule";
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
  recase,
} from "../implementations/EnglishProperNounCapitalizationRule";
import { CURRENCY_MARKERS } from "../implementations/CurrencySpacingRule";
import { isProsePrefix } from "../implementations/MeasurementUnitFormattingRule";
import {
  PROTECTED_SPAN_OPENERS,
  isInsideProtectedSpan,
} from "../implementations/helpers/ProtectedSpanShared";
import { isLowercaseLetter, isTechnicalToken } from "../implementations/helpers/GenericRuleShared";
import { isGraphemeBoundary } from "./textRanges";
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
  if (TECHNICAL_GLUE.test(before) || TECHNICAL_GLUE.test(after) || before === MASK_CHAR) {
    return true;
  }
  if (after === MASK_CHAR) return true;
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

function owned(ctx: DetectContext, start: number): boolean {
  return start >= ctx.from && start < ctx.to;
}

function graphemeEnd(text: string, index: number): number {
  let end = index + 1;
  while (end < text.length && !isGraphemeBoundary(text, end)) end += 1;
  return end;
}

// ---------------------------------------------------------------- capitalization

const capitalizeStarts: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  const regex = /[^\s\uFFFC]+/gu;
  regex.lastIndex = ctx.from;
  for (let match = regex.exec(ctx.scanText); match; match = regex.exec(ctx.scanText)) {
    const wordStart = match.index;
    if (wordStart >= ctx.to) break;
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
      let evidence = wordStart - 1;
      while (evidence > 0 && isSpace(ctx.text[evidence])) evidence -= 1;
      findings.push({
        ruleId: "capitalizeSentenceStart",
        messageKey: "review_msg_sentence_start",
        range,
        alternatives: [upper],
        context: { start: Math.max(0, Math.min(evidence, wordStart)), end: wordEnd },
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
  regex.lastIndex = ctx.from;
  for (let match = regex.exec(ctx.scanText); match; match = regex.exec(ctx.scanText)) {
    const start = match.index;
    if (start >= ctx.to) break;
    const before = ctx.text[start - 1] ?? "";
    if (/[@#/\\.=$\-([]/.test(before) || before === MASK_CHAR) continue;
    const rest = ctx.text.slice(start + 1, start + 1 + 40);
    let contextEnd = start + 1;
    if (/^['’](?:m|ve|ll|d)(?![\p{L}\p{N}])/u.test(rest)) {
      contextEnd += rest.match(/^['’]\w+/)![0].length;
    } else if (/^[,;!?]/.test(rest)) {
      contextEnd += 1;
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
      context: { start, end: contextEnd },
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
    const contraction = normalizeContractionToken(
      word,
      ctx.text.slice(Math.max(0, start - PHRASE_WINDOW), start),
    );
    if (contraction) {
      findings.push({
        ruleId: "englishContractionNormalization",
        messageKey: "review_msg_contraction",
        range,
        alternatives: [contraction],
        // The name guard reads the previous word on the line.
        context: { start: Math.max(0, ctx.text.lastIndexOf(" ", start - 2) + 1), end },
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
    const phrase = match[0];
    const firstToken = phrase.split(/\s+/)[0];
    const [you, welcome] = correctYourWelcome(firstToken);
    const gap = phrase.slice(firstToken.length, phrase.length - "welcome".length);
    findings.push({
      ruleId: "englishYourWelcomeCorrection",
      messageKey: "review_msg_your_welcome",
      range: { start, end },
      alternatives: [`${you}${gap}${welcome}`],
      context: { start, end: Math.min(ctx.text.length, end + 1) },
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
  for (const { match, start, end } of phraseMatches(ctx, AGREEMENT_REGEX, 3)) {
    const phrase = match[1];
    const corrected = AGREEMENT_CORRECTIONS.get(phrase.toLowerCase().replace(/\s+/, " "));
    if (!corrected) continue;
    const [pronoun, verb] = correctPronounVerb(phrase, corrected);
    const inputPronoun = phrase.split(/\s+/)[0];
    const gap = phrase.slice(inputPronoun.length, phrase.length - phrase.split(/\s+/)[1].length);
    // The pronoun "i" is always capitalized; the case rule would flag it anyway.
    const fixedPronoun = pronoun === "i" ? "I" : pronoun;
    const phraseRange = groupRange(match, 1);
    findings.push({
      ruleId: "englishPronounVerbWhitelistAgreement",
      messageKey: "review_msg_pronoun_verb",
      range: phraseRange,
      alternatives: [`${fixedPronoun}${gap}${verb}`],
      context: { start, end },
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
  regex.lastIndex = ctx.from;
  for (let match = regex.exec(ctx.scanText); match; match = regex.exec(ctx.scanText)) {
    const start = match.index;
    if (start >= ctx.to) break;
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
    if (!couldEndProperName(match[0])) continue;
    const windowStart = Math.max(0, wordEnd - 160);
    const core = ctx.text.slice(windowStart, wordEnd);
    const found = findProperName(core);
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
      // may/march/august needed a date next to them; that date is evidence.
      context: found.contextual ? { start: Math.max(0, start - 16), end: wordEnd + 12 } : undefined,
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
  before.lastIndex = ctx.from;
  for (let match = before.exec(ctx.scanText); match; match = before.exec(ctx.scanText)) {
    const start = match.index;
    if (start >= ctx.to) break;
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
  mark.lastIndex = ctx.from;
  for (let match = mark.exec(ctx.scanText); match; match = mark.exec(ctx.scanText)) {
    const start = match.index;
    if (start >= ctx.to) break;
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
  after.lastIndex = ctx.from;
  for (let match = after.exec(ctx.scanText); match; match = after.exec(ctx.scanText)) {
    const start = match.index;
    if (start >= ctx.to) break;
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
  regex.lastIndex = ctx.from;
  for (let match = regex.exec(ctx.scanText); match; match = regex.exec(ctx.scanText)) {
    const start = match.index;
    if (start >= ctx.to) break;
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
  run.lastIndex = ctx.from;
  for (let match = run.exec(ctx.scanText); match; match = run.exec(ctx.scanText)) {
    const start = match.index;
    if (start >= ctx.to) break;
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
  periods.lastIndex = ctx.from;
  for (let match = periods.exec(ctx.scanText); match; match = periods.exec(ctx.scanText)) {
    const start = match.index;
    if (start >= ctx.to) break;
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
    if (!/\p{Nd}/u.test(match[0])) continue;
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
  let prefix = 0;
  while (
    prefix < original.length &&
    prefix < replacement.length &&
    original[prefix] === replacement[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < replacement.length - prefix &&
    original[original.length - 1 - suffix] === replacement[replacement.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  while (prefix > 0 && !isGraphemeBoundary(source, start + prefix)) prefix -= 1;
  while (suffix > 0 && !isGraphemeBoundary(source, start + original.length - suffix)) suffix -= 1;
  let editStart = start + prefix;
  let editEnd = start + original.length - suffix;
  let insertion = replacement.slice(prefix, replacement.length - suffix);
  // A pure insertion is anchored on the character before it (or after it at
  // the start), so it maps to one text node and takes that node's formatting.
  if (editStart === editEnd) {
    if (prefix > 0 || editStart > start) {
      const anchorStart = editStart - (editStart - previousBoundary(source, editStart));
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
