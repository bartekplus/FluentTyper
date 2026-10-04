import { explanationTable } from "./reviewExplanations";

/**
 * The findings' explanations in English: the fallback for every UI language.
 * build.ts replaces this module with its value, so background.js carries
 * English only; the other languages load from review-explanations/<lang>.json.
 */
export const ENGLISH_EXPLANATIONS: Readonly<Record<string, string>> = explanationTable("en");
