import { table } from "./tables";

// Contractions split by a space, holiday names with their apostrophes, and optional plain-style
// rewrites of wordy phrases. The frames are in grammar/rules/en.yaml.

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES = table("usageTables.phrases");

export const STYLE = table("usageTables.style");
