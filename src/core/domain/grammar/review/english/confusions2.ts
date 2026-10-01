import type { PhraseRow } from "../englishPhraseTables";
import type { ReviewDetectorEntry } from "../reviewDetectors";

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];
/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [];
