import type { ReviewTargetText, ReviewApplyResult } from "@core/application/review/ReviewSession";
import type { HostEditorApplyResult } from "./HostEditorAdapterResolver";
import type { LineEditorBlockContext } from "./HostEditorControllerUtils";
import type { GutenbergSnapshot } from "./GutenbergEditor";
import {
  HOST_EDITOR_REQUEST_ATTR,
  HOST_EDITOR_REQUEST_EVENT,
  HOST_EDITOR_RESPONSE_ATTR,
  NOT_APPLIED,
  type HostEditorBlockReplacement,
  type HostEditorBridgeRequest,
  type HostEditorReviewApplyRequest,
  type DomEditorReplacement,
} from "./HostEditorBridgeProtocol";

/** The part of the bridge that typing sessions use (tests pass a fake). */
export type HostEditorPageBridge = Pick<
  InjectedHostEditorPageBridge,
  "getBlockContextAtSelection" | "applyBlockReplacement"
>;

type BridgeResponse =
  | { ok: true; snapshot: ReviewTargetText }
  | { ok: true; reviewResult: ReviewApplyResult }
  | {
      ok: true;
      blockContext: LineEditorBlockContext;
    }
  | {
      ok: true;
      result: HostEditorApplyResult;
    }
  | {
      ok: false;
    };

export class InjectedHostEditorPageBridge {
  constructor(private readonly doc: Document = document) {}

  public readGutenberg(elem: HTMLElement, captureSelection = false): GutenbergSnapshot | null {
    const response = this.dispatchRequest(elem, {
      action: captureSelection ? "readGutenbergSelection" : "readGutenberg",
    });
    return response?.ok && "snapshot" in response ? (response.snapshot as GutenbergSnapshot) : null;
  }

  public applyGutenberg(
    elem: HTMLElement,
    request: HostEditorReviewApplyRequest,
  ): ReviewApplyResult {
    const response = this.dispatchRequest(elem, { action: "applyGutenberg", ...request });
    return response?.ok && "reviewResult" in response
      ? response.reviewResult
      : { status: "rejected", reason: "unsupported" };
  }

  public applyDomEditor(elem: HTMLElement, request: DomEditorReplacement): HostEditorApplyResult {
    const response = this.dispatchRequest(elem, { action: "applyDomEditor", ...request });
    return response?.ok && "result" in response ? response.result : NOT_APPLIED;
  }

  public readProseMirror(elem: HTMLElement): ReviewTargetText | null {
    const response = this.dispatchRequest(elem, { action: "readProseMirror" });
    return response?.ok && "snapshot" in response ? response.snapshot : null;
  }

  public applyProseMirror(
    elem: HTMLElement,
    request: HostEditorReviewApplyRequest,
  ): ReviewApplyResult {
    const response = this.dispatchRequest(elem, { action: "applyProseMirror", ...request });
    return response?.ok && "reviewResult" in response
      ? response.reviewResult
      : { status: "rejected", reason: "unsupported" };
  }

  public readQuill(elem: HTMLElement): ReviewTargetText | null {
    const response = this.dispatchRequest(elem, { action: "readQuill" });
    return response?.ok && "snapshot" in response ? response.snapshot : null;
  }

  public applyQuill(elem: HTMLElement, request: HostEditorReviewApplyRequest): ReviewApplyResult {
    const response = this.dispatchRequest(elem, { action: "applyQuill", ...request });
    return response?.ok && "reviewResult" in response
      ? response.reviewResult
      : { status: "rejected", reason: "unsupported" };
  }

  /** Starts a new Quill undo step; see quillHistoryBoundary in QuillEditor.ts. */
  public quillHistoryBoundary(elem: HTMLElement): boolean {
    const response = this.dispatchRequest(elem, { action: "quillHistoryBoundary" });
    return !!(response?.ok && "result" in response && response.result.applied);
  }

  public readSlate(elem: HTMLElement): ReviewTargetText | null {
    const response = this.dispatchRequest(elem, { action: "readSlate" });
    return response?.ok && "snapshot" in response ? response.snapshot : null;
  }

  public applySlate(elem: HTMLElement, request: HostEditorReviewApplyRequest): ReviewApplyResult {
    const response = this.dispatchRequest(elem, { action: "applySlate", ...request });
    return response?.ok && "reviewResult" in response
      ? response.reviewResult
      : { status: "rejected", reason: "unsupported" };
  }

  /** Lexical, Draft.js, CKEditor 5 or Trix text, verified against the editor's model. */
  public readReviewModel(elem: HTMLElement): ReviewTargetText | null {
    const response = this.dispatchRequest(elem, { action: "readReviewModel" });
    return response?.ok && "snapshot" in response ? response.snapshot : null;
  }

  public applyReviewModel(
    elem: HTMLElement,
    request: HostEditorReviewApplyRequest,
  ): ReviewApplyResult {
    const response = this.dispatchRequest(elem, { action: "applyReviewModel", ...request });
    return response?.ok && "reviewResult" in response
      ? response.reviewResult
      : { status: "rejected", reason: "unsupported" };
  }

  /**
   * TinyMCE, CKEditor 4, Froala, Summernote or RoosterJS: "probe" finds a writable
   * editor, "begin" and "end" enclose a native Review edit in one host undo step.
   * "identify" finds the editor also when it has no writable instance.
   */
  public reviewTransaction(
    elem: HTMLElement,
    phase: "probe" | "begin" | "end" | "identify",
  ): boolean {
    const response = this.dispatchRequest(elem, { action: "reviewTransaction", phase });
    return !!(response?.ok && "result" in response && response.result.applied);
  }

  public getBlockContextAtSelection(elem: HTMLElement): LineEditorBlockContext | null {
    const response = this.dispatchRequest(elem, { action: "getBlockContext" });
    return response?.ok && "blockContext" in response ? response.blockContext : null;
  }

  public applyBlockReplacement(
    elem: HTMLElement,
    args: HostEditorBlockReplacement,
  ): HostEditorApplyResult {
    const response = this.dispatchRequest(elem, {
      action: "applyBlockReplacement",
      ...args,
    });
    return response?.ok && "result" in response ? response.result : NOT_APPLIED;
  }

  private dispatchRequest(
    elem: HTMLElement,
    request: HostEditorBridgeRequest,
  ): BridgeResponse | null {
    try {
      elem.removeAttribute(HOST_EDITOR_RESPONSE_ATTR);
      elem.setAttribute(HOST_EDITOR_REQUEST_ATTR, JSON.stringify(request));
      elem.dispatchEvent(
        new this.doc.defaultView!.CustomEvent(HOST_EDITOR_REQUEST_EVENT, {
          bubbles: true,
          composed: true,
        }),
      );
      const rawResponse = elem.getAttribute(HOST_EDITOR_RESPONSE_ATTR);
      if (!rawResponse) {
        return null;
      }
      return JSON.parse(rawResponse) as BridgeResponse;
    } catch {
      return null;
    } finally {
      elem.removeAttribute(HOST_EDITOR_REQUEST_ATTR);
      elem.removeAttribute(HOST_EDITOR_RESPONSE_ATTR);
    }
  }
}
