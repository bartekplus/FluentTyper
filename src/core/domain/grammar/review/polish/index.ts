// Polish Review tables and detectors, one module per area (see english/index.ts).
import type { LanguagePhraseTables } from "../languagePhraseTables";
import type { ReviewDetectorEntry } from "../reviewDetectors";
import * as commas from "./commas";
import * as compounds from "./compounds";
import * as confusions from "./confusions";
import * as dates from "./dates";
import * as numbers from "./numbers";
import * as prepositions from "./prepositions";
import * as style from "./style";

export const POLISH_TABLES: Required<LanguagePhraseTables> = {
  words: confusions.WORDS,
  phrases: [...confusions.PHRASES, ...style.PHRASES],
  compounds: compounds.COMPOUNDS,
  style: style.STYLE,
};
export const POLISH_SPLIT_WORDS = compounds.SPLIT_WORDS;
export const POLISH_DETECTORS: readonly ReviewDetectorEntry[] = [
  ...compounds.DETECTORS,
  ...confusions.DETECTORS,
  ...numbers.DETECTORS,
  ...dates.DETECTORS,
  ...commas.DETECTORS,
  ...prepositions.DETECTORS,
];
