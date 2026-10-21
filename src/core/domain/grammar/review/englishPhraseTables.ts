import { table } from "./english/tables";

/**
 * Fixed English phrases whose conventional form is not in doubt. A row is
 * [typed forms, replacements]; several replacements mean the writer chooses.
 * Matching is whole-word and case-insensitive with 1 to 8 spaces, tabs or
 * no-break spaces between words, so a row stays out whenever its typed form
 * is also ordinary English ("every one of them", "keep on going", "in the
 * other hand she held…").
 */
export type PhraseRow = readonly [
  typed: string | readonly string[],
  replacement: string | readonly string[],
];

/** Eggcorns, misheard idioms and fixed phrases with a wrong word. */
export const PHRASE_CORRECTIONS = table("phraseCorrections");

/** Words written apart that are one word (or joined, hyphenated, split as shown). */
export const CLOSED_COMPOUNDS = table("closedCompounds");

/**
 * Chat abbreviations whose ALL-CAPS form means only the chat phrase. The rest
 * abstain in capitals: "IMO" is also an organization, "IRL" a country code,
 * "NVM" memory.
 */
export const UNAMBIGUOUS_CAPS_ABBREVIATIONS: ReadonlySet<string> = new Set([
  ...["btw", "fyi", "imho", "afaik", "afaict", "tbh", "idk", "iirc", "asap", "lmk"],
  ...["brb", "ttyl", "otoh", "icymi", "fwiw", "ptal"],
]);

/** Optional style advice: chat abbreviations and wordy or redundant phrasing. */
export const STYLE_PHRASES = table("stylePhrases");

/** Multi-word place and product names that are never ordinary phrases. */
export const NAME_CASING: readonly string[] = table("nameCasing").map(([, name]) => name as string);
