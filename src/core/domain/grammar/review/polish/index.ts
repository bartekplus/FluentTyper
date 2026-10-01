// Polish Review tables and detectors, one module per area (see english/index.ts).
import type { LanguagePhraseTables } from "../languagePhraseTables";
import type { ReviewDetectorEntry } from "../reviewDetectors";
import * as compounds from "./compounds";
import * as confusions from "./confusions";

export const POLISH_TABLES: Required<LanguagePhraseTables> = {
  words: confusions.WORDS,
  phrases: confusions.PHRASES,
  compounds: compounds.COMPOUNDS,
  style: [],
};
export const POLISH_SPLIT_WORDS = compounds.SPLIT_WORDS;
export const POLISH_DETECTORS: readonly ReviewDetectorEntry[] = [
  ...compounds.DETECTORS,
  ...confusions.DETECTORS,
];
