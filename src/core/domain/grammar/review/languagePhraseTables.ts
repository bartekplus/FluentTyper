import type { PhraseRow } from "./englishPhraseTables";
import { PHRASE_TABLE_KINDS } from "../engine/catalog.generated";
import { PHRASES } from "../engine/review.generated";
import { parseRows } from "../engine/rows";
import { REVIEW_DATA_LANGUAGES, reviewData, type ReviewLanguageData } from "./reviewLanguageData";

/**
 * The English phrase checks for the other review languages, by language code.
 * Same row format and matching as the English tables; a row is only here when
 * its typed form is never correct in that language, or is narrowed to a frame
 * where it cannot be. Merged words that are always two are in `compounds` or in
 * `multilingualLexicon.ts` (`englishAlotCorrection`).
 */
export interface LanguagePhraseTables {
  /** Misspelled words (`englishPhraseCorrections`). */
  words?: readonly PhraseRow[];
  /** A wrong word form inside a fixed frame (`englishPhraseCorrections`). */
  phrases?: readonly PhraseRow[];
  /**
   * Compounds written apart or without their hyphens, and words written together that are
   * two (`englishClosedCompounds`).
   */
  compounds?: readonly PhraseRow[];
  /** Optional wording advice: pleonasms (`stylePhrasing`). */
  style?: readonly PhraseRow[];
}

const DATA_KEYS = {
  words: "PHRASES_WORDS",
  phrases: "PHRASES_PHRASES",
  compounds: "PHRASES_COMPOUNDS",
  style: "PHRASES_STYLE",
} as const;
const PARSED = new WeakMap<ReviewLanguageData, LanguagePhraseTables>();

/**
 * The phrase tables of `lang`. A language with Review data ships them in its data file
 * (review-data/<lang>.json); reading them throws until the data is loaded, so the detector
 * that needs them fails like any other detector that reads that data.
 */
function tablesOf(lang: string): LanguagePhraseTables {
  if (!(REVIEW_DATA_LANGUAGES as readonly string[]).includes(lang)) return PHRASES[lang] ?? {};
  const data = reviewData<ReviewLanguageData>(lang);
  let tables = PARSED.get(data);
  if (!tables) {
    const errors: string[] = [];
    tables = Object.fromEntries(
      Object.entries(DATA_KEYS).flatMap(([kind, key]) =>
        data[key] === undefined ? [] : [[kind, parseRows(data[key], key, errors)]],
      ),
    );
    PARSED.set(data, tables);
  }
  return tables;
}

/** The `phrases` of grammar/rules/<language>.yaml, by two-letter language. */
export const LANGUAGE_PHRASE_TABLES: Readonly<Record<string, LanguagePhraseTables>> =
  Object.defineProperties(
    {},
    Object.fromEntries(
      Object.keys(PHRASE_TABLE_KINDS).map((lang) => [
        lang,
        { enumerable: true, get: () => tablesOf(lang) },
      ]),
    ),
  );
