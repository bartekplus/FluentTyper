// The generated Review data of each language but English (the *.generated.ts modules under
// review/<language>/). background.js does not contain it: build.ts writes it to
// review-data/<lang>.json, and LocalReviewEngine loads a language's file before the first
// check of text in that language. Tests and the LT harness fill it from source
// (reviewLanguageSources.ts). The detectors read it synchronously through reviewData.

/** The languages (first two letters of the Review locale) that have generated data. */
export const REVIEW_DATA_LANGUAGES = ["ar", "de", "es", "fr", "pl", "pt", "sv"] as const;

export type ReviewLanguageData = Readonly<Record<string, string>>;

const loaded = new Map<string, ReviewLanguageData>();

/** True when `lang` has generated data that is not loaded yet. */
export const needsReviewData = (lang: string): boolean =>
  (REVIEW_DATA_LANGUAGES as readonly string[]).includes(lang) && !loaded.has(lang);

/** Sets the data of `lang`; undefined removes it (tests only). */
export function setReviewData(lang: string, data: ReviewLanguageData | undefined): void {
  if (data) loaded.set(lang, data);
  else loaded.delete(lang);
}

/**
 * The generated data of `lang`, typed as its modules. Throws when it is not loaded: the
 * detector that needs it fails (its rules count as a rule error) and gives no findings.
 */
export function reviewData<T>(lang: string): T {
  const data = loaded.get(lang);
  if (!data) throw new Error(`The Review data of "${lang}" is not loaded`);
  return data as T;
}
