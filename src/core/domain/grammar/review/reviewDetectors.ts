import { CUE_AND_QUOTE } from "./exampleCues";
import { canonicalCasing } from "./canonicalCasing";
import { phraseCorrections } from "./englishPhraseCorrections";
import { usagePhrases } from "./englishUsagePhrases";
import { doubledDegree } from "./englishDegree";
import {
  doubledDegreeByLanguage,
  frenchElisions,
  germanNounCapitals,
  markedApostrophes,
  splitWords,
} from "./multilingualLexicon";
import { countability } from "./englishCountability";
import { contextualCompounds } from "./englishCompounds";
import { nounNumberConstructions } from "./englishNounNumber";
import { perfectParticiples } from "./englishParticiples";
import { verbComplements } from "./englishComplements";
import { fixedPrepositions } from "./englishPrepositions";
import { contextualPossessives } from "./englishPossessives";
import {
  additionalPronounAgreement,
  existentialAgreement,
  subjectAgreement,
} from "./englishAgreement";
import { wordConfusions } from "./englishWordConfusions";
import { auxiliaryForms } from "./englishAuxiliaryForms";
import { pronounCase } from "./englishPronounCase";
import { sentenceStructure } from "./englishSentenceStructure";
import type { CatalogRuleId } from "../ruleCatalog";
import { SPACE_CHARS } from "../../spacingRules";
import {
  isGreekQuestionMark,
  resolveTypographyProfile,
  usesFrenchPunctuationSpacing,
} from "../typographyProfiles";
import { parseMeasurementExpression } from "../measurement/parser";
import { resolveMeasurementLocale } from "../measurement/registry";
import {
  CLOSING_CHARS,
  closesAbbreviation,
  CLOSING_PADDING_CHARS,
  keepsOwnCasing,
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
  isNounMight,
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
  PREVIOUS_WORD,
  correctPronounVerb,
  isObjectYou,
} from "../implementations/EnglishPronounVerbWhitelistAgreementRule";
import { lastNonBlankBefore, opensClause } from "../implementations/helpers/EnglishRuleShared";
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
import { isLowercaseLetter, isTechnicalToken } from "../implementations/helpers/GenericRuleShared";
import { commonAffixes, isGraphemeBoundary, overlapsSortedRanges } from "./textRanges";
import type { ReviewEdit, ReviewMessageKey, TextRange } from "./types";
import { EXTENSION_DETECTORS } from "./english";

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
  /** Enabled checks; a detector serving several may skip the others' work. Absent: all. */
  rules?: ReadonlySet<string>;
  quotationFindings?: readonly RawFinding[];
  quotationRanges?: readonly TextRange[];
  exampleRanges?: readonly TextRange[];
  styleFindings?: readonly RawFinding[];
  terminologyFindings?: readonly RawFinding[];
}

export interface RawFinding {
  terminology?: { id: string; explanation: string };
  ruleId: CatalogRuleId;
  messageKey: ReviewMessageKey;
  range: TextRange;
  /** Replacement for `range`, per alternative. */
  alternatives: string[];
  warningOnly?: true;
  /** Evidence the decision depended on; defaults to `range`. */
  context?: TextRange;
  /** A finding the rule's metadata would batch but this instance must not. */
  bulkBlock?: "context-dependent" | "ambiguous";
  dictionaryWord?: string;
  requiresChoice?: true;
}

type Detector = (ctx: DetectContext) => RawFinding[];
export type ReviewDetectorEntry = { rules: CatalogRuleId[]; detect: Detector };

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

