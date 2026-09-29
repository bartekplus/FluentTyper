import { closesAbbreviation } from "../implementations/CapitalizeSentenceStartRule";
import { MAX_REVIEW_CHARS } from "./reviewDiagnostics";
import type { ProtectedRange, ReviewSourceSnapshot, TextRange } from "./types";

export const DEFAULT_LONG_SENTENCE_WORDS = 35;

/** A preference, not a quality score. Invalid persisted values use the documented default. */
export function longSentenceThreshold(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 200
    ? value
    : DEFAULT_LONG_SENTENCE_WORDS;
}

/**
 * Fully visible English prose sentences only. No sentence is split or rewritten.
 * Scan the bounded source before applying the scope so cropped edges cannot look complete.
 */
export function longSentenceRanges(
  snapshot: ReviewSourceSnapshot,
  protectedRanges: readonly ProtectedRange[],
  threshold: number = DEFAULT_LONG_SENTENCE_WORDS,
): TextRange[] {
  const text = snapshot.text;
  if (snapshot.incomplete || text.length > MAX_REVIEW_CHARS) return [];
  const limit = longSentenceThreshold(threshold);
  const result: TextRange[] = [];
  // Lists are not prose sentences, even if ICU splits after their numeric marker.
  const blocked: TextRange[] = [
    ...protectedRanges.filter((range) => {
      // Dotted prose abbreviations remain literal words, not opaque technical content.
      return !(
        range.reason === "technical" &&
        /^(?:(?:e\.g|i\.e|U\.S|U\.K)\.?|\d+\.\d+)$/i.test(text.slice(range.start, range.end))
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
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  for (const segment of segmenter.segment(text)) {
    const start = pendingStart ?? segment.index;
    const trimmed = segment.segment.trimEnd();
    if (!trimmed) {
      pendingStart = undefined;
      ambiguous = false;
      continue;
    }
    const end = segment.index + trimmed.length;
    const ending = trimmed.match(/[.!?]["'”’»)\]]*$/u);
    const mark = ending ? segment.index + ending.index! : -1;
    if (
      mark < 0 &&
      /\r?\n/.test(segment.segment.slice(trimmed.length)) &&
      !/\r?\n[ \t]*\r?\n/.test(segment.segment)
    ) {
      pendingStart = start;
      continue;
    }
    if (mark >= 0 && text[mark] === "." && closesAbbreviation(text, mark, "en_US")) {
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
