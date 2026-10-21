// Facade: the fixed-phrase tables of grammar/rules/en.yaml. The frames of rule en.fixedPhrases
// are rule code in the rule file.
import { table } from "./tables";

/** Misheard idioms, wrong words in set phrases and their inflections. */
export const PHRASES = table("fixedPhrases.phrases");

/** Split, joined and hyphenated forms of single words. */
export const COMPOUNDS = table("fixedPhrases.compounds");

/** Optional advice: informal abbreviations, contested idiom variants, redundancy. */
export const STYLE = table("fixedPhrases.style");
