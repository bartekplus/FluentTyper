import type { ReviewEdit } from "@core/domain/grammar/review/types";
import { applyEdits } from "@core/domain/grammar/review/textRanges";
import { offsetRangeToDomRange, type ContentEditableTextMap } from "./ContentEditableTextMap";

/**
 * Prepare only the changed range off-document: one native replacement of the
 * smallest range that holds the edits. The live editor is never rebuilt.
 */
export function prepareNativeReviewTransaction(
  root: HTMLElement,
  map: ContentEditableTextMap,
  edits: readonly ReviewEdit[],
): { range: Range; value: string } | null {
  if (!edits.length || applyEdits(map.text, edits) === null) return null;
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const ranges = sorted.map((edit) => offsetRangeToDomRange(map, edit, root.ownerDocument));
  if (
    ranges.some(
      (range, index) =>
        !range ||
        range.startContainer.nodeType !== 3 ||
        range.startContainer !== range.endContainer ||
        range.toString() !== sorted[index].original,
    )
  )
    return null;
  const valid = ranges as Range[];
  const range = valid[0].cloneRange();
  const last = valid[valid.length - 1];
  range.setEnd(last.endContainer, last.endOffset);
  // HTML serialization cannot retain listeners, expandos or host-owned state.
  // A batch must stay inside one existing Text node, preserving every element.
  if (range.startContainer !== range.endContainer) return null;
  const start = range.startOffset;
  const value = applyEdits(
    range.toString(),
    sorted.map((edit, index) => ({
      ...edit,
      start: valid[index].startOffset - start,
      end: valid[index].endOffset - start,
    })),
  );
  return value === null ? null : { range, value };
}
