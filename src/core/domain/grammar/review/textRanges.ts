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

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** A regional indicator (U+1F1E6..U+1F1FF) starts at `index`. */
function isRegionalIndicatorAt(text: string, index: number): boolean {
  const low = text.charCodeAt(index + 1);
  return text.charCodeAt(index) === 0xd83c && low >= 0xdde6 && low <= 0xddff;
}

/** Grapheme boundary test on a bounded local window (never segments a whole document). */
export function isGraphemeBoundary(text: string, index: number): boolean {
  if (!Number.isSafeInteger(index) || index < 0 || index > text.length) return false;
  if (index === 0 || index === text.length) return true;
  // A lone surrogate half is never a boundary; neither is a split pair.
  const code = text.charCodeAt(index);
  if (code >= 0xdc00 && code <= 0xdfff) return false;
  // Printable ASCII on both sides is always a boundary (no extenders, no CR LF).
  const previous = text.charCodeAt(index - 1);
  if (code >= 0x20 && code < 0x7f && previous >= 0x20 && previous < 0x7f) return true;
  let windowStart = Math.max(0, index - 32);
  // Never start inside a surrogate pair, and count flags (regional-indicator
  // pairs) from the start of their run, or a window could pair them wrongly.
  if (windowStart > 0 && isLowSurrogate(text.charCodeAt(windowStart))) windowStart -= 1;
  while (windowStart >= 2 && isRegionalIndicatorAt(text, windowStart - 2)) windowStart -= 2;
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
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const parts: string[] = [];
  let cursor = 0;
  let previous: ReviewEdit | null = null;
  for (const edit of sorted) {
    if (
      edit.start < cursor ||
      edit.end < edit.start ||
      edit.end > text.length ||
      text.slice(edit.start, edit.end) !== edit.original
    ) {
      return null;
    }
    // An insertion touching another edit has no defined order.
    if (
      previous &&
      previous.end === edit.start &&
      (previous.start === previous.end || edit.start === edit.end)
    ) {
      return null;
    }
    parts.push(text.slice(cursor, edit.start), edit.replacement);
    cursor = edit.end;
    previous = edit;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
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

/** Lengths of the longest common prefix and (non-overlapping) common suffix of a and b. */
export function commonAffixes(a: string, b: string): { prefix: number; suffix: number } {
  const maxPrefix = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < maxPrefix && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  return { prefix, suffix };
}

export function diffTexts(oldText: string, newText: string): TextDiff | null {
  if (oldText === newText) return null;
  const { prefix, suffix } = commonAffixes(oldText, newText);
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

/**
 * Several edits of `before` (giving `after`) as ONE contiguous replacement:
 * from the first edit's start to the last edit's end.
 */
export function mergeEdits(
  before: string,
  after: string,
  edits: readonly ReviewEdit[],
): { start: number; end: number; replacement: string } {
  const start = Math.min(...edits.map((edit) => edit.start));
  const end = Math.max(...edits.map((edit) => edit.end));
  return { start, end, replacement: after.slice(start, after.length - (before.length - end)) };
}

/** Where `position` lands after [start, end) is replaced: inside moves to the end of the new text. */
export function positionAfterReplacement(
  position: number,
  merged: { start: number; end: number; replacement: string },
): number {
  const { start, end, replacement } = merged;
  if (position <= start) return position;
  if (position >= end) return position + replacement.length - (end - start);
  return start + replacement.length;
}

/**
 * Maps a snapshot position to the text after `edits` (non-overlapping). An
 * insertion exactly at the position stays after it.
 */
export function positionMapper(edits: readonly ReviewEdit[]): (position: number) => number {
  const sorted = [...edits].sort((a, b) => a.end - b.end || a.start - b.start);
  const deltas: number[] = [0];
  for (const edit of sorted) {
    deltas.push(deltas[deltas.length - 1] + edit.replacement.length - (edit.end - edit.start));
  }
  return (position) => {
    // Edits ending at or before the position.
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle].end <= position) low = middle + 1;
      else high = middle;
    }
    let count = low;
    while (
      count > 0 &&
      sorted[count - 1].start === position &&
      sorted[count - 1].end === position
    ) {
      count -= 1;
    }
    return position + deltas[count];
  };
}

/**
 * `range` carried through exact, non-overlapping `edits` of its text, or null
 * when an edit touches it (overlaps or borders it).
 */
export function remapRangeThroughEdits(
  range: TextRange,
  edits: readonly ReviewEdit[],
  map: (position: number) => number = positionMapper(edits),
): TextRange | null {
  if (edits.some((edit) => edit.start <= range.end && edit.end >= range.start)) return null;
  return { start: map(range.start), end: map(range.end) };
}
