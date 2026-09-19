import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { isLowercaseLetter } from "./helpers/GenericRuleShared";

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

export class CapitalizeSentenceStartRule implements GrammarRule {
  readonly id = "capitalizeSentenceStart" as const;
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    if (text.length === 0) {
      return null;
    }

    const lastChar = text[text.length - 1];
    if (!isLowercaseLetter(lastChar)) {
      return null;
    }

    let i = text.length - 2;
    while (i >= 0 && SPACE_CHARS.includes(text[i]) && text[i] !== "\n") {
      i -= 1;
    }

    // Capitalize first letter of a fresh sequence.
    if (i < 0) {
      return {
        replacement: lastChar.toUpperCase(),
        deleteBackwards: 1,
        deleteForwards: 0,
      };
    }

    const hadWhitespaceGap = i < text.length - 2;
    while (i >= 0 && CLOSING_CHARS.has(text[i])) {
      i -= 1;
    }

    if (
      i >= 0 &&
      SENTENCE_ENDING_CHARS.has(text[i]) &&
      hadWhitespaceGap &&
      !(text[i] === "." && closesAbbreviation(text, i, context.hints?.lang))
    ) {
      return {
        replacement: lastChar.toUpperCase(),
        deleteBackwards: 1,
        deleteForwards: 0,
      };
    }

    return null;
  }
}
