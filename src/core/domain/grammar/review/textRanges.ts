import type { ReviewEdit, TextRange } from "./types";

/** True when two ranges share at least one code unit. */
export function rangesOverlap(a: TextRange, b: TextRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * True when `edit` would touch `range`: overlaps it, or (for an insertion)
 * lands on or inside it. Inserting at a boundary of a protected range is
 * ambiguous (which side's formatting wins), so it counts as touching.
 */
export function editTouches(edit: TextRange, range: TextRange): boolean {
  if (edit.start === edit.end) return edit.start >= range.start && edit.start <= range.end;
  return rangesOverlap(edit, range);
}

let segmenter: Intl.Segmenter | undefined;

/** Grapheme boundary test on a bounded local window (never segments a whole document). */
export function isGraphemeBoundary(text: string, index: number): boolean {
  if (!Number.isSafeInteger(index) || index < 0 || index > text.length) return false;
  if (index === 0 || index === text.length) return true;
  // A lone surrogate half is never a boundary; neither is a split pair.
  const code = text.charCodeAt(index);
  if (code >= 0xdc00 && code <= 0xdfff) return false;
  const windowStart = Math.max(0, index - 32);
  const local = text.slice(windowStart, Math.min(text.length, index + 32));
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
    // Without a segmenter, refuse to split before a combining mark or joiner.
    return !/^(?:\p{M}|\u200d|\ufe0f)/u.test(text.slice(index, index + 1));
  }
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const localIndex = index - windowStart;
  // Iterate rather than use containing(): JavaScriptCore's containing() is wrong
  // after astral characters, and the window is bounded anyway.
  for (const segment of segmenter.segment(local)) {
    if (segment.index >= localIndex) return segment.index === localIndex;
  }
  return false;
}

/** Applies non-overlapping edits to `text`, or returns null when they overlap or are invalid. */
export function applyEdits(text: string, edits: readonly ReviewEdit[]): string | null {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let result = text;
  let limit = text.length;
  for (const edit of sorted) {
    if (
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > limit ||
      text.slice(edit.start, edit.end) !== edit.original
    ) {
      return null;
    }
    // Two insertions at one point have no defined order.
    if (edit.start === edit.end && edit.end === limit && limit !== text.length) return null;
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    limit = edit.start;
  }
  return result;
}

/**
 * The single contiguous change between two texts. A change inside a run of
 * repeated characters can be placed anywhere in that run ("aa" -> "aaa");
 * `slack` is the span over which that placement is ambiguous, so callers can
 * refuse to guess which side of a boundary it fell on.
 */
export interface TextDiff {
  start: number;
  /** End of the replaced part in the old text. */
  oldEnd: number;
  /** End of the inserted part in the new text. */
  newEnd: number;
  /** Earliest start the same change could have had. */
  slackStart: number;
}

export function diffTexts(oldText: string, newText: string): TextDiff | null {
  if (oldText === newText) return null;
  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) ===
      newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  // Suffix-first placement gives the earliest possible start.
  let suffixFirst = 0;
  while (
    suffixFirst < Math.min(oldText.length, newText.length) &&
    oldText.charCodeAt(oldText.length - 1 - suffixFirst) ===
      newText.charCodeAt(newText.length - 1 - suffixFirst)
  ) {
    suffixFirst += 1;
  }
  const slackStart = Math.max(
    0,
    Math.min(prefix, Math.min(oldText.length, newText.length) - suffixFirst),
  );
  return {
    start: prefix,
    oldEnd: oldText.length - suffix,
    newEnd: newText.length - suffix,
    slackStart,
  };
}

/**
 * Carries a finding's range through a diff. The change may sit anywhere in
 * [slackStart, oldEnd]; any overlap with the range, or contact with either of
 * its ends, returns null (the text around the finding changed).
 */
export function remapRange(range: TextRange, diff: TextDiff): TextRange | null {
  const delta = diff.newEnd - diff.oldEnd;
  if (diff.slackStart > range.end) return range;
  if (diff.oldEnd < range.start) return { start: range.start + delta, end: range.end + delta };
  return null;
}

/**
 * Carries a scope (which may legitimately grow or shrink) through a diff that
 * lies strictly inside it or strictly outside it. A change straddling a
 * boundary, or an insertion exactly on one (it could belong to either side),
 * returns null: the caller invalidates the scope instead of guessing.
 */
export function remapScope(scope: TextRange, diff: TextDiff): TextRange | null {
  const delta = diff.newEnd - diff.oldEnd;
  const isInsertion = diff.oldEnd === diff.start;
  const exact = diff.slackStart === diff.start;
  if (diff.oldEnd < scope.start || (!isInsertion && diff.oldEnd === scope.start)) {
    return { start: scope.start + delta, end: scope.end + delta };
  }
  if (diff.slackStart > scope.end || (!isInsertion && exact && diff.start === scope.end)) {
    return scope;
  }
  const strictlyInside = diff.slackStart > scope.start && diff.oldEnd < scope.end;
  const replacementInside =
    !isInsertion && exact && diff.start >= scope.start && diff.oldEnd <= scope.end;
  if (strictlyInside || replacementInside) {
    return { start: scope.start, end: scope.end + delta };
  }
  return null;
}
