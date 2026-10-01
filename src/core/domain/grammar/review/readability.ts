import { closesAbbreviation } from "../implementations/CapitalizeSentenceStartRule";
import { MAX_REVIEW_CHARS } from "./types";
import type { ProtectedRange, ReviewSourceSnapshot, TextRange } from "./types";

import { DEFAULT_LONG_SENTENCE_WORDS, longSentenceThreshold } from "./reviewCatalog";

/** Technical spans that are literal prose for a non-editing readability warning. */
export function isReadabilityLiteral(text: string): boolean {
  return /^(?:(?:e\.g|i\.e|U\.S|U\.K)\.?|\d+\.\d+)$/i.test(text);
}

/**
 * Fully visible prose sentences only, segmented for `lang`. No sentence is split or rewritten.
 * Segment the full bounded, masked analysis view before applying the scope so neither
 * cropped edges nor punctuation inside protected content can invent a sentence start.
 */
export function longSentenceRanges(
  snapshot: ReviewSourceSnapshot,
  protectedRanges: readonly ProtectedRange[],
  analysisText: string,
  threshold: number = DEFAULT_LONG_SENTENCE_WORDS,
  lang = "en_US",
): TextRange[] {
  const text = analysisText;
  if (text.length !== snapshot.text.length) return [];
  if (snapshot.incomplete || text.length > MAX_REVIEW_CHARS) return [];
  const limit = longSentenceThreshold(threshold);
  const result: TextRange[] = [];
  // Lists are not prose sentences, even if ICU splits after their numeric marker.
  const blocked: TextRange[] = [
    ...protectedRanges.filter((range) => {
      // Dotted prose abbreviations remain literal words, not opaque technical content.
      return !(
        range.reason === "technical" && isReadabilityLiteral(text.slice(range.start, range.end))
      );
    }),
    ...Array.from(
      text.matchAll(/^[ \t]*(?:[-*+•]|\d{1,6}[.)]|[a-z][.)]|[A-Z][)])[ \t]+[^\r\n]+/gm),
      (m) => ({
        start: m.index,
        end: m.index + m[0].length,
      }),
    ),
  ].sort((a, b) => a.start - b.start);
  let blockedIndex = 0;
  let pendingStart: number | undefined;
  let ambiguous = false;
  for (const segment of sentenceSegments(text, lang)) {
    const start = pendingStart ?? segment.index;
    const trimmed = segment.segment.trimEnd();
    if (!trimmed) {
      pendingStart = undefined;
      ambiguous = false;
      continue;
    }
    const end = segment.index + trimmed.length;
    const ending = trimmed.match(/[.!?؟]["'”’“»«)\]]*$/u);
    const mark = ending ? segment.index + ending.index! : -1;
    if (
      mark < 0 &&
      /\r?\n/.test(segment.segment.slice(trimmed.length)) &&
      !/\r?\n[ \t]*\r?\n/.test(segment.segment)
    ) {
      pendingStart = start;
      continue;
    }
    if (mark >= 0 && text[mark] === "." && closesAbbreviation(text, mark, lang)) {
      if (/\r?\n[ \t]*\r?\n/.test(segment.segment)) {
        pendingStart = undefined;
        ambiguous = false;
        continue;
      }
      const token = text.slice(Math.max(start, mark - 32), mark).match(/([\p{L}.]+)$/u)?.[1] ?? "";
      // A title/initial certainly continues; "etc. Next..." could end a sentence.
      if (!/^(?:mr|mrs|ms|dr|prof|[A-Za-z])$/i.test(token)) ambiguous = true;
      pendingStart = start;
      continue;
    }
    pendingStart = undefined;
    const unsafe = ambiguous;
    ambiguous = false;
    let from = start;
    while (from < end && /\s/.test(text[from])) from++;
    // A dangling final fragment or paragraph-spanning ambiguity is not a complete sentence.
    if (unsafe || mark < 0 || /\r?\n[ \t]*\r?\n/.test(text.slice(from, end))) continue;
    if (from < snapshot.scope.start || end > snapshot.scope.end) continue;
    while (blockedIndex < blocked.length && blocked[blockedIndex].end <= from) blockedIndex++;
    if (blockedIndex < blocked.length && blocked[blockedIndex].start < end) continue;
    const words = text
      .slice(from, end)
      .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[.'’-][\p{L}\p{M}\p{N}]+)*/gu);
    if ((words?.length ?? 0) > limit) result.push({ start: from, end });
  }
  return result;
}

/** ICU can join a period followed by lowercase prose; retain explicit known sentence ends. */
function* sentenceSegments(
  text: string,
  lang: string,
): Generator<{ index: number; segment: string }> {
  // "auto_detect" (unresolved) is not a locale tag.
  const locale = /^[a-z]{2}_[A-Z]{2}$/.test(lang) ? lang.replace("_", "-") : "en";
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  for (const segment of segmenter.segment(text)) {
    let from = 0;
    for (const end of segment.segment.matchAll(/[.!?؟]["'”’“»«)\]]*[ \t]+/gu)) {
      const mark = segment.index + end.index;
      if (text[mark] === "." && closesAbbreviation(text, mark, lang)) continue;
      const to = end.index + end[0].length;
      yield { index: segment.index + from, segment: segment.segment.slice(from, to) };
      from = to;
    }
    if (from < segment.segment.length)
      yield { index: segment.index + from, segment: segment.segment.slice(from) };
  }
}
