import { baseLanguage, languageMatchesScript } from "@core/domain/lang";
import type { ProtectedRange } from "@core/domain/grammar/review/types";

/** Local paragraph evidence. Unknown long regions remain unchecked, with an explicit coverage gap. */
export async function reviewLanguageRegions(
  text: string,
  language: string,
  detect: (text: string) => Promise<string | null>,
  requireEvidence = true,
): Promise<ProtectedRange[]> {
  const base = baseLanguage(language);
  const requests = new Map<string, Promise<string | null>>();
  const regions: Promise<ProtectedRange | null>[] = [];
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
    if (requests.size >= 32 && !requests.has(sample)) {
      regions.push(Promise.resolve({ ...range, reason: "language-uncertain" }));
      continue;
    }
    let request = requests.get(sample);
    if (!request) {
      request = detect(sample.slice(0, 4000)).catch(() => null);
      requests.set(sample, request);
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
