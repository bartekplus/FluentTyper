import type { ReviewTargetRead, ReviewApplyResult } from "@core/application/review/ReviewSession";
import type { ReviewEdit, TextRange } from "@core/domain/grammar/review/types";

export const WORD_REVIEW_EVENT = "fluenttyper:word-review";
export const WORD_REVIEW_RESPONSE = "data-ft-word-review-response";
// Covers 200k escaped characters, 200k protection ranges and 10k bounded identifiers.
export const WORD_REVIEW_MAX_MESSAGE = 20_000_000;
export const WORD_INPUT_ID = "WACViewPanel_EditingElement";

export type WordReviewRequest =
  | { action: "read"; selection: boolean }
  | { action: "matches-selection" }
  | {
      action: "apply";
      token: string;
      before: string;
      after: string;
      signature: string;
      edits: ReviewEdit[];
    }
  | { action: "close" };

export type WordReviewSnapshot = Extract<ReviewTargetRead, { ok: true }> & {
  token: string;
  selection: TextRange | null;
  bodyType: number | null;
  headerFooter: "Header" | "Footer" | null;
};
export type WordReviewReply =
  | WordReviewSnapshot
  | Extract<ReviewTargetRead, { ok: false }>
  | ReviewApplyResult
  | { matchesSelection: boolean };

/** Word's input proxy and rendered pages belong to one model-backed editor. */
export function wordEditor(doc: Document): HTMLElement | null {
  const root = doc.getElementById("WACViewPanel");
  return root?.contains(doc.getElementById(WORD_INPUT_ID)) && root.closest("#EditorContainer")
    ? root.closest<HTMLElement>("#EditorContainer")
    : null;
}
