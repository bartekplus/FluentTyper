import { CUE_AND_QUOTE } from "./exampleCues";
import { canonicalCasing } from "./canonicalCasing";
import { phraseCorrections } from "./englishPhraseCorrections";
import { doubledDegree } from "./englishDegree";
import {
  doubledDegreeByLanguage,
  frenchElisions,
  germanNounCapitals,
  markedApostrophes,
  quotedContraction,
  splitWords,
} from "./multilingualLexicon";
import { countability } from "./englishCountability";
import { nounNumberConstructions } from "./englishNounNumber";
import { FIXERS as PARTICIPLE_FIXERS } from "./englishParticiples";
import { FIXERS as COMPLEMENT_FIXERS } from "./englishComplements";
import { contextualPossessives } from "./englishPossessives";
import {
  additionalPronounAgreement,
  existentialAgreement,
  subjectAgreement,
} from "./englishAgreement";
import { wordConfusions } from "./englishWordConfusions";
import { FILTERS as AUXILIARY_FILTERS, FIXERS as AUXILIARY_FIXERS } from "./englishAuxiliaryForms";
import { pronounCase } from "./englishPronounCase";
import { FIXERS as STRUCTURE_FIXERS } from "./englishSentenceStructure";
import type { CatalogRuleId } from "../ruleCatalog";
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
  isVariableI,
} from "../implementations/EnglishPronounVerbWhitelistAgreementRule";
import { lastNonBlankBefore, opensClause } from "../implementations/helpers/EnglishRuleShared";
import {
  ARTICLE_REGEX,
  SENTENCE_START_REGEX,
  correctArticle,
  isArticleContext,
} from "../implementations/EnglishArticleAnCorrectionRule";
import { ordinalSuffix } from "../implementations/EnglishOrdinalSuffixRule";
import { englishWordInfo } from "../implementations/helpers/EnglishLexicon";
import {
  couldEndProperName,
  findProperName,
  isMonthInContext,
  properNameReplacement,
} from "../implementations/EnglishProperNounCapitalizationRule";
import { CURRENCY_MARKERS } from "../implementations/CurrencySpacingRule";
import { isProsePrefix } from "../implementations/MeasurementUnitFormattingRule";
import {
  isLowercaseLetter,
  isTechnicalToken,
  lastNonSpaceBefore,
} from "../implementations/helpers/GenericRuleShared";
import { ownedMatches } from "./phraseTemplates";
import { graphemeEnd, overlapsSortedRanges } from "./textRanges";
import { MASK_CHAR, type ReviewMessageKey, type TextRange } from "./types";
import { TYPOGRAPHIC_QUOTES } from "./typographicQuotes";
import { germanUnits } from "./german/numbers";
import {
  FILTERS as ENGLISH_FILTERS,
  FIXERS as ENGLISH_FIXERS,
  PREDICATES as ENGLISH,
} from "./english/ruleDetectors";
import { FILTERS as USAGE_FILTERS } from "./englishUsagePhrases";
import { FILTERS as COMPOUND_FILTERS } from "./englishCompounds";
import {
  FILTERS as GERMAN_FILTERS,
  FIXERS as GERMAN_FIXERS,
  PREDICATES as GERMAN,
} from "./german/ruleDetectors";
import {
  FILTERS as GREEK_FILTERS,
  FIXERS as GREEK_FIXERS,
  PREDICATES as GREEK,
} from "./greek/ruleDetectors";
import {
  FILTERS as SWEDISH_FILTERS,
  FIXERS as SWEDISH_FIXERS,
  PREDICATES as SWEDISH,
} from "./swedish/ruleDetectors";
import {
  FILTERS as ARABIC_FILTERS,
  FIXERS as ARABIC_FIXERS,
  PREDICATES as ARABIC,
} from "./arabic/ruleDetectors";
import {
  FILTERS as PORTUGUESE_FILTERS,
  FIXERS as PORTUGUESE_FIXERS,
  PREDICATES as PORTUGUESE,
} from "./portuguese/ruleDetectors";
import {
  FILTERS as POLISH_FILTERS,
  FIXERS as POLISH_FIXERS,
  PREDICATES as POLISH,
} from "./polish/ruleDetectors";
import {
  FILTERS as SPANISH_FILTERS,
  FIXERS as SPANISH_FIXERS,
  PREDICATES as SPANISH,
} from "./spanish/ruleDetectors";
import {
  FILTERS as FRENCH_FILTERS,
  FIXERS as FRENCH_FIXERS,
  PREDICATES as FRENCH,
} from "./french/ruleDetectors";
import { dateTense } from "./dateTense";

import { detectAll, PSEUDO_CLEFT_BEFORE, isLang } from "./phraseTemplates";
import { finding } from "./finding";
import {
  buildReviewDetectors,
  mergePredicates,
  type FindingsFilter,
  type Fixer,
  type MatchFixer,
} from "../engine/reviewRules";

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
export type ReviewDetectorEntry = {
  rules: CatalogRuleId[];
  detect: Detector;
  /** The rule file that declares the entry ("common", "en", "de", ...). */
  source?: string;
  /**
   * The language (two-letter code) of the text the entry checks. Review runs the entry only
   * for that language, also when other languages run its rules. No value: every language.
   */
  lang?: string;
};

