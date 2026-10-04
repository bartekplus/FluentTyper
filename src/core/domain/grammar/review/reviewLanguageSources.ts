import * as arabic from "./arabic/lexicon.generated";
import * as frenchAdjectives from "./french/frenchAdjectives.generated";
import * as frenchCompounds from "./french/frenchCompounds.generated";
import * as frenchGender from "./french/frenchGender.generated";
import * as frenchLexicon from "./french/frenchLexicon.generated";
import * as frenchNouns from "./french/frenchNouns.generated";
import * as germanGender from "./german/germanGender.generated";
import * as germanLexicon from "./german/germanLexicon.generated";
import * as germanUsage from "./german/germanUsage.generated";
import * as polishLexicon from "./polish/lexicon.generated";
import * as polishWords from "./polish/words.generated";
import * as portugueseParonyms from "./portuguese/paronyms.generated";
import * as portugueseVerbStems from "./portuguese/verbStems.generated";
import * as portugueseVerbs from "./portuguese/verbs.generated";
import * as spanish from "./spanish/spanishLexicon.generated";
import * as swedish from "./swedish/lexicon.generated";
import { setReviewData, type ReviewLanguageData } from "./reviewLanguageData";

/**
 * Each language's generated Review data, its modules merged. Only build.ts (which writes
 * review-data/<lang>.json), tests and tools import this module, never background.js.
 */
export const REVIEW_LANGUAGE_SOURCES: Record<string, readonly ReviewLanguageData[]> = {
  ar: [arabic],
  de: [germanGender, germanLexicon, germanUsage],
  es: [spanish],
  fr: [frenchAdjectives, frenchCompounds, frenchGender, frenchLexicon, frenchNouns],
  pl: [polishLexicon, polishWords],
  pt: [portugueseParonyms, portugueseVerbStems, portugueseVerbs],
  sv: [swedish],
};

/** One language's data as one record (the content of review-data/<lang>.json). */
export const mergedReviewData = (lang: string): ReviewLanguageData =>
  Object.fromEntries(REVIEW_LANGUAGE_SOURCES[lang].flatMap((module) => Object.entries(module)));

/** Loads every language's data synchronously, from source (tests and the LT harness). */
export function loadAllReviewData(): void {
  for (const lang of Object.keys(REVIEW_LANGUAGE_SOURCES))
    setReviewData(lang, mergedReviewData(lang));
}
