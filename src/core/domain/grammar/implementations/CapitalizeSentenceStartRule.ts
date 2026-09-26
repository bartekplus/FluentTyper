import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { isGreekQuestionMark } from "../typographyProfiles";
import {
  isLowercaseLetter,
  isTechnicalToken,
  resolveInputAction,
} from "./helpers/GenericRuleShared";

const SENTENCE_ENDING_CHARS = new Set([".", "!", "?"]);
// Spanish opens a question or exclamation with an inverted mark: "¿Qué?".
export const SENTENCE_OPENING_MARKS = new Set(["¿", "¡"]);
// A period closing one of these is an abbreviation at least as often as a
// sentence end, so the following word is left exactly as the user typed it.
// Each language only gets its own list: "co." (pl "what"), "est." (fr "east"),
// "ave." (pt "bird") and "min." (sv "my") end sentences elsewhere.
// ar_SA needs no entries: Arabic script is uncased, so the rule never fires on it.
const SHARED_ABBREVIATIONS = ["etc", "vs", "cf", "al", "eg", "ie", "dr", "prof"];
const ABBREVIATIONS_BY_LANGUAGE: Record<string, readonly string[]> = {
  en: [
    ...["approx", "fig", "resp", "est", "min", "max", "mr", "mrs", "ms", "jr", "sr"],
    ...["inc", "ltd", "co", "corp", "dept", "univ", "ave", "blvd"],
  ],
  de: ["usw", "bzw", "evtl", "ggf", "vgl", "inkl", "ca", "bspw", "nr", "hr", "fr"],
  pl: ["np", "tzn", "itd", "itp", "tj", "mgr", "inż", "ul", "godz", "wg", "św"],
  es: ["sr", "sra", "srta", "ej", "aprox", "pág", "núm", "ud", "uds"],
  pt: ["sr", "sra", "srta", "pág", "núm", "av", "dra"],
  sv: ["dvs", "osv", "tys", "ca", "nr", "bl"],
  hr: ["npr", "tzv", "itd", "sl", "br", "god"],
  fr: ["env", "av", "apr", "mme", "mlle"],
  el: ["κλπ", "δηλ", "βλ", "σελ", "αρ"],
};
const ALL_ABBREVIATIONS = new Set([
  ...SHARED_ABBREVIATIONS,
  ...Object.values(ABBREVIATIONS_BY_LANGUAGE).flat(),
]);
const LANGUAGE_ABBREVIATIONS = new Map(
  Object.entries(ABBREVIATIONS_BY_LANGUAGE).map(([lang, words]) => [
    lang,
    new Set([...SHARED_ABBREVIATIONS, ...words]),
  ]),
);

/** A language without its own list (auto-detect not resolved yet) keeps every entry. */
function abbreviationsFor(lang?: string): ReadonlySet<string> {
  return LANGUAGE_ABBREVIATIONS.get((lang ?? "").slice(0, 2).toLowerCase()) ?? ALL_ABBREVIATIONS;
}

// Locales that write ordinals as "1." inside a sentence ("der 1. und 2. Platz").
const ORDINAL_PERIOD_LOCALES = new Set(["de_DE", "hr_HR", "pl_PL", "sv_SE"]);

/** True when the period at `index` closes an initial or a known abbreviation. */
function closesAbbreviation(text: string, index: number, lang?: string): boolean {
  let start = index;
  while (start > 0 && /[\p{L}\p{N}.]/u.test(text[start - 1])) {
    start -= 1;
  }
  const token = text.slice(start, index);
  if (!/\p{L}/u.test(token)) {
    // "2026." and "12." end sentences in English; elsewhere they are ordinals.
    return token.length > 0 && ORDINAL_PERIOD_LOCALES.has(lang ?? "");
  }
  return (
    token.length <= 1 || token.includes(".") || abbreviationsFor(lang).has(token.toLowerCase())
  );
}
// Includes every closing quote the typography profiles emit: „…“ ‚…‘ «…» ›…‹.
export const CLOSING_CHARS = new Set([")", "]", "}", '"', "'", "”", "’", "“", "‘", "»", "›"]);
// French padding inside a closing guillemet and before "!" or "?": "« Oui ! »".
export const CLOSING_PADDING_CHARS = new Set(["\u00A0", "\u202F"]);
export const WORD_BOUNDARY_CHARS = [...SPACE_CHARS, "\n"];
// Punctuation that closes a prose word without making it a token: "done.",
// "hello,", "(quietly)".
export const TRAILING_PUNCTUATION_REGEX = /[.,!?;:)\]}"'”’“‘»›\u00A0\u202F]+$/u;

export class CapitalizeSentenceStartRule implements GrammarRule {
  readonly id = "capitalizeSentenceStart" as const;
  // The first letter is only capitalized once the word is complete: "u" may
  // become "user.save()", and no keystroke before the boundary says otherwise.
  // A newline arrives as insertChar, hence both triggers.
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    const boundary = text.length - 1;
    if (
      boundary < 1 ||
      !WORD_BOUNDARY_CHARS.includes(text[boundary]) ||
      WORD_BOUNDARY_CHARS.includes(text[boundary - 1]) ||
      resolveInputAction(context) === "delete"
    ) {
      return null;
    }

    let wordStart = boundary;
    while (wordStart > 0 && !WORD_BOUNDARY_CHARS.includes(text[wordStart - 1])) {
      wordStart -= 1;
    }
    const word = text.slice(wordStart, boundary);
    const letter = SENTENCE_OPENING_MARKS.has(word[0]) ? 1 : 0;
    if (
      !isLowercaseLetter(word[letter] ?? "") ||
      isTechnicalToken(word.replace(TRAILING_PUNCTUATION_REGEX, "")) ||
      !startsSentence(text, wordStart, context.hints?.lang)
    ) {
      return null;
    }

    return {
      replacement: `${word.slice(0, letter)}${word[letter].toUpperCase()}${text.slice(wordStart + letter + 1)}`,
      deleteBackwards: text.length - wordStart,
      deleteForwards: 0,
    };
  }
}

/**
 * True when the word at `wordStart` opens a sentence: text start, or a sentence
 * end (not an abbreviation) followed by spaces. A newline is not a sentence
 * start here; capitalizeAfterLineBreak owns line starts.
 */
export function startsSentence(text: string, wordStart: number, lang?: string): boolean {
  let i = wordStart - 1;
  // A newline is left to the line-break rule.
  while (i >= 0 && SPACE_CHARS.includes(text[i])) {
    i -= 1;
  }
  if (i < 0) {
    return true;
  }
  if (CLOSING_CHARS.has(text[i])) {
    while (i >= 0 && (CLOSING_CHARS.has(text[i]) || CLOSING_PADDING_CHARS.has(text[i]))) {
      i -= 1;
    }
  }
  return (
    i >= 0 &&
    (SENTENCE_ENDING_CHARS.has(text[i]) || isGreekQuestionMark(text[i], lang)) &&
    !(text[i] === "." && closesAbbreviation(text, i, lang))
  );
}