// Enough context for every phrase pattern; the patterns themselves are shorter.
const PHRASE_WINDOW = 96;
const WORD_CHAR = /[\p{L}\p{N}_'’]/u;
// Characters that glue a word into a mention, path, file or dotted name.
const TECHNICAL_GLUE = /[@#/\\_=$]/;

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

// Per chunk: the match fixers of a rule share their finders, as one detector call did.
const FINDERS = new WeakMap<DetectContext, Map<string, (position: number) => number>>();

/** The lastIndexFinder of `needle` in the text of `ctx`, made once per chunk. */
function finderOf(ctx: DetectContext, needle: string): (position: number) => number {
  let finders = FINDERS.get(ctx);
  if (!finders) FINDERS.set(ctx, (finders = new Map<string, (position: number) => number>()));
  let finder = finders.get(needle);
  if (!finder) finders.set(needle, (finder = lastIndexFinder(ctx.text, needle)));
  return finder;
}

const ALIGNED = new WeakMap<DetectContext, Map<number, boolean>>();

/** The aligned lines of the chunk (repeatedSpaces), by line start: each line is read once. */
function alignedLines(ctx: DetectContext): Map<number, boolean> {
  let aligned = ALIGNED.get(ctx);
  if (!aligned) ALIGNED.set(ctx, (aligned = new Map<number, boolean>()));
  return aligned;
}

function owned(ctx: DetectContext, start: number): boolean {
  return start >= ctx.from && start < ctx.to;
}

const ownedFindings = (ctx: DetectContext, list: readonly RawFinding[] | undefined) =>
  (list ?? []).filter((f) => owned(ctx, f.range.start));

// Words after which a lowercase "i" names something ("the variable i"): an identifier.
const IDENTIFIER_WORDS = "each|every|the|a|index|variable|counter|iterator|loop";
const IDENTIFIER_BEFORE = new RegExp(`\\b(?:${IDENTIFIER_WORDS})\\s+$`, "i");
// A preposition, an operator word or a symbol before "i" makes it a variable: "from 1 to
// i", "the square of i", "base + i", "let i be". The pronoun is never the object here.
const FORMULA_BEFORE =
  /(?:\b(?:of|by|to|from|let|plus|minus|equals|for all)|[+×*=<>÷^−]|(?:^|[^\p{L}])\p{L},[ \t\u00A0]+(?:and|or))[ \t\u00A0]+$/iu;
const PRONOUN_VERB_AFTER =
  /^[ \t\u00a0]+(?:can|could|will|would|shall|should|may|might|must|am|was|have|had|do|did|don['’]t|didn['’]t|can['’]t|think|know|want|need|guess|hope|feel|mean|said|got|went|love|like)(?![\p{L}])/iu;
// After "i": "i times R", "i squared", "i and j", or a list "i x, ii y".
const FORMULA_AFTER =
  /^[ \t\u00A0]+(?:times|squared|and[ \t\u00A0]+[jkn])(?![\p{L}\p{N}])|^[ \t\u00A0]+\p{L}+,[ \t\u00A0]+ii(?![\p{L}\p{N}])/iu;
// Words naming a numbered part: "Part i.", "Appendix i." is the roman numeral.
const NUMERAL_BEFORE =
  /\b(?:part|chapter|section|appendix|volume|vol|book|act|phase|step|stage|level|type|class|article|annex|item|figure|fig|table|option|case|grade|war|page|no)\s+$/i;
// German "im" (in dem) inside English text: "Heil dir im Siegerkranz", "lebt im Schloss".
// Before a capitalized noun, after a German word or before German noun spelling.
const GERMAN_BEFORE_IM =
  /(?:^|[^\p{L}])(?:dir|mir|dich|mich|sich|uns|euch|ihm|ist|sind|waren|wir|ich|und|oder|nur|auch|noch|schon|sie|er|liegt|steht|lebt|wohnt|bin|bist|haben|wird|werden|nicht|dann|hier|heute|jetzt|gestern|alles|das|der)[ \t\u00a0]+$/iu;
const GERMAN_NOUN = /^[ \t\u00a0]+(\p{Lu}\p{Ll}+)/u;
function germanIm(word: string, before: string, after: string): boolean {
  if (word !== "im") return false;
  const noun = GERMAN_NOUN.exec(after)?.[1];
  if (!noun) return false;
  return (
    GERMAN_BEFORE_IM.test(before) ||
    /[äöüß]|sch|(?:ung|heit|keit|schaft|chen|lein|tum|nis|ismus)$/iu.test(noun)
  );
}

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

// ---------------------------------------------------------------- capitalization

/** The lowercase letter that opens the token `match` (capitalize frames), or null. */
function lowercaseStart(ctx: DetectContext, match: RegExpExecArray) {
  const wordStart = match.index;
  // A token must start after whitespace or at the text start.
  if (wordStart > 0 && !/\s/.test(ctx.text[wordStart - 1])) return null;
  const word = match[0];
  const letterIndex = wordStart + (SENTENCE_OPENING_MARKS.has(word[0]) ? 1 : 0);
  if (!isLowercaseLetter(ctx.text[letterIndex] ?? "")) return null;
  const letterEnd = graphemeEnd(ctx.text, letterIndex);
  const letter = ctx.source.slice(letterIndex, letterEnd);
  const bare = word.replace(TRAILING_PUNCTUATION_REGEX, "");
  if (isTechnicalToken(bare) || keepsOwnCasing(bare)) return null;
  // "a = 2 · x² + 5": a variable before a relation or operator.
  if (bare.length === 1 && /^[ \t]*[=<>≤≥≠+−·×÷]/u.test(ctx.text.slice(wordStart + 1))) return null;
  const upper = letter.toUpperCase();
  if (upper === letter) return null;
  const range = { start: letterIndex, end: letterEnd };
  return { wordStart, range, upper, wordEnd: wordStart + bare.length };
}

/** A lowercase word that starts a sentence. */
const capitalizeSentenceStart: MatchFixer = (match, ctx) => {
  const word = lowercaseStart(ctx, match);
  if (!word || !startsSentence(ctx.text, word.wordStart, ctx.lang)) return null;
  const { wordStart, range, upper, wordEnd } = word;
  const end = sentenceEndBefore(ctx.text, wordStart);
  const mark = ctx.text[end.mark];
  if (overlapsSortedRanges(ctx.exampleRanges ?? [], { start: end.mark, end: end.mark + 1 }))
    return null;
  // "“Stop!” she shouted", "(really?) and": a quoted or bracketed "!" or
  // "?" before a lowercase word ends the quotation, not the sentence.
  if (end.closed && mark !== ".") return null;
  // "press . to repeat", "type ? for help": a named mark is a symbol, not
  // a sentence end. French spaces "?" and "!" on purpose.
  if (
    end.mark >= 0 &&
    namesMark(ctx.text, end.mark) &&
    !(mark !== "." && usesFrenchPunctuationSpacing(ctx.lang))
  ) {
    return null;
  }
  // The mark AND the word it closes decide it: "etc." or, when the mark
  // stands alone, the word before it ("approx .", "etc .").
  const previous = previousTokensStart(ctx.text, wordStart, 1);
  const evidence = /[\p{L}\p{N}]/u.test(ctx.text.slice(previous, wordStart))
    ? previous
    : previousTokensStart(ctx.text, wordStart, 2);
  return {
    ruleId: "capitalizeSentenceStart",
    messageKey: "review_msg_sentence_start",
    range,
    alternatives: [upper],
    context: { start: evidence, end: wordEnd },
    // 'He said "stop." she left': the quotation may end inside the sentence.
    bulkBlock: end.closed ? "context-dependent" : undefined,
  };
};

/** A lowercase word that starts a line after a closed sentence or paragraph. */
const capitalizeAfterLineBreak: MatchFixer = (match, ctx) => {
  const word = lowercaseStart(ctx, match);
  if (!word || startsSentence(ctx.text, word.wordStart, ctx.lang)) return null;
  const lineBreak = lineBreakBefore(ctx.text, word.wordStart);
  if (lineBreak === null || !previousLineEndsParagraphOrSentence(ctx.text, lineBreak, ctx.lang))
    return null;
  return {
    ruleId: "capitalizeAfterLineBreak",
    messageKey: "review_msg_line_start",
    range: word.range,
    alternatives: [word.upper],
    context: { start: lineBreak, end: word.wordEnd },
  };
};

/**
 * The sentence mark `startsSentence` read before `wordStart` (its index), and
 * whether closing quotes or brackets sit between it and the word ("Stop!” she").
 */
function sentenceEndBefore(text: string, wordStart: number): { mark: number; closed: boolean } {
  let i = lastNonSpaceBefore(text, wordStart);
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
  // The same keys and symbols named in the other Review languages: "pulsa ? para ver la ayuda".
  ...["pulsa", "pulse", "presiona", "presione", "escribe", "escriba", "teclea", "teclee", "usa"],
  ...["tecla", "signo", "símbolo", "carácter", "inserta", "inserte", "añade", "añada"],
  ...["appuyez", "appuie", "tapez", "tape", "saisissez", "saisis", "utilisez", "touche"],
  ...["caractère", "symbole", "signe", "insérez", "ajoutez", "drücke", "drücken", "drück"],
  ...["tippe", "tippen", "gib", "verwende", "verwenden", "taste", "zeichen", "füge"],
  ...["pressione", "aperte", "digite", "tecle", "caractere", "sinal", "insira", "adicione"],
  ...["naciśnij", "wciśnij", "wpisz", "użyj", "klawisz", "znak", "wstaw", "dodaj", "tryck"],
  ...["skriv", "använd", "tangenten", "tecknet", "tecken", "symbolen", "pritisni", "pritisnite"],
  ...["upiši", "upišite", "koristi", "koristite", "tipku", "simbol", "πατήστε", "πάτα"],
  ...["πληκτρολογήστε", "γράψτε", "πλήκτρο", "σύμβολο", "χαρακτήρα", "اضغط", "اكتب", "رمز"],
]);
const MARK_QUOTES = /^["'“”‘’`«»„‚‹›]$/u;
const LINE_SPACE = /^[ \t ]$/u;

/**
 * True when the mark at `index` is named, not ending a sentence: it stands
 * alone after a word that names keys or symbols ("press . to repeat", "Type ?
 * for help"), or it is wrapped in quotes or backticks ("type '.' to repeat").
 */
function namesMark(text: string, index: number): boolean {
  const before = lastNonBlankBefore(text, index);
  let after = index + 1;
  while (after < text.length && LINE_SPACE.test(text[after])) after += 1;
  if (MARK_QUOTES.test(text[before] ?? "") && MARK_QUOTES.test(text[after] ?? "")) return true;
  // "It was late . we left" is a stray space: only a naming word makes it a symbol.
  if (before === index - 1) return false;
  let wordStart = before + 1;
  while (wordStart > 0 && /\p{L}/u.test(text[wordStart - 1])) wordStart -= 1;
  if (WORD_CHAR.test(text[wordStart - 1] ?? "")) return false;
  return MARK_NAMING_WORDS.has(text.slice(wordStart, before + 1).toLowerCase());
}

/** Index of the newline that starts the line `wordStart` is the first word of, or null. */
function lineBreakBefore(text: string, wordStart: number): number | null {
  const i = lastNonSpaceBefore(text, wordStart);
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

const pronounI: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  const start = match.index;
  const before = ctx.text[start - 1] ?? "";
  if (/[@#/\\.=$\-[]/.test(before) || before === MASK_CHAR) return null;
  if (IDENTIFIER_BEFORE.test(ctx.text.slice(Math.max(0, start - 24), start))) return null;
  const rest = ctx.text.slice(start + 1, start + 1 + 40);
  // "If we need to i can meet": a modal or verb after it makes it the subject again.
  if (
    FORMULA_BEFORE.test(ctx.text.slice(Math.max(0, start - 24), start)) &&
    !PRONOUN_VERB_AFTER.test(rest)
  )
    return null;
  if (FORMULA_AFTER.test(rest)) return null;
  // The letter itself: "the short i sound" ("i sound tired" is the pronoun).
  if (/\b(?:short|long)[ \t\u00A0]+$/i.test(ctx.text.slice(Math.max(0, start - 8), start)))
    if (/^[ \t\u00A0]+sounds?\b/i.test(rest)) return null;
  let contextEnd = start + 1;
  let sentenceEnd = false;
  if (/^['’](?:m|ve|ll|d)(?![\p{L}\p{N}])/u.test(rest)) {
    contextEnd += rest.match(/^['’]\w+/)![0].length;
  } else if (before === "(" && !/^[ \t ]/.test(rest)) {
    // "(i think)" is the pronoun; "(i)", "(i, ii)" and "f(i)" are not.
    return null;
  } else if (/^[,;!?]/.test(rest)) {
    contextEnd += 1;
  } else if (/^\.(?:\s|$)/u.test(rest)) {
    // Unlike typing, what follows the period is here: not "i.e.", so "than i." ends
    // a sentence. A roman numeral opening a list line or naming a part is not, nor is
    // a spaced-out "i. e.".
    if (/^\.\s+e\./i.test(rest)) return null;
    const lineStart = ctx.text.lastIndexOf("\n", start - 1) + 1;
    if (ctx.text.slice(lineStart, start).trim() === "") return null;
    if (NUMERAL_BEFORE.test(ctx.text.slice(Math.max(0, start - 24), start))) return null;
    contextEnd += 1;
    sentenceEnd = true;
  } else {
    // Whitespace alone does not say pronoun or variable; the next word does.
    const next = rest.match(/^[ \t\u00A0]+(\S+)/);
    if (!next) {
      // "stronger than i" closing the text is the pronoun.
      if (
        !/^\s*$/.test(rest) ||
        !/\b(?:than|and|as)[ \t\u00A0]+$/i.test(ctx.text.slice(Math.max(0, start - 12), start))
      )
        return null;
      sentenceEnd = true;
    } else {
      const following = next[1].replace(TRAILING_PUNCTUATION_REGEX, "");
      // Unlike typing, the next word is complete here: "i don't" is the pronoun too.
      if (
        !/^\p{L}+(?:['’]\p{L}+)?$/u.test(following) ||
        NON_PRONOUN_FOLLOWERS.has(following.toLowerCase())
      ) {
        return null;
      }
      contextEnd += next[0].length;
    }
  }
  findings.push(
    finding("englishPronounICapitalization", "review_msg_pronoun_i", start, start + 1, ["I"], {
      // The word before decided it as well as the one after.
      context: { start: previousTokensStart(ctx.text, start, 1), end: contextEnd },
      // "increment i." can still be a variable: one at a time.
      bulkBlock: sentenceEnd ? "context-dependent" : undefined,
    }),
  );
  return findings;
};

// -------------------------------------------------------------------- spelling

/** The spelling finding of one ASCII word (spelling frames): at most one. */
function spellingFindings(match: RegExpExecArray, ctx: DetectContext): RawFinding[] {
  // These word lists are English.
  if (ctx.lang !== "en_US") return [];
  const start = match.index;
  const end = start + match[0].length;
  // Letters glued to other word characters are part of a longer token ("teh2").
  if (WORD_CHAR.test(ctx.text[start - 1] ?? "") || WORD_CHAR.test(ctx.text[end] ?? "")) return [];
  const findings: RawFinding[] = [];
  if (isGluedToTechnical(ctx.text, start, end)) return findings;
  // "--dont-ask", "dont-care", "alot-lib": a hyphen after the word makes it
  // part of a longer name, and typing never reaches a word boundary there.
  // A double hyphen is a dash ("I dont--really--care"): like a space.
  if (ctx.text[end] === "-" && ctx.text[end + 1] !== "-") return findings;
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
    return findings;
  }
  const before = ctx.text.slice(Math.max(0, start - PHRASE_WINDOW), start);
  // "IM" is an acronym, except before a predicate: "IM not sure", "IM curious".
  const shoutedIm =
    word === "IM" &&
    ctx.text.slice(start, end + 24) !== ctx.text.slice(start, end + 24).toUpperCase() &&
    /(?:^|[.!?:;"“\n]|\b(?:and|but|although|because|that|if|think))[ \t]*$/i.test(before) &&
    /^[ \t]+(?:not|very|really|sure|glad|sorry|happy|curious|trying|afraid|interested|tired|busy|ready|late|looking|thinking|still|just)\b/.test(
      ctx.text.slice(end, end + 24),
    );
  const contraction = ctx.dictionary.has(word.toLowerCase())
    ? null
    : shoutedIm
      ? "I'm"
      : normalizeContractionToken(word, before);
  // "the im tag", "an ive file": after a determiner it is a word, not "I'm".
  const pronounForm = /^i(?:m|ve)$/i.test(word);
  // "by Ive Mažuran": mid-sentence, a capitalized "Ive"/"Im" before a capitalized word is a name.
  const name =
    pronounForm &&
    /^I[a-z]/.test(word) &&
    !/(?:^|[.!?:;"“\n])[ \t]*$/.test(before) &&
    /^[ \t]+\p{Lu}\p{Ll}/u.test(ctx.text.slice(end, end + 4));
  if (
    contraction &&
    !name &&
    !(pronounForm && DETERMINER_BEFORE.test(before)) &&
    !germanIm(word, before, ctx.text.slice(end, end + 40))
  ) {
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
    return findings;
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
    return findings;
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
  return findings;
}

/** The spelling frames: one per check, so each check can run alone. */
const spellingOf =
  (ruleId: CatalogRuleId): MatchFixer =>
  (match, ctx) =>
    spellingFindings(match, ctx).filter((f) => f.ruleId === ruleId);

// --------------------------------------------------------------------- grammar

interface PhraseMatch {
  match: RegExpExecArray;
  start: number;
  end: number;
}

// JavaScript's \s by code unit: phrase windows test it once per character they widen over.
function isWhitespaceAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(text[index]));
}

// Stateless (no g or y flag) copies of the typing rules' patterns, compiled once each.
const PHRASE_REGEX = new WeakMap<RegExp, RegExp>();

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
  let regex = PHRASE_REGEX.get(pattern);
  if (!regex)
    PHRASE_REGEX.set(
      pattern,
      (regex = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}d`)),
    );
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
        start: Math.max(0, lastNonBlankBefore(ctx.text, start)),
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
    findings.push(
      finding("englishTheirThereBeVerb", "review_msg_their_there", start, end, [
        `${there}${gap}${verb}`,
      ]),
    );
  }
  return findings;
};

// A preposition or an -ing verb before "it": "it" is an object ("Behind it are …").
const OBJECT_IT_BEFORE =
  /(?:\b(?:behind|beside|besides|below|beneath|under|underneath|above|over|around|within|inside|outside|against|among|beyond|near|with|without|on|in|at|from|to|for|of|by|about)|\b[a-z]{2,}ing)[ \t\u00a0]+$/i;
// "the day I called you was", "the time that we saw you was": a noun, a subject and a verb.
const OBJECT_GAP_YOU =
  /\b([a-z]+)[ \t\u00a0]+(?:that[ \t\u00a0]+)?(?:I|we|they|he|she)[ \t\u00a0]+(?:(?:did|had|have|first|last|never)[ \t\u00a0]+)?[a-z]+[ \t\u00a0]+$/;
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
      if (isVariableI(ctx.text, phraseRange.start)) continue;
    }
    const lookback = ctx.text.slice(Math.max(0, phraseRange.start - 48), phraseRange.start);
    // "Behind it are two towers", "Backing it are banks": "it" is the object of the word before.
    if (inputPronoun.toLowerCase() === "it" && OBJECT_IT_BEFORE.test(lookback)) continue;
    // "the set I is", "an I is", "phase I is": a capital letter that names a thing.
    if (
      inputPronoun === "I" &&
      /\b(?:a|an|the|set|ideal|matrix|phase|stage|type|part)[ \t\u00a0]+$/i.test(lookback)
    )
      continue;
    let bulkBlock: RawFinding["bulkBlock"];
    if (inputPronoun.toLowerCase() === "you") {
      // "Everything I told you was", "Seeing you was", "the gift for you was":
      // "you" is the object of the word before it, and "was" is right.
      if (isObjectYou(ctx.text, phraseRange.start)) continue;
      // "The day I called you was": "you" is the object inside a relative clause.
      if (OBJECT_GAP_YOU.test(lookback) && englishWordInfo(OBJECT_GAP_YOU.exec(lookback)![1])?.noun)
        continue;
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
    // "Sam and I is a band", "you as well as he are", "am I nuts": a coordinated or
    // compared pronoun, or an inverted question, is not this verb's whole subject. "and you
    // was right" still opens a clause.
    const before = ctx.text.slice(Math.max(0, phraseRange.start - 12), phraseRange.start);
    if (
      /\b(?:as|than|am|is|are|was|were)[ \t\u00a0]+$/i.test(before) ||
      (inputPronoun.toLowerCase() !== "you" && /(?:\b(?:and|or|nor)|&)[ \t\u00a0]+$/i.test(before))
    )
      continue;
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
    // "a an apple": a doubled article; the determiner clash drops one instead.
    if (/^(?:an?|the)$/i.test(word)) continue;
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

const ordinal: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  const start = match.index;
  const [token, digits, suffix] = match;
  const expected = ordinalSuffix(digits);
  const end = start + token.length;
  if (suffix === expected || isGluedToTechnical(ctx.text, start, end)) return findings;
  if (suffix !== suffix.toLowerCase()) {
    // "2ND" is "2nd" in a sentence; "42RD" (road) and all-caps headings are not.
    if (
      suffix.toLowerCase() !== expected ||
      isAllCapsContext(ctx.text, start, end) ||
      overlapsSortedRanges(ctx.quotationRanges ?? [], { start, end })
    )
      return findings;
    findings.push({
      ruleId: "englishOrdinalSuffix",
      messageKey: "review_msg_ordinal_case",
      context: { start: Math.max(0, start - 24), end: Math.min(ctx.text.length, end + 24) },
      range: { start, end },
      alternatives: [`${digits}${expected}`],
      bulkBlock: "context-dependent",
    });
    return findings;
  }
  // "rd" is also rod ("a 16rd chain").
  if (suffix === "rd") return findings;
  // "st" is also stone. Only a named month disambiguates this new coverage.
  if (
    suffix === "st" &&
    !/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)[ \t\u00a0]+$/i.test(
      ctx.text.slice(Math.max(0, start - 24), start),
    )
  )
    return findings;
  if (overlapsSortedRanges(ctx.quotationRanges ?? [], { start, end })) return findings;
  findings.push(
    finding("englishOrdinalSuffix", "review_msg_ordinal", start, end, [`${digits}${expected}`], {
      context: { start: Math.max(0, start - 24), end },
    }),
  );
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
    const replaced = properNameReplacement(typed, found.canonical, ctx.dictionary);
    if (replaced === null) continue;
    findings.push(
      finding("englishProperNounCapitalization", "review_msg_proper_noun", start, end, [replaced], {
        // may/march/august needed a date or a clause end next to them; that is evidence.
        context: found.contextual
          ? { start: Math.max(0, start - 16), end: wordEnd + 16 }
          : undefined,
        bulkBlock: found.contextual ? "context-dependent" : undefined,
      }),
    );
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
// Scripts without case (Arabic) have no capital to start a sentence with: any letter counts.
const STANDALONE_MARK_FOLLOWER = /^[ \t\u00A0]+["'“‘«„([¿¡]?[\p{Ll}\p{Lo}]/u;

const spaceBeforeComma: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
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
  return findings;
};

const spaceBeforeMark: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  const frenchSpacing = usesFrenchPunctuationSpacing(ctx.lang);
  const start = match.index;
  if (match[1] !== "." && frenchSpacing) return findings;
  if (/[;\u037E]/.test(match[1]) && !isGreekQuestionMark(match[1], ctx.lang)) return findings;
  const end = start + match[0].length;
  // "press . to repeat", "type ? for help": before a lowercase word, a
  // named mark is a symbol, not a sentence end.
  if (STANDALONE_MARK_FOLLOWER.test(ctx.text.slice(end, end + 8)) && namesMark(ctx.text, end - 1)) {
    return findings;
  }
  findings.push(
    finding("commaPeriodSpacing", "review_msg_space_before_mark", start, end, [match[1]], {
      context: { start: start - 1, end },
      bulkBlock: /[.?!]/.test(match[1]) ? undefined : "context-dependent",
    }),
  );
  return findings;
};

const spaceAfterOpeningMark: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
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
  return findings;
};

const wideComma: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
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
  return findings;
};

const spaceAfterPercent: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  const sign = match.index + match[0].length - 1;
  let tokenStart = match.index;
  while (tokenStart > 0 && !/\s/.test(ctx.text[tokenStart - 1])) tokenStart -= 1;
  const tokenEnd = ctx.text.slice(sign).search(/\s|$/) + sign;
  if (/[￼@#/\\_=:;<>{}[\]$&+]/u.test(ctx.text.slice(tokenStart, tokenEnd))) return findings;
  findings.push({
    ruleId: "commaPeriodSpacing",
    messageKey: "review_msg_space_after_mark",
    range: { start: sign, end: sign + 1 },
    alternatives: ["% "],
    context: { start: tokenStart, end: tokenEnd },
  });
  return findings;
};

const spaceAfterComma: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  if (!ctx.insertSpaceAfterAutocomplete) return findings;
  const start = match.index;
  let tokenStart = start;
  while (tokenStart > 0 && !/\s/.test(ctx.text[tokenStart - 1])) tokenStart -= 1;
  let tokenEnd = start;
  while (tokenEnd < ctx.text.length && !/\s/.test(ctx.text[tokenEnd])) tokenEnd += 1;
  const token = ctx.text.slice(tokenStart, tokenEnd);
  if ((token.match(/[,،]/g)?.length ?? 0) > 1 || /[\uFFFC@#/\\_=.:;]/u.test(token)) return findings;
  findings.push({
    ruleId: "commaPeriodSpacing",
    messageKey: "review_msg_space_after_comma",
    range: { start, end: start + 1 },
    alternatives: [`${ctx.source[start]} `],
    context: { start: tokenStart, end: tokenEnd },
  });
  return findings;
};

const repeatedSpaces: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  // Per line start: a long line is measured once, not once per gap.
  const aligned = alignedLines(ctx);
  const newlineBefore = finderOf(ctx, "\n");
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
  if (aligned.get(lineStart)) return findings;
  const end = start + match[0].length;
  // Keep the first space: a no-break space placed on purpose stays.
  findings.push(
    finding("collapseRepeatedSpaces", "review_msg_repeated_spaces", start, end, [
      ctx.source[start],
    ]),
  );
  return findings;
};

const doubledMarks: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  const start = match.index;
  const end = start + match[0].length;
  if (isGluedToTechnical(ctx.text, start, start)) return findings;
  // Polish typists write ",," for the opening „ when a word and a closing quote follow.
  const polishQuote =
    isLang(ctx, "pl") &&
    match[0] === ",," &&
    /^$|\s$/u.test(ctx.text.slice(Math.max(0, start - 1), start)) &&
    /^[\p{L}\p{N}][^\n„]{0,200}?[\p{L}\p{N}.!?…](?:”|"|''|’’)/u.test(
      ctx.text.slice(end, end + 210),
    );
  findings.push(
    finding("duplicatePunctuationCollapse", "review_msg_duplicate_punctuation", start, end, [
      polishQuote ? "„" : match[1],
    ]),
  );
  return findings;
};

const doubledPeriods: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  const start = match.index;
  // German "am 30.11.." ends a sentence on a date: its own dot, then the period.
  const before = ctx.text.slice(Math.max(0, start - 8), start);
  if (isLang(ctx, "de") && /(?:^|[^\d.])\d{1,2}\.\d{1,2}$/.test(before)) return findings;
  const range = { start, end: start + 2 };
  if (/^\s+\p{Ll}/u.test(ctx.text.slice(start + 2, start + 12))) {
    findings.push({
      ruleId: "duplicatePunctuationCollapse",
      messageKey: "review_msg_ellipsis_length",
      range,
      alternatives: ["..."],
    });
    return findings;
  }
  findings.push({
    ruleId: "duplicatePunctuationCollapse",
    messageKey: "review_msg_duplicate_punctuation",
    range,
    alternatives: [".", "..."],
    requiresChoice: true,
  });
  return findings;
};

const twoDotLine: MatchFixer = (match) => {
  const findings: RawFinding[] = [];
  findings.push({
    ruleId: "duplicatePunctuationCollapse",
    messageKey: "review_msg_ellipsis_length",
    range: { start: match.index, end: match.index + 2 },
    alternatives: ["...", "."],
    requiresChoice: true,
  });
  return findings;
};

const longEllipsis: MatchFixer = (match) => {
  const findings: RawFinding[] = [];
  const start = match.index;
  findings.push({
    ruleId: "duplicatePunctuationCollapse",
    messageKey: "review_msg_ellipsis_length",
    range: { start, end: start + match[0].length },
    alternatives: ["..."],
    // Four dots can be a sentence period plus an ellipsis: one at a time.
    bulkBlock: match[0].length === 4 ? "context-dependent" : undefined,
  });
  return findings;
};

/**
 * A double quotation mark glued to words on both sides ('the "fast"way'): a
 * space is missing outside it. The language's own opening and closing marks
 * say which side; a straight or same-glyph mark (sv ”) is decided by how many
 * marks the paragraph opened before it, and the other side is offered too.
 * Inches and seconds ('5"x7"') are left alone.
 */
const quoteSpacing: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  const [open, close] = resolveTypographyProfile(ctx.lang).double;
  const directional = open !== close;
  const marks = directional ? `"${open}${close}` : `"${open}`;
  // The frame finds the marks of every language: keep those of this one.
  const at = match.index;
  if (
    !(/[\p{L}\p{N}]/u.test(ctx.scanText[at - 1] ?? "") && marks.includes(match[0])) &&
    !(directional && match[0] === close && /[.,!?]/.test(ctx.scanText[at - 1] ?? ""))
  )
    return null;
  const paragraphBefore = finderOf(ctx, "\n\n");
  const start = match.index;
  const mark = match[0];
  const spaceBefore = ` ${ctx.source[start]}`;
  const spaceAfter = `${ctx.source[start]} `;
  let alternatives: string[];
  if (directional && mark !== '"') {
    alternatives = [mark === open ? spaceBefore : spaceAfter];
  } else {
    if (/\p{N}/u.test(ctx.text[start - 1])) return findings;
    // 'We"ll', 'Tom"s': a contraction that the apostrophe check corrects.
    if (ctx.lang.startsWith("en") && quotedContraction(ctx.text, start)) return findings;
    const paragraphStart = paragraphBefore(start);
    const paragraph = ctx.text.slice(paragraphStart < 0 ? 0 : paragraphStart + 2, start);
    const opened = paragraph.split(mark).length % 2 === 0;
    alternatives = opened ? [spaceAfter, spaceBefore] : [spaceBefore, spaceAfter];
  }
  findings.push(
    finding("quoteSpacing", "review_msg_quote_spacing", start, start + 1, alternatives, {
      context: { start: Math.max(0, start - 1), end: start + 2 },
    }),
  );
  return findings;
};

/** Optional typography: prime marks for feet, inches, minutes and seconds typed as quotes. */
const primePair: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  if (match[1] === "′" && match[3] === "″") return findings;
  const start = match.index;
  const end = start + match[0].length;
  findings.push({
    ruleId: "primeSymbols",
    messageKey: "review_msg_prime_symbols",
    range: { start, end },
    alternatives: [`′${ctx.source.slice(start + 1, end - 1)}″`],
    context: { start: Math.max(0, start - 8), end: Math.min(ctx.text.length, end + 1) },
  });
  return findings;
};

const degreeMinute: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  const start = match.index;
  findings.push(
    finding("primeSymbols", "review_msg_prime_symbols", start, start + 1, ["′"], {
      context: { start: Math.max(0, start - 8), end: Math.min(ctx.text.length, start + 2) },
    }),
  );
  return findings;
};

/**
 * Optional typography: three periods as the one ellipsis character. Longer runs,
 * ranges ("1...5"), paths ("../") and spread syntax ("[...items]") are not ellipses.
 */
/**
 * Optional typography: "--" and "---" typed for a dash. "---" is an em dash;
 * "--" is an en dash between numbers ("10--20") and otherwise either dash,
 * English preferring the em dash and the other languages the spaced en dash.
 * Line-leading runs (rules, list markers, SQL comments, signatures), command
 * options ("--force") and HTML comments are not dashes.
 */
const typedDashes: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  const english = isLang(ctx, "en");
  const start = match.index;
  const end = start + match[0].length;
  const before = ctx.text[start - 1] ?? "";
  const after = ctx.text[end] ?? "";
  const lineStart = ctx.text.lastIndexOf("\n", start - 1) + 1;
  if (ctx.text.slice(lineStart, start).trim() === "") return findings;
  if (/\s/.test(before) && /[\p{L}\p{N}]/u.test(after)) return findings;
  const alternatives =
    match[0].length === 3
      ? ["—"]
      : /\p{N}/u.test(before) && /\p{N}/u.test(after)
        ? ["–"]
        : english
          ? ["—", "–"]
          : ["–", "—"];
  findings.push(
    finding("emdashShortcut", "review_msg_typed_dash", start, end, alternatives, {
      context: { start: Math.max(0, start - 1), end: Math.min(ctx.text.length, end + 1) },
    }),
  );
  return findings;
};

/**
 * English writes "$", "£" and "¥" before the amount and "¢" after it: "25$"
 * is "$25". Other languages place symbols by their own conventions ("25 $" in
 * French Canada, "R$ 25"), so this is English only. A line with "$" before a
 * name is math or a shell ("$x = 5$", "$HOME"), and is left alone.
 */
const currencyPlacement: MatchFixer = (match, ctx) => {
  if (ctx.lang !== "en_US") return null;
  const findings: RawFinding[] = [];
  const start = match.index;
  const end = start + match[0].length;
  const lineStart = ctx.text.lastIndexOf("\n", start) + 1;
  let lineEnd = ctx.text.indexOf("\n", end);
  if (lineEnd < 0) lineEnd = ctx.text.length;
  if (match[3] === "$" && /\$[\p{L}\\{(_]/u.test(ctx.text.slice(lineStart, lineEnd))) return null;
  findings.push({
    ruleId: "currencySpacing",
    messageKey: "review_msg_currency_placement",
    range: { start, end },
    // "my 20th$" is "my $20th".
    alternatives: [match[4] ? `${match[4]}¢` : `${match[3]}${match[1]}${match[2] ?? ""}`],
    context: { start: lineStart, end: lineEnd },
    bulkBlock: "context-dependent",
  });
  return findings;
};

/** "300°K" is "300 K": the kelvin is an absolute unit and takes no degree sign. */
function kelvinDegree(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const separator = resolveMeasurementLocale(ctx.lang)?.separator ?? " ";
  for (const match of ownedMatches(ctx, /(?<=^|[\p{N}\s(])°K(?![\p{L}\p{N}_])/gu)) {
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

// Units typed in the wrong case where the lowercase symbol is the only reading: "10KG", "25Km".
// "MB" (megabyte, not millibar) and "MS" (not ms) stay out: their case carries meaning.
const UNIT_CASE = new Map([
  ["KG", "kg"],
  ["Kg", "kg"],
  ["KM", "km"],
  ["Km", "km"],
]);

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
    const parse = (value: string) =>
      ruleId === "currencySpacing"
        ? parseMeasurementExpression(value, locale, (text, start) =>
            CURRENCY_MARKERS.has(text.slice(start)),
          )
        : (parseMeasurementExpression(value, locale) ??
          parseMeasurementExpression(value, locale, (text, start) =>
            UNIT_CASE.has(text.slice(start)),
          ));
    const parsed = parse(prefix);
    if (!parsed) continue;
    const unit = prefix.slice(parsed.numberEnd);
    if (ruleId === "measurementUnitFormatting" && /^([A-Z]|[dg])$/.test(unit)) continue;
    // Brazilian usage writes clock times and durations glued: "às 10h", "20min", and a new car
    // is "0km"; French writes "14h" and "14h30" as often as "14 h", so hours stay as typed there.
    if (
      ruleId === "measurementUnitFormatting" &&
      ((ctx.lang === "pt_BR" &&
        (/^(?:h|min)$/.test(unit) ||
          (unit === "km" && prefix.slice(parsed.start, parsed.numberEnd) === "0"))) ||
        (ctx.lang === "fr_FR" && unit === "h"))
    )
      continue;
    // "100m users" counts millions; "Type 42s" and "the 1990s" are plurals, not seconds.
    if (
      ruleId === "measurementUnitFormatting" &&
      ((unit === "m" && /^[ \t]+(?:[a-z]{2,}s|[A-Z]{2,}s)\b/.test(ctx.text.slice(tokenEnd))) ||
        (unit === "s" && /\b\p{Lu}[\p{L}-]*[ \t]+$/u.test(prefix.slice(0, parsed.start))))
    )
      continue;
    let prosePrefix = prefix.slice(0, parsed.start);
    // A prose list retains the evidence before its first measurement. Every
    // preceding item must itself parse; identifiers and arithmetic still abstain.
    // An item may be already spaced ("10 kg, 25km"), so accepting one finding keeps the rest.
    while (!isProsePrefix(prosePrefix)) {
      const item = /(?:^|[ \t])(?:(?<n>[^\s]+)[ \t\u00a0\u202f])?(?<last>[^\s]+),[ \t]+$/du.exec(
        prosePrefix,
      );
      if (!item) break;
      const { n, last } = item.groups!;
      let cut: number;
      if (parse(last)?.start === 0) cut = item.indices!.groups!.last[0];
      else if (n && parse(n + last)?.start === 0) cut = item.indices!.groups!.n[0];
      else break;
      prosePrefix = prosePrefix.slice(0, cut);
    }
    if (!isProsePrefix(prosePrefix)) continue;
    const start = windowStart + parsed.start;
    if (!owned(ctx, start)) continue;
    const numberEnd = windowStart + parsed.numberEnd;
    const lowercase = UNIT_CASE.get(unit);
    // "LOSE 10KG NOW": shouted text keeps its capitals.
    if (
      lowercase &&
      (/\p{Lu}{2}[ \t]+$/u.test(ctx.text.slice(Math.max(0, start - 24), start)) ||
        /^[ \t]+\p{Lu}{2}/u.test(ctx.text.slice(tokenEnd, tokenEnd + 24)))
    )
      continue;
    findings.push({
      ruleId,
      messageKey:
        ruleId === "currencySpacing"
          ? "review_msg_currency_spacing"
          : lowercase
            ? "review_msg_measurement_unit_case"
            : "review_msg_measurement_spacing",
      range: { start, end: tokenEnd },
      alternatives: [
        `${ctx.source.slice(start, numberEnd)}${locale.separator}${lowercase ?? ctx.source.slice(numberEnd, tokenEnd)}`,
      ],
      context: { start: windowStart, end: tokenEnd },
    });
  }
  return findings;
}

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

/** A doubled word of the language (one repeatedWords rule per language). */
const repeatedWord: MatchFixer = (match, ctx) => {
  const findings: RawFinding[] = [];
  const start = match.index;
  const end = start + match[0].length;
  const context = {
    start: Math.max(0, start - PHRASE_WINDOW),
    end: Math.min(ctx.text.length, end + 2),
  };
  const before = ctx.text.slice(context.start, start);
  const word = match[1].toLowerCase();
  if (ctx.dictionary.has(word) || isGluedToTechnical(ctx.text, start, end)) return null;
  // Across a line break only a wrapped prose line counts: a line holding just the word
  // ("the\nthe report") may be a list item or a heading.
  if (match[0].includes("\n") && !/\p{L}[^\n]*[ \t\u00a0]$/u.test(before)) return null;
  // A run gets one repair, including when a later pair belongs to another chunk.
  if (before.match(/(\p{L}+)[ \t\u00a0]{1,8}$/u)?.[1].toLowerCase() === word) return null;
  // A named, quoted example is evidence, not prose to repair. Normal quotations still run.
  if (CUE_AND_QUOTE.test(before)) return null;
  if (word === "to" && !doubledTo(before, ctx.text.slice(end, end + 16))) return null;
  // "What it is is a mess": a pseudo-cleft's clause ends on the first verb.
  if (/^(?:is|was)$/.test(word) && isLang(ctx, "en") && PSEUDO_CLEFT_BEFORE.test(before))
    return null;
  // "the The Beatles album": a capitalized repeat after a lowercase word opens a name;
  // "P A O L A A N": a spelled-out run of single letters.
  const second = match[0].slice(-match[1].length);
  if (/^\p{Ll}/u.test(match[1]) && /^\p{Lu}/u.test(second)) return null;
  if (word.length === 1 && /(?:^|\s)\p{L}[ \t ]+$/u.test(before)) return null;
  findings.push({
    ruleId: "englishRepeatedWords",
    messageKey: "review_msg_repeated_words",
    range: { start, end },
    alternatives: [ctx.source.slice(start, start + match[1].length)],
    context,
  });
  return findings;
};

/**
 * The named shared detectors: common.yaml names them in its Review rules, which set their
 * checks, languages and order.
 */
export const CORE_PREDICATES: Readonly<Record<string, Detector>> = {
  styleFindings: (ctx) => ownedFindings(ctx, ctx.styleFindings),
  terminology: (ctx) => ownedFindings(ctx, ctx.terminologyFindings),
  phraseTables: (ctx) => detectAll(ctx, [canonicalCasing, phraseCorrections]),
  quotationFindings: (ctx) => ownedFindings(ctx, ctx.quotationFindings),
  typographicQuotes: TYPOGRAPHIC_QUOTES.detect,
  possessives: contextualPossessives,
  nounNumber: nounNumberConstructions,
  doubledDegree: (ctx) =>
    ctx.lang === "en_US" ? doubledDegree(ctx) : doubledDegreeByLanguage(ctx),
  countability,
  pronounCase,
  wordConfusions,
  // The English word lists are the spellingWords frames; other languages have their own tables.
  spelling: (ctx) =>
    detectAll(
      ctx,
      ctx.lang === "en_US" ? [markedApostrophes] : [splitWords, frenchElisions, markedApostrophes],
    ),
  modalOf,
  yourWelcome,
  theirThere,
  pronounVerb,
  subjectAgreement,
  existentialAgreement,
  articleAn,
  properNouns: (ctx) => (ctx.lang === "en_US" ? properNoun(ctx) : germanNounCapitals(ctx)),
  measurement: (ctx) =>
    detectAll(ctx, [
      (c) => measurementLike(c, "measurementUnitFormatting"),
      kelvinDegree,
      (c) => germanUnits(c).filter((f) => f.ruleId === "measurementUnitFormatting"),
    ]),
  // English places the symbols in the currencyPlacement frame.
  currency: (ctx) =>
    detectAll(ctx, [
      (c) => measurementLike(c, "currencySpacing"),
      (c) => germanUnits(c).filter((f) => f.ruleId === "currencySpacing"),
    ]),
  dateTense,
};

/** The frame fixes of the shared detectors of this module. */
const DETECTOR_FIXERS = {
  capitalizeSentenceStart,
  capitalizeAfterLineBreak,
  pronounI,
  spellingTypo: spellingOf("englishTypoWhitelistCorrection"),
  spellingContraction: spellingOf("englishContractionNormalization"),
  spellingAlot: spellingOf("englishAlotCorrection"),
  ordinal,
  spaceBeforeComma,
  spaceBeforeMark,
  spaceAfterOpeningMark,
  wideComma,
  spaceAfterPercent,
  spaceAfterComma,
  repeatedSpaces,
  doubledMarks,
  doubledPeriods,
  twoDotLine,
  longEllipsis,
  quoteSpacing,
  primePair,
  degreeMinute,
  typedDashes,
  currencyPlacement,
  repeatedWord,
} satisfies Record<string, MatchFixer>;

/** The named frame fixes of grammar/rules/common.yaml (`fixer:`). */
const CORE_FIXERS = mergePredicates<Fixer>(
  DETECTOR_FIXERS,
  COMPLEMENT_FIXERS,
  AUXILIARY_FIXERS,
  PARTICIPLE_FIXERS,
  STRUCTURE_FIXERS,
);

/** The named findings filters of grammar/rules/common.yaml (`filter:`). */
const CORE_FILTERS = mergePredicates<FindingsFilter>(
  USAGE_FILTERS,
  COMPOUND_FILTERS,
  AUXILIARY_FILTERS,
);

/**
 * Review detectors in evaluation order, built from the Review rules of grammar/rules/*.yaml.
 * Rules absent here are excluded from review (see reviewCatalog).
 */
export const REVIEW_DETECTORS: ReviewDetectorEntry[] = buildReviewDetectors(
  {
    common: CORE_PREDICATES,
    en: ENGLISH,
    de: GERMAN,
    el: GREEK,
    sv: SWEDISH,
    ar_SA: ARABIC,
    pt_BR: PORTUGUESE,
    pl: POLISH,
    es: SPANISH,
    fr: FRENCH,
  },
  {
    common: CORE_FIXERS,
    en: ENGLISH_FIXERS,
    de: GERMAN_FIXERS,
    el: GREEK_FIXERS,
    sv: SWEDISH_FIXERS,
    ar_SA: ARABIC_FIXERS,
    pt_BR: PORTUGUESE_FIXERS,
    pl: POLISH_FIXERS,
    es: SPANISH_FIXERS,
    fr: FRENCH_FIXERS,
  },
  {
    common: CORE_FILTERS,
    en: ENGLISH_FILTERS,
    de: GERMAN_FILTERS,
    el: GREEK_FILTERS,
    sv: SWEDISH_FILTERS,
    ar_SA: ARABIC_FILTERS,
    pt_BR: PORTUGUESE_FILTERS,
    pl: POLISH_FILTERS,
    es: SPANISH_FILTERS,
    fr: FRENCH_FILTERS,
  },
);

/** Per-language entries: they may add context detectors to shared rules or serve their own. */
export const LANGUAGE_DETECTORS: readonly ReviewDetectorEntry[] = REVIEW_DETECTORS.filter(
  (entry) => entry.source !== "common" && entry.source !== "en",
);
