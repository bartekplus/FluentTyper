import type { ReviewEdit } from "@core/domain/grammar/review/types";

export const HOST_EDITOR_REQUEST_EVENT = "ft-host-editor-request";
export const HOST_EDITOR_REQUEST_ATTR = "data-ft-host-editor-request";
export const HOST_EDITOR_RESPONSE_ATTR = "data-ft-host-editor-response";
export const HOST_EDITOR_MAIN_WORLD_FLAG = "__ftHostEditorBridgeInstalled";
export const CURSOR_MOVE_EVENT = "ft-cursor-move";
export const CURSOR_MOVE_COUNT_ATTR = "data-ft-cursor-move-count";
export const HOST_EDITOR_ENABLED_EVENT = "ft-host-editor-enabled";
export const HOST_EDITOR_ENABLED_ATTR = "data-ft-host-editor-enabled";

export const NOT_APPLIED = { applied: false, didDispatchInput: false };

/** Editors whose typing edits are written by their Review model adapter. */
export const MODEL_TYPING_SELECTOR = "trix-editor, .public-DraftEditor-content";

export interface DomEditorReplacement {
  before: string;
  prefix: string;
  selected: string;
  replacement: string;
}

export interface HostEditorReviewApplyRequest {
  edits: ReviewEdit[];
  before: string;
  after: string;
  signature: string;
}

export interface HostEditorBlockReplacement {
  replaceStart: number;
  replaceEnd: number;
  replacementText: string;
  cursorAfter: number;
  expectedBlockText: string;
}

export type HostEditorBridgeRequest =
  | ({ action: "applyDomEditor" } & DomEditorReplacement)
  | {
      action:
        | "readProseMirror"
        | "readQuill"
        | "readSlate"
        | "readGutenberg"
        | "readGutenbergSelection"
        | "readReviewModel";
    }
  | ({
      action:
        "applyProseMirror" | "applyQuill" | "applySlate" | "applyGutenberg" | "applyReviewModel";
    } & HostEditorReviewApplyRequest)
  | { action: "reviewTransaction"; phase: "probe" | "begin" | "end" }
  | { action: "quillHistoryBoundary" }
  | { action: "getBlockContext" }
  | ({ action: "applyBlockReplacement" } & HostEditorBlockReplacement);