/** Where the clause-opening evidence for a phrase at `index` starts. */
function clauseEvidenceStart(text: string, index: number): number {
  return Math.max(0, lastNonBlankBefore(text, index));
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
    if (isTechnicalToken(bare) || keepsOwnCasing(bare)) continue;
    const upper = letter.toUpperCase();
    if (upper === letter) continue;
    const range = { start: letterIndex, end: letterEnd };
    const wordEnd = wordStart + bare.length;

    if (startsSentence(ctx.text, wordStart, ctx.lang)) {
      const end = sentenceEndBefore(ctx.text, wordStart);
      const mark = ctx.text[end.mark];
      if (overlapsSortedRanges(ctx.exampleRanges ?? [], { start: end.mark, end: end.mark + 1 }))
        continue;
      // "“Stop!” she shouted", "(really?) and": a quoted or bracketed "!" or
      // "?" before a lowercase word ends the quotation, not the sentence.
      if (end.closed && mark !== ".") continue;
      // "press . to repeat", "type ? for help": a named mark is a symbol, not
      // a sentence end. French spaces "?" and "!" on purpose.
      if (
        end.mark >= 0 &&
        namesMark(ctx.text, end.mark) &&
        !(mark !== "." && usesFrenchPunctuationSpacing(ctx.lang))
      ) {
        continue;
      }
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
        // 'He said "stop." she left': the quotation may end inside the sentence.
        bulkBlock: end.closed ? "context-dependent" : undefined,
      });
      continue;
    }
    const lineBreak = lineBreakBefore(ctx.text, wordStart);
    if (lineBreak !== null && previousLineEndsParagraphOrSentence(ctx.text, lineBreak, ctx.lang)) {
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

/**
 * The sentence mark `startsSentence` read before `wordStart` (its index), and
 * whether closing quotes or brackets sit between it and the word ("Stop!” she").
 */
function sentenceEndBefore(text: string, wordStart: number): { mark: number; closed: boolean } {
  let i = wordStart - 1;
  while (i >= 0 && isSpace(text[i])) i -= 1;
  const closer = i;
  while (i >= 0 && (CLOSING_CHARS.has(text[i]) || CLOSING_PADDING_CHARS.has(text[i]))) i -= 1;
  return { mark: i, closed: i !== closer };
}

// Words that name the key or symbol right after them: "press . to repeat".
const MARK_NAMING_WORDS = new Set([
  ...["press", "presses", "pressed", "pressing", "type", "types", "typed", "typing", "hit"],
  ...["hits", "tap", "taps", "enter", "enters", "use", "uses", "key", "keys", "add", "adds"],
  ...["insert", "inserts", "put", "puts", "remove", "removes", "delete", "deletes", "the"],
  ...["a", "an", "character", "char", "symbol", "sign", "dot", "mark", "punctuation"],
]);
const MARK_QUOTES = /^["'“”‘’`]$/u;
const LINE_SPACE = /^[ \t ]$/u;

/**
 * True when the mark at `index` is named, not ending a sentence: it stands
 * alone after a word that names keys or symbols ("press . to repeat", "Type ?
 * for help"), or it is wrapped in quotes or backticks ("type '.' to repeat").
 */
function namesMark(text: string, index: number): boolean {
  let before = index - 1;
  while (before >= 0 && LINE_SPACE.test(text[before])) before -= 1;
  let after = index + 1;
  while (after < text.length && LINE_SPACE.test(text[after])) after += 1;
  if (MARK_QUOTES.test(text[before] ?? "") && MARK_QUOTES.test(text[after] ?? "")) return true;
  // "It was late . we left" is a stray space: only a naming word makes it a symbol.
  if (before === index - 1) return false;
  let wordStart = before + 1;
  while (wordStart > 0 && /[A-Za-z]/.test(text[wordStart - 1])) wordStart -= 1;
  if (WORD_CHAR.test(text[wordStart - 1] ?? "")) return false;
  return MARK_NAMING_WORDS.has(text.slice(wordStart, before + 1).toLowerCase());
}

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
function previousLineEndsParagraphOrSentence(
  text: string,
  lineBreak: number,
  lang: string,
): boolean {
  const previousStart = text.lastIndexOf("\n", lineBreak - 1) + 1;
  const previous = text.slice(previousStart, lineBreak).trim();
  if (previous === "") return true;
  if (previous.endsWith(MASK_CHAR)) return false;
  // "siehe z. B.\nfolgendes": a wrapped line may end on an abbreviation.
  let lineEnd = lineBreak - 1;
  while (lineEnd > previousStart && /\s/.test(text[lineEnd])) lineEnd -= 1;
  if (text[lineEnd] === "." && closesAbbreviation(text, lineEnd, lang)) return false;
  return (
    /[.!?؟]["'”’“»«)\]]*$/u.test(previous) ||
    isGreekQuestionMark(previous.replace(/["'”’“»«)\]]+$/u, "").slice(-1), lang)
  );
}

const pronounI: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  const regex = /(?<![\p{L}\p{N}_'’])i(?![\p{L}\p{N}_])/gu;
  for (const match of ownedMatches(ctx, regex)) {
    const start = match.index;
    const before = ctx.text[start - 1] ?? "";
    if (/[@#/\\.=$\-[]/.test(before) || before === MASK_CHAR) continue;
    if (IDENTIFIER_BEFORE.test(ctx.text.slice(Math.max(0, start - 24), start))) continue;
    const rest = ctx.text.slice(start + 1, start + 1 + 40);
    let contextEnd = start + 1;
    let sentenceEnd = false;
    if (/^['’](?:m|ve|ll|d)(?![\p{L}\p{N}])/u.test(rest)) {
      contextEnd += rest.match(/^['’]\w+/)![0].length;
    } else if (before === "(" && !/^[ \t ]/.test(rest)) {
      // "(i think)" is the pronoun; "(i)", "(i, ii)" and "f(i)" are not.
      continue;
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
    // "--dont-ask", "dont-care", "alot-lib": a hyphen after the word makes it
    // part of a longer name, and typing never reaches a word boundary there.
    // A double hyphen is a dash ("I dont--really--care"): like a space.
    if (ctx.text[end] === "-" && ctx.text[end + 1] !== "-") continue;
    // Typing still corrects the end of "x-teh" or "--dont", so review flags it,
    // but only one at a time: a compound or an option name may be deliberate.
    const glued: RawFinding["bulkBlock"] = ctx.text[start - 1] === "-" ? "ambiguous" : undefined;
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
        bulkBlock: glued,
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
        bulkBlock: pronounForm ? "ambiguous" : glued,
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
        bulkBlock: glued,
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
    if (isNounMight(match[1], ctx.text.slice(Math.max(0, start - 24), start))) continue;
    const modal = groupRange(match, 1);
    let ofStart = modal.end;
    while (/\s/.test(ctx.text[ofStart] ?? "")) ofStart += 1;
    const ofRange = { start: ofStart, end: ofStart + 2 };
    if (ctx.text.slice(ofRange.start, ofRange.end).toLowerCase() !== "of") continue;
    findings.push({
      ruleId: "englishModalOfCorrection",
      messageKey: "review_msg_modal_of",
      range: { start, end: ofRange.end },
      alternatives: [
        `${ctx.source.slice(start, ofRange.start)}${modalHaveWord(match[1], ctx.text.slice(ofRange.start, ofRange.end))}`,
      ],
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
    if (end < ctx.text.length && !/^[.!?\r\n]/.test(ctx.text[end])) continue;
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

// Subordinators after which "you" opens a clause as its subject: "if you was".
const YOU_SUBJECT_BEFORE = new Set([
  ...["if", "when", "whenever", "because", "while", "although", "though", "unless"],
  ...["whether", "since", "until", "once", "where", "wherever", "that"],
]);

const pronounVerb: Detector = (ctx) => {
  const findings = additionalPronounAgreement(ctx);
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
    let bulkBlock: RawFinding["bulkBlock"];
    if (inputPronoun.toLowerCase() === "you") {
      // "Everything I told you was", "Seeing you was", "the gift for you was":
      // "you" is the object of the word before it, and "was" is right.
      if (isObjectYou(ctx.text, phraseRange.start)) continue;
      const previous = PREVIOUS_WORD.exec(
        ctx.text.slice(Math.max(0, phraseRange.start - 32), phraseRange.start),
      )?.[1].toLowerCase();
      // Only a clause start says subject for sure ("You was late.", "if you
      // was there"); anywhere else ("I heard you was sick") the word before
      // may still take "you" as its object: one at a time.
      if (!opensClause(ctx.text, phraseRange.start) && !YOU_SUBJECT_BEFORE.has(previous ?? "")) {
        bulkBlock = "context-dependent";
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
      bulkBlock,
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
    const corrected = correctArticle(article, word, ctx.dictionary);
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

/** True when the word before or after [start, end) on its line is written in capitals ("THE 3RD ROUND"). */
function isAllCapsContext(text: string, start: number, end: number): boolean {
  const before = /(\p{L}+)[^\p{L}\n]*$/u.exec(text.slice(Math.max(0, start - 24), start))?.[1];
  const after = /^[^\p{L}\n]*(\p{L}+)/u.exec(text.slice(end, end + 24))?.[1];
  return [before, after].some((word) => word && word.length > 1 && word === word.toUpperCase());
}

const ordinal: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  const regex = /(?<=^|[\s([])(\d+)(st|nd|rd|th)(?![\p{L}\p{N}])/giu;
  for (const match of ownedMatches(ctx, regex)) {
    const start = match.index;
    const [token, digits, suffix] = match;
    const expected = ordinalSuffix(digits);
    const end = start + token.length;
    if (suffix === expected || isGluedToTechnical(ctx.text, start, end)) continue;
    if (suffix !== suffix.toLowerCase()) {
      // "2ND" is "2nd" in a sentence; "42RD" (road) and all-caps headings are not.
      if (
        suffix.toLowerCase() !== expected ||
        isAllCapsContext(ctx.text, start, end) ||
        overlapsSortedRanges(ctx.quotationRanges ?? [], { start, end })
      )
        continue;
      findings.push({
        ruleId: "englishOrdinalSuffix",
        messageKey: "review_msg_ordinal_case",
        context: { start: Math.max(0, start - 24), end: Math.min(ctx.text.length, end + 24) },
        range: { start, end },
        alternatives: [`${digits}${expected}`],
        bulkBlock: "context-dependent",
      });
      continue;
    }
    // "rd" is also rod ("a 16rd chain").
    if (suffix === "rd") continue;
    // "st" is also stone. Only a named month disambiguates this new coverage.
    if (
      suffix === "st" &&
      !/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)[ \t\u00a0]+$/i.test(
        ctx.text.slice(Math.max(0, start - 24), start),
      )
    )
      continue;
    if (overlapsSortedRanges(ctx.quotationRanges ?? [], { start, end })) continue;
    findings.push({
      ruleId: "englishOrdinalSuffix",
      messageKey: "review_msg_ordinal",
      context: { start: 0, end },
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

// Spaces and a lowercase word (after an optional opening mark) on the same line.
const STANDALONE_MARK_FOLLOWER = /^[ \t\u00A0]+["'“‘([¿¡]?\p{Ll}/u;

// A fullwidth "，" or ideographic "、" comma between words of an alphabetic
// script ("red，green") is an input-method slip; CJK text keeps its own.
const ALPHABETIC = "[\\p{Script=Latin}\\p{Script=Greek}\\p{Script=Cyrillic}\\p{N}]";
const WIDE_COMMA = new RegExp(
  `(?<=${ALPHABETIC})[ \\u00A0]*[，、][ \\u00A0]*(?=${ALPHABETIC}|\\s|$)`,
  "gu",
);

const commaPeriodSpacing: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  // Space before a comma: "word , next".
  // "،" and "؛" are the Arabic comma and semicolon.
  const before = /(?<=[\p{L}\p{N})\]"”’])[ \u00A0]+(?=[,،؛](?![,،؛]))/gu;
  for (const match of ownedMatches(ctx, before)) {
    const start = match.index;
    const end = start + match[0].length;
    // "word ,next": the space belongs after the comma.
    const moveSpace =
      ctx.insertSpaceAfterAutocomplete && /^\p{L}{2}/u.test(ctx.text.slice(end + 1, end + 3));
    findings.push({
      ruleId: "commaPeriodSpacing",
      messageKey:
        ctx.source[end] === "؛" ? "review_msg_space_before_mark" : "review_msg_space_before_comma",
      range: { start, end: end + 1 },
      alternatives: [moveSpace ? `${ctx.source[end]} ` : ctx.source[end]],
      context: { start: start - 1, end: end + (moveSpace ? 2 : 1) },
      // Newer language extensions stay individual-only.
      bulkBlock: ctx.source[end] === "؛" ? "context-dependent" : undefined,
    });
  }

  // Space before a sentence mark followed by whitespace or the end: "Hello . Next".
  const frenchSpacing = usesFrenchPunctuationSpacing(ctx.lang);
  // Greek writes its question mark as ";" (or U+037E); Arabic as "؟".
  const mark = /(?<=[\p{L}\p{N})\]}"”’»])[ \u00A0]+([.?!;\u037E؟])(?=\s|$)/gu;
  for (const match of ownedMatches(ctx, mark)) {
    const start = match.index;
    if (match[1] !== "." && frenchSpacing) continue;
    if (/[;\u037E]/.test(match[1]) && !isGreekQuestionMark(match[1], ctx.lang)) continue;
    const end = start + match[0].length;
    // "press . to repeat", "type ? for help": before a lowercase word, a
    // named mark is a symbol, not a sentence end.
    if (
      STANDALONE_MARK_FOLLOWER.test(ctx.text.slice(end, end + 8)) &&
      namesMark(ctx.text, end - 1)
    ) {
      continue;
    }
    findings.push({
      ruleId: "commaPeriodSpacing",
      messageKey: "review_msg_space_before_mark",
      range: { start, end },
      alternatives: [match[1]],
      context: { start: start - 1, end },
      bulkBlock: /[.?!]/.test(match[1]) ? undefined : "context-dependent",
    });
  }

  // Spanish opening marks hug their sentence: "¿ Qué?" is "¿Qué?".
  const opening = /(?<=(?:^|[\s([“"«])[¿¡]+)[ \u00A0]+(?=\p{L})/gu;
  for (const match of ownedMatches(ctx, opening)) {
    const start = match.index;
    const end = start + match[0].length;
    findings.push({
      ruleId: "commaPeriodSpacing",
      messageKey: "review_msg_space_after_opening_mark",
      range: { start: start - 1, end },
      alternatives: [ctx.source[start - 1]],
      context: { start: start - 1, end: end + 1 },
      bulkBlock: "context-dependent",
    });
  }

  for (const match of ownedMatches(ctx, WIDE_COMMA)) {
    const start = match.index;
    const end = start + match[0].length;
    const wordFollows = end < ctx.text.length && !/\s/.test(ctx.text[end]);
    findings.push({
      ruleId: "commaPeriodSpacing",
      messageKey: "review_msg_wide_comma",
      range: { start, end },
      alternatives: [wordFollows ? ", " : ","],
      context: { start: start - 1, end: end + 1 },
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
  const aligned = new Map<number, boolean>();
  const newlineBefore = lastIndexFinder(ctx.text, "\n");
  const regex = /(?<=[^\s])[ \u00A0]{2,}(?=[^\s])/gu;
  for (const match of ownedMatches(ctx, regex)) {
    const start = match.index;
    const lineStart = newlineBefore(start) + 1;
    if (!aligned.has(lineStart)) {
      let lineEnd = ctx.text.indexOf("\n", start);
      if (lineEnd < 0) lineEnd = ctx.text.length;
      const line = ctx.text.slice(lineStart, lineEnd);
      const gaps = line.match(/(?<=\S)[ \u00A0]{2,}(?=\S)/gu);
      const trimmed = line.trim();
      // Several wide gaps on one line are alignment (a plain-text table), not
      // typos; so is the padding of a Markdown table row ("| a  | b |").
      aligned.set(
        lineStart,
        (gaps?.length ?? 0) > 1 ||
          (trimmed.length > 1 && trimmed.startsWith("|") && trimmed.endsWith("|")),
      );
    }
    if (aligned.get(lineStart)) continue;
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
  // An ellipsis has three dots: "So..... anyway". Digits
  // or a path around the run ("1....5", "..../") and dot leaders (10+) are not one.
  const ellipsis = /(?<![.\p{N}])\.{4,9}(?![.\p{N}/\\])/gu;
  for (const match of ownedMatches(ctx, ellipsis)) {
    const start = match.index;
    findings.push({
      ruleId: "duplicatePunctuationCollapse",
      messageKey: "review_msg_ellipsis_length",
      range: { start, end: start + match[0].length },
      alternatives: ["..."],
      // Four dots can be a sentence period plus an ellipsis: one at a time.
      bulkBlock: match[0].length === 4 ? "context-dependent" : undefined,
    });
  }
  return findings;
};

/**
 * A double quotation mark glued to words on both sides ('the "fast"way'): a
 * space is missing outside it. The language's own opening and closing marks
 * say which side; a straight or same-glyph mark (sv ”) is decided by how many
 * marks the paragraph opened before it, and the other side is offered too.
 * Inches and seconds ('5"x7"') are left alone.
 */
const quoteSpacing: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  const [open, close] = resolveTypographyProfile(ctx.lang).double;
  const directional = open !== close;
  const marks = directional ? `"${open}${close}` : `"${open}`;
  const regex = new RegExp(`(?<=[\\p{L}\\p{N}])[${marks}](?=[\\p{L}\\p{N}])`, "gu");
  const paragraphBefore = lastIndexFinder(ctx.text, "\n\n");
  for (const match of ownedMatches(ctx, regex)) {
    const start = match.index;
    const mark = match[0];
    const spaceBefore = ` ${ctx.source[start]}`;
    const spaceAfter = `${ctx.source[start]} `;
    let alternatives: string[];
    if (directional && mark !== '"') {
      alternatives = [mark === open ? spaceBefore : spaceAfter];
    } else {
      if (/\p{N}/u.test(ctx.text[start - 1])) continue;
      const paragraphStart = paragraphBefore(start);
      const paragraph = ctx.text.slice(paragraphStart < 0 ? 0 : paragraphStart + 2, start);
      const opened = paragraph.split(mark).length % 2 === 0;
      alternatives = opened ? [spaceAfter, spaceBefore] : [spaceBefore, spaceAfter];
    }
    findings.push({
      ruleId: "quoteSpacing",
      messageKey: "review_msg_quote_spacing",
      range: { start, end: start + 1 },
      alternatives,
      context: { start: Math.max(0, start - 1), end: start + 2 },
    });
  }
  return findings;
};

// A number, a single mark, a number and a double mark: feet and inches or
// minutes and seconds ("5'7\"", "30′ 15\""). Group 1 and 3 are the marks.
const PRIME_PAIR =
  /(?<=(?<![\p{L}\p{N}.,])\d+[  ]?)(['’‘′])([  ]?\d+(?:[.,]\d+)?[  ]?)(["”“″])(?!\p{N})/gu;
// Degrees then minutes with no seconds after them ("48°51'N").
const DEGREE_MINUTE = /(?<=\d°[  ]?\d+[  ]?)['’‘](?![  ]?\d|\p{L}{2})/gu;

/** Optional typography: prime marks for feet, inches, minutes and seconds typed as quotes. */
const primeSymbols: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  for (const match of ownedMatches(ctx, PRIME_PAIR)) {
    if (match[1] === "′" && match[3] === "″") continue;
    const start = match.index;
    const end = start + match[0].length;
    findings.push({
      ruleId: "primeSymbols",
      messageKey: "review_msg_prime_symbols",
      range: { start, end },
      alternatives: [`′${ctx.source.slice(start + 1, end - 1)}″`],
      context: { start: Math.max(0, start - 8), end: Math.min(ctx.text.length, end + 1) },
    });
  }
  for (const match of ownedMatches(ctx, DEGREE_MINUTE)) {
    const start = match.index;
    findings.push({
      ruleId: "primeSymbols",
      messageKey: "review_msg_prime_symbols",
      range: { start, end: start + 1 },
      alternatives: ["′"],
      context: { start: Math.max(0, start - 8), end: Math.min(ctx.text.length, start + 2) },
    });
  }
  return findings;
};

/**
 * Optional typography: three periods as the one ellipsis character. Longer runs,
 * ranges ("1...5"), paths ("../") and spread syntax ("[...items]") are not ellipses.
 */
const ellipsisCharacter: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  const regex = /(?<![.\p{N}])\.{3}(?![.\p{N}/\\])/gu;
  for (const match of ownedMatches(ctx, regex)) {
    const start = match.index;
    if (/[[({]/.test(ctx.text[start - 1] ?? "") && /[\p{L}_$]/u.test(ctx.text[start + 3] ?? ""))
      continue;
    findings.push({
      ruleId: "ellipsisShortcut",
      messageKey: "review_msg_ellipsis_character",
      range: { start, end: start + 3 },
      alternatives: ["…"],
    });
  }
  return findings;
};

/**
 * Optional typography: "--" and "---" typed for a dash. "---" is an em dash;
 * "--" is an en dash between numbers ("10--20") and otherwise either dash,
 * English preferring the em dash and the other languages the spaced en dash.
 * Line-leading runs (rules, list markers, SQL comments, signatures), command
 * options ("--force") and HTML comments are not dashes.
 */
const typedDashes: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  const english = ctx.lang.startsWith("en");
  for (const match of ownedMatches(ctx, /(?<![-<!])-{2,3}(?![->])/gu)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = ctx.text[start - 1] ?? "";
    const after = ctx.text[end] ?? "";
    const lineStart = ctx.text.lastIndexOf("\n", start - 1) + 1;
    if (ctx.text.slice(lineStart, start).trim() === "") continue;
    if (/\s/.test(before) && /[\p{L}\p{N}]/u.test(after)) continue;
    const alternatives =
      match[0].length === 3
        ? ["—"]
        : /\p{N}/u.test(before) && /\p{N}/u.test(after)
          ? ["–"]
          : english
            ? ["—", "–"]
            : ["–", "—"];
    findings.push({
      ruleId: "emdashShortcut",
      messageKey: "review_msg_typed_dash",
      range: { start, end },
      alternatives,
      context: { start: Math.max(0, start - 1), end: Math.min(ctx.text.length, end + 1) },
    });
  }
  return findings;
};

/**
 * English writes "$", "£" and "¥" before the amount and "¢" after it: "25$"
 * is "$25". Other languages place symbols by their own conventions ("25 $" in
 * French Canada, "R$ 25"), so this is English only. A line with "$" before a
 * name is math or a shell ("$x = 5$", "$HOME"), and is left alone.
 */
function currencyPlacement(ctx: DetectContext): RawFinding[] {
  if (ctx.lang !== "en_US") return [];
  const findings: RawFinding[] = [];
  const regex =
    /(?<![\p{L}\p{N}$£¥¢.,_])(?:(\d[\d,]*(?:\.\d+)?)[  ]*([$£¥])|¢(\d+))(?![\p{L}\p{N}$£¥¢_])/gu;
  for (const match of ownedMatches(ctx, regex)) {
    const start = match.index;
    const end = start + match[0].length;
    const lineStart = ctx.text.lastIndexOf("\n", start) + 1;
    let lineEnd = ctx.text.indexOf("\n", end);
    if (lineEnd < 0) lineEnd = ctx.text.length;
    if (match[2] === "$" && /\$[\p{L}\\{(_]/u.test(ctx.text.slice(lineStart, lineEnd))) continue;
    findings.push({
      ruleId: "currencySpacing",
      messageKey: "review_msg_currency_placement",
      range: { start, end },
      alternatives: [match[3] ? `${match[3]}¢` : `${match[2]}${match[1]}`],
      context: { start: lineStart, end: lineEnd },
      bulkBlock: "context-dependent",
    });
  }
  return findings;
}

/** "300°K" is "300 K": the kelvin is an absolute unit and takes no degree sign. */
function kelvinDegree(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const separator = resolveMeasurementLocale(ctx.lang)?.separator ?? " ";
  for (const match of ownedMatches(ctx, /(?<=[\p{N}\s(])°K(?![\p{L}\p{N}_])/gu)) {
    const start = match.index;
    const glued = /\p{N}/u.test(ctx.text[start - 1]);
    findings.push({
      ruleId: "measurementUnitFormatting",
      messageKey: "review_msg_kelvin_degree",
      range: { start, end: start + 2 },
      alternatives: [glued ? `${separator}K` : "K"],
      context: { start: Math.max(0, start - 1), end: start + 2 },
    });
  }
  return findings;
}

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
    let prosePrefix = prefix.slice(0, parsed.start);
    // A prose list retains the evidence before its first measurement. Every
    // preceding item must itself parse; identifiers and arithmetic still abstain.
    while (!isProsePrefix(prosePrefix)) {
      const item = /(?:^|[ \t])([^\s]+),[ \t]+$/.exec(prosePrefix);
      if (!item || parseMeasurementExpression(item[1], locale)?.start !== 0) break;
      prosePrefix = prosePrefix.slice(
        0,
        item.index + (item[0].startsWith(" ") || item[0].startsWith("\t") ? 1 : 0),
      );
    }
    if (!isProsePrefix(prosePrefix)) continue;
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
      context: { start: windowStart, end: tokenEnd },
    });
  }
  return findings;
}

// ponytail: small closed-class allowlists (articles, prepositions,
// conjunctions, demonstratives, a few auxiliaries); expand only with ambiguity
// fixtures. Open-class words stay out: without a part of speech "record record
// profits" or "very very" cannot be told from a slip. Words that legitimately
// double are left out: en "that that"/"had had"/"can can"/"her her", de "die
// die"/"das das" (relative + article) and "und und und", fr "nous nous"/"vous
// vous" (reflexive), es "es es" and pt "é é" ("lo que es es"), es/pt "para para"
// (verb + preposition), sv "om om"/"för för"/"var var", hr "je je" (verb +
// clitic), el "με με" (pronoun + preposition), "και και" (both … and) and
// "είναι είναι", ar "من من".
const REPEATABLE_WORDS: Record<string, string> = {
  en: "the|an|a|is|are|was|were|in|on|at|for|with|from|of|to|and|or|but|nor|as|by|into|onto|about|than|this|these|those|its|your|our|their|would|should|could|has|been",
  de: "ein|eine|einen|einem|einer|eines|im|mit|von|für|auf|bei|aus|nach|zum|zur|dass|weil|ist|sind|hat|wird|über|unter|durch|ohne|gegen",
  fr: "le|les|un|une|des|du|au|aux|dans|pour|avec|sur|et|mais|est|sont|par|ce|cette|ces|sans",
  es: "el|los|las|un|una|en|con|del|al|y|pero|por|sin|sobre|entre|desde|hasta|este|esta|estos|estas",
  pt: "os|um|uma|em|com|do|da|dos|das|no|na|e|mas|por|pelo|pela|sem|sobre|entre|este|esta|isto|isso",
  pl: "się|na|do|od|dla|przez|że|i|oraz|ale|lub|w|z|o|po|jest|są",
  sv: "att|ett|på|till|med|av|och|men|eller|är|vid|från|under|över|utan",
  hr: "na|za|od|iz|do|i|ali|ili|u|s|sa|o|po|pri|kod|prema",
  el: "στο|στη|στην|στον|στα|από|για|ένα|μια|αλλά|στις|στους|προς|χωρίς",
  ar: "في|على|إلى|عن|مع|هذا|هذه|ثم",
};
const REPEATED_WORD_REGEX = new Map(
  Object.entries(REPEATABLE_WORDS).map(([lang, words]) => [
    lang,
    new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}_'’–—-])(${words})[ \\t\\u00a0]{1,8}\\1(?![\\p{L}\\p{M}\\p{N}_'’–—-])`,
      "giu",
    ),
  ]),
);

// Verbs whose "to" opens an infinitive: "We need to to leave" doubles the marker.
const INFINITIVE_TO_VERBS = new Set([
  ...["need", "needs", "needed", "have", "has", "had", "want", "wants", "wanted", "going"],
  ...["got", "ought", "able", "used", "try", "tries", "tried", "trying", "plan", "plans"],
  ...["planned", "hope", "hopes", "hoped", "decide", "decided"],
]);
// Words that leave a gap for an elided infinitive: "whatever you need to to finish".
const INFINITIVE_GAP = /\b(?:what|whatever|which|who|whom|that|as|where|when|how)\b/i;

/**
 * "to to" is also a stranded preposition before an infinitive ("the team I
 * wrote to to complain") or an elided one ("do what you have to to win").
 * Repair it only before a determiner, number or name ("sent to to the team"),
 * or after an infinitive verb with no gap before it ("I have to to go").
 */
function doubledTo(before: string, after: string): boolean {
  if (/^[ \t ]*(?:(?:the|a|an|my|your|his|her|its|our|their)\b|\p{Lu}|\p{N})/u.test(after)) {
    return true;
  }
  const sentence = before.slice(
    Math.max(...[".", "!", "?", "\n"].map((c) => before.lastIndexOf(c))) + 1,
  );
  const verb = /(\p{L}+)[ \t ]+$/u.exec(sentence);
  return (
    !!verb &&
    INFINITIVE_TO_VERBS.has(verb[1].toLowerCase()) &&
    !INFINITIVE_GAP.test(sentence.slice(0, verb.index))
  );
}

const repeatedWords: Detector = (ctx) => {
  const findings: RawFinding[] = [];
  const regex = REPEATED_WORD_REGEX.get(ctx.lang.slice(0, 2));
  if (!regex) return findings;
  for (const match of ownedMatches(ctx, regex)) {
    const start = match.index;
    const end = start + match[0].length;
    const context = {
      start: Math.max(0, start - PHRASE_WINDOW),
      end: Math.min(ctx.text.length, end + 2),
    };
    const before = ctx.text.slice(context.start, start);
    const word = match[1].toLowerCase();
    if (ctx.dictionary.has(word) || isGluedToTechnical(ctx.text, start, end)) continue;
    // A run gets one repair, including when a later pair belongs to another chunk.
    if (before.match(/(\p{L}+)[ \t\u00a0]{1,8}$/u)?.[1].toLowerCase() === word) continue;
    // A named, quoted example is evidence, not prose to repair. Normal quotations still run.
    if (CUE_AND_QUOTE.test(before)) continue;
    if (word === "to" && !doubledTo(before, ctx.text.slice(end, end + 16))) continue;
    findings.push({
      ruleId: "englishRepeatedWords",
      messageKey: "review_msg_repeated_words",
      range: { start, end },
      alternatives: [ctx.source.slice(start, start + match[1].length)],
      context,
    });
  }
  return findings;
};

/** Review detectors by rule. Rules absent here are excluded from review (see reviewCatalog). */
export const REVIEW_DETECTORS: ReadonlyArray<ReviewDetectorEntry> = [
  {
    rules: ["styleRedundancy", "styleLongSentence"],
    detect: (ctx) =>
      (ctx.styleFindings ?? []).filter((f) => f.range.start >= ctx.from && f.range.start < ctx.to),
  },
  {
    rules: ["preferredTerminology"],
    detect: (ctx) =>
      (ctx.terminologyFindings ?? []).filter(
        (f) => f.range.start >= ctx.from && f.range.start < ctx.to,
      ),
  },
  {
    rules: [
      "englishCanonicalCasing",
      "englishPhraseCorrections",
      "englishClosedCompounds",
      "stylePhrasing",
    ],
    detect: (ctx) => [...canonicalCasing(ctx), ...phraseCorrections(ctx)],
  },
  {
    rules: ["unclosedQuotation"],
    detect: (ctx) =>
      (ctx.quotationFindings ?? []).filter(
        (d) => d.range.start >= ctx.from && d.range.start < ctx.to,
      ),
  },

  {
    rules: ["englishItsContext", "englishLetsContext", "englishElsePossessive"],
    detect: contextualPossessives,
  },
  { rules: ["englishFixedPrepositions"], detect: fixedPrepositions },
  { rules: ["englishVerbComplements"], detect: verbComplements },
  { rules: ["englishPerfectParticiples"], detect: perfectParticiples },
  { rules: ["englishNounNumber"], detect: nounNumberConstructions },
  { rules: ["englishUsagePhrases"], detect: usagePhrases },
  {
    rules: ["englishDoubledDegree"],
    detect: (ctx) => (ctx.lang === "en_US" ? doubledDegree(ctx) : doubledDegreeByLanguage(ctx)),
  },
  { rules: ["englishCountability"], detect: countability },
  { rules: ["englishContextualCompounds"], detect: contextualCompounds },
  { rules: ["englishRepeatedWords"], detect: repeatedWords },
  { rules: ["englishAuxiliaryBaseVerb"], detect: auxiliaryForms },
  { rules: ["englishPronounCase"], detect: pronounCase },
  { rules: ["englishSentenceStructure"], detect: sentenceStructure },
  {
    rules: [
      "englishThenThan",
      "englishYourYouAre",
      "englishTheirThereTheyAre",
      "englishToToo",
      "englishWereWhere",
    ],
    detect: wordConfusions,
  },
  { rules: ["capitalizeSentenceStart", "capitalizeAfterLineBreak"], detect: capitalizeStarts },
  { rules: ["englishPronounICapitalization"], detect: pronounI },
  {
    rules: [
      "englishTypoWhitelistCorrection",
      "englishContractionNormalization",
      "englishAlotCorrection",
    ],
    // English word lists; other languages have their own tables.
    detect: (ctx) => [
      ...(ctx.lang === "en_US" ? wordSpelling(ctx) : [...splitWords(ctx), ...frenchElisions(ctx)]),
      ...markedApostrophes(ctx),
    ],
  },
  { rules: ["englishModalOfCorrection"], detect: modalOf },
  { rules: ["englishYourWelcomeCorrection"], detect: yourWelcome },
  { rules: ["englishTheirThereBeVerb"], detect: theirThere },
  { rules: ["englishPronounVerbWhitelistAgreement"], detect: pronounVerb },
  { rules: ["englishSubjectVerbAgreement"], detect: subjectAgreement },
  { rules: ["englishExistentialAgreement"], detect: existentialAgreement },
  { rules: ["englishArticleAnCorrection"], detect: articleAn },
  { rules: ["englishOrdinalSuffix"], detect: ordinal },
  {
    rules: ["englishProperNounCapitalization"],
    detect: (ctx) => (ctx.lang === "en_US" ? properNoun(ctx) : germanNounCapitals(ctx)),
  },
  { rules: ["commaPeriodSpacing"], detect: commaPeriodSpacing },
  { rules: ["collapseRepeatedSpaces"], detect: repeatedSpaces },
  { rules: ["duplicatePunctuationCollapse"], detect: duplicatePunctuation },
  { rules: ["ellipsisShortcut"], detect: ellipsisCharacter },
  { rules: ["quoteSpacing"], detect: quoteSpacing },
  { rules: ["primeSymbols"], detect: primeSymbols },
  { rules: ["emdashShortcut"], detect: typedDashes },
  {
    rules: ["measurementUnitFormatting"],
    detect: (ctx) => [...measurementLike(ctx, "measurementUnitFormatting"), ...kelvinDegree(ctx)],
  },
  {
    rules: ["currencySpacing"],
    detect: (ctx) => [...measurementLike(ctx, "currencySpacing"), ...currencyPlacement(ctx)],
  },
  ...EXTENSION_DETECTORS,
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
  // Case-only ASCII changes must not replace unchanged letters across formatting nodes.
  if (
    /^[A-Za-z]+$/.test(original + replacement) &&
    original.toLowerCase() === replacement.toLowerCase()
  ) {
    return [...original].flatMap((letter, index) =>
      letter === replacement[index]
        ? []
        : [
            {
              start: start + index,
              end: start + index + 1,
              original: letter,
              replacement: replacement[index],
            },
          ],
    );
  }
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
