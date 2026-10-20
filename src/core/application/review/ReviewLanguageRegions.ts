import { baseLanguage, languageMatchesScript } from "@core/domain/lang";
import type { ProtectedRange } from "@core/domain/grammar/review/types";

/** Detected languages by paragraph; a recheck after an edit asks only for the changed ones. */
export type LanguageRegionCache = Map<string, Promise<string | null>>;
const MAX_CACHED_PARAGRAPHS = 512;

/** Local paragraph evidence. Unknown long regions remain unchecked, with an explicit coverage gap. */
export async function reviewLanguageRegions(
  text: string,
  language: string,
  detect: (text: string) => Promise<string | null>,
  requireEvidence = true,
  cache?: LanguageRegionCache,
): Promise<ProtectedRange[]> {
  const base = baseLanguage(language);
  const requests = new Map<string, Promise<string | null>>();
  const regions: Promise<ProtectedRange | null>[] = [];
  let detections = 0;
  for (const match of text.matchAll(/[^\r\n]+/gu)) {
    const sample = match[0];
    if (
      [...sample.matchAll(/\p{L}{2,}/gu)].some((word) => !languageMatchesScript(language, word[0]))
    ) {
      regions.push(
        Promise.resolve({
          start: match.index,
          end: match.index + sample.length,
          reason: "other-language",
        }),
      );
      continue;
    }
    // Short text cannot establish a different language. The explicit/configured choice remains visible.
    if ((sample.match(/\p{L}+/gu)?.length ?? 0) < 3 && (sample.match(/\p{L}/gu)?.length ?? 0) < 20)
      continue;
    const range = { start: match.index, end: match.index + sample.length };
    const cached = cache?.get(sample);
    if (cached) requests.set(sample, cached);
    else if (detections >= 32 && !requests.has(sample)) {
      if (requireEvidence)
        regions.push(Promise.resolve({ ...range, reason: "language-uncertain" }));
      continue;
    }
    let request = requests.get(sample);
    if (!request) {
      request = detect(sample.slice(0, 4000)).catch(() => null);
      detections += 1;
      requests.set(sample, request);
      if (cache) {
        // shortcut: FIFO, not LRU; enough for one page's fields.
        if (cache.size >= MAX_CACHED_PARAGRAPHS) cache.delete(cache.keys().next().value!);
        cache.set(sample, request);
      }
    }
    regions.push(
      request.then((detected) => {
        if (!detected || detected === "und")
          return requireEvidence ? { ...range, reason: "language-uncertain" } : null;
        return baseLanguage(detected) === base ? null : { ...range, reason: "other-language" };
      }),
    );
  }
  return (await Promise.all(regions)).filter((region): region is ProtectedRange => region !== null);
}
