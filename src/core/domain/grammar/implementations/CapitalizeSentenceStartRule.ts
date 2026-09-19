import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import {
  isLowercaseLetter,
  isTechnicalToken,
  resolveInputAction,
} from "./helpers/GenericRuleShared";

const SENTENCE_ENDING_CHARS = new Set([".", "!", "?"]);
// A period closing one of these is an abbreviation at least as often as a
// sentence end, so the following word is left exactly as the user typed it.
const ABBREVIATIONS = new Set([
  "etc",
  "vs",
  "cf",
  "al",
  "approx",
  "eg",
  "ie",
  "fig",
  "resp",
  "est",
  "min",
  "max",
  // Titles and company forms.
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "jr",
  "sr",
  "inc",
  "ltd",
  "co",
  "corp",
  "dept",
  "univ",
  "ave",
  "blvd",
  // de_DE, pl_PL, es/pt, sv_SE, hr_HR.
  "usw",
  "bzw",
  "evtl",
  "ggf",
  "vgl",
  "inkl",
  "np",
  "tzn",
  "itd",
  "itp",
  "tj",
  "tys",
  "sra",
  "ej",
  "dvs",
  "osv",
  "npr",
  "tzv",
]);

/** True when the period at `index` closes an initial or a known abbreviation. */
// Locales that write ordinals as "1." inside a sentence ("der 1. und 2. Platz").
const ORDINAL_PERIOD_LOCALES = new Set(["de_DE", "hr_HR", "pl_PL", "sv_SE"]);

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
  return token.length <= 1 || token.includes(".") || ABBREVIATIONS.has(token.toLowerCase());
}
const CLOSING_CHARS = new Set([")", "]", "}", '"', "'", "”", "’"]);
const WORD_BOUNDARY_CHARS = [...SPACE_CHARS, "\n"];
// Punctuation that closes a prose word without making it a token: "done.",
// "hello,", "(quietly)".
const TRAILING_PUNCTUATION_REGEX = /[.,!?;:)\]}"'”’]+$/u;

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
    if (
      !isLowercaseLetter(word[0]) ||
      isTechnicalToken(word.replace(TRAILING_PUNCTUATION_REGEX, "")) ||
      !this.startsSentence(text, wordStart, context.hints?.lang)
    ) {
      return null;
    }

    return {
      replacement: `${word[0].toUpperCase()}${text.slice(wordStart + 1)}`,
      deleteBackwards: text.length - wordStart,
      deleteForwards: 0,
    };
  }

  private startsSentence(text: string, wordStart: number, lang?: string): boolean {
    let i = wordStart - 1;
    // A newline is left to the line-break rule.
    while (i >= 0 && SPACE_CHARS.includes(text[i])) {
      i -= 1;
    }
    if (i < 0) {
      return true;
    }
    while (i >= 0 && CLOSING_CHARS.has(text[i])) {
      i -= 1;
    }
    return (
      i >= 0 &&
      SENTENCE_ENDING_CHARS.has(text[i]) &&
      !(text[i] === "." && closesAbbreviation(text, i, lang))
    );
  }
}
