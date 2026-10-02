import type { ReviewEdit } from "@core/domain/grammar/review/types";
import {
  minimalEdits,
  isGraphemeBoundary,
  editTouches,
} from "@core/domain/grammar/review/textRanges";
import { segmentContaining, type ContentEditableTextMap } from "./ContentEditableTextMap";

export function formattingAt(map: ContentEditableTextMap, offset: number): string | null {
  const segment = segmentContaining(map, offset);
  return segment?.formatting ?? null;
}

/** Keep each grapheme's formatting when replacement lengths align. Otherwise the
 * changed span must have one mark set; refusing ambiguity happens before any write.
 */
export function formattingPreservingEdits(
  map: ContentEditableTextMap,
  edits: readonly ReviewEdit[],
): ReviewEdit[] | null {
  if (
    edits.some(
      (edit) =>
        !isGraphemeBoundary(map.text, edit.start) ||
        !isGraphemeBoundary(map.text, edit.end) ||
        map.protectedRanges.some((range) => editTouches(edit, range)),
    )
  )
    return null;
  const result: ReviewEdit[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const edit of edits.flatMap((edit) =>
    minimalEdits(map.text, edit.start, edit.end, edit.replacement),
  )) {
    const original = [...segmenter.segment(edit.original)];
    const replacement = [...segmenter.segment(edit.replacement)];
    const parts: ReviewEdit[] =
      original.length === replacement.length
        ? original.flatMap((part, index) =>
            part.segment === replacement[index].segment
              ? []
              : [
                  {
                    start: edit.start + part.index,
                    end: edit.start + part.index + part.segment.length,
                    original: part.segment,
                    replacement: replacement[index].segment,
                  },
                ],
          )
        : [edit];
    for (const part of parts) {
      const style = formattingAt(map, part.start);
      for (let at = part.start; part.replacement && at < part.end;) {
        const segment = segmentContaining(map, at);
        if (!segment || segment.formatting !== style) return null;
        at = segment.end;
      }
      const last = result.at(-1);
      if (
        last &&
        last.end === part.start &&
        formattingAt(map, last.start) === formattingAt(map, part.start)
      ) {
        last.end = part.end;
        last.original += part.original;
        last.replacement += part.replacement;
      } else result.push({ ...part });
    }
  }
  return result;
}

/** Expected style runs after the known edits. Virtual separators are not text runs. */
export function expectedFormatting(
  map: ContentEditableTextMap,
  edits: readonly ReviewEdit[],
): string {
  const runs: [string, number][] = [];
  const append = (key: string, length: number) => {
    if (!length) return;
    const last = runs.at(-1);
    if (last?.[0] === key) last[1] += length;
    else runs.push([key, length]);
  };
  let segmentIndex = 0;
  const unchanged = (start: number, end: number) => {
    while (segmentIndex < map.segments.length) {
      const segment = map.segments[segmentIndex];
      if (segment.start >= end) break;
      const length = Math.min(end, segment.end) - Math.max(start, segment.start);
      if (length > 0) append(segment.formatting, length);
      if (segment.end > end) break;
      segmentIndex += 1;
    }
  };
  let start = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    unchanged(start, edit.start);
    if (edit.replacement) append(formattingAt(map, edit.start) ?? "", edit.replacement.length);
    start = edit.end;
  }
  unchanged(start, map.text.length);
  return JSON.stringify(runs);
}

/** Formatting before the next descending edit must remain exactly as scanned. */
export function formattingBefore(map: ContentEditableTextMap, limit: number): string {
  const runs: [number, number, string][] = [];
  for (const segment of map.segments) {
    if (segment.start >= limit) break;
    const end = Math.min(segment.end, limit);
    const last = runs.at(-1);
    if (last?.[1] === segment.start && last[2] === segment.formatting) last[1] = end;
    else runs.push([segment.start, end, segment.formatting]);
  }
  return JSON.stringify(runs);
}
