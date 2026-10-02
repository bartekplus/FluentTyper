import type { ReviewTargetText, ReviewApplyResult } from "@core/application/review/ReviewSession";
import type { ReviewEdit } from "@core/domain/grammar/review/types";
import type { HostEditorApplyResult } from "./HostEditorAdapterResolver";
import type { LineEditorBlockContext } from "./HostEditorControllerUtils";
import {
  HOST_EDITOR_REQUEST_ATTR,
  HOST_EDITOR_REQUEST_EVENT,
  HOST_EDITOR_RESPONSE_ATTR,
} from "./HostEditorBridgeProtocol";

interface HostEditorBridgeApplyArgs {
  replaceStart: number;
  replaceEnd: number;
  replacementText: string;
  cursorAfter: number;
  expectedBlockText: string;
}

export interface HostEditorPageBridge {
  getBlockContextAtSelection(elem: HTMLElement): LineEditorBlockContext | null;
  applyBlockReplacement(elem: HTMLElement, args: HostEditorBridgeApplyArgs): HostEditorApplyResult;
}

export interface TinyMCEReplacement {
  before: string;
  prefix: string;
  selected: string;
  replacement: string;
}

type BridgeRequest =
  | ({ action: "applyTinyMCE" } & TinyMCEReplacement)
  | { action: "readProseMirror" }
  | {
      action: "applyProseMirror";
      edits: ReviewEdit[];
      before: string;
      after: string;
      signature: string;
    }
  | {
      action: "getBlockContext";
    }
  | ({
      action: "applyBlockReplacement";
    } & HostEditorBridgeApplyArgs);

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

export class InjectedHostEditorPageBridge implements HostEditorPageBridge {
  constructor(private readonly doc: Document = document) {}

  public applyTinyMCE(elem: HTMLElement, request: TinyMCEReplacement): HostEditorApplyResult {
    const response = this.dispatchRequest(elem, { action: "applyTinyMCE", ...request });
    return response?.ok && "result" in response
      ? response.result
      : { applied: false, didDispatchInput: false };
  }

  public readProseMirror(elem: HTMLElement): ReviewTargetText | null {
    const response = this.dispatchRequest(elem, { action: "readProseMirror" });
    return response?.ok && "snapshot" in response ? response.snapshot : null;
  }

  public applyProseMirror(
    elem: HTMLElement,
    request: {
      edits: ReviewEdit[];
      before: string;
      after: string;
      signature: string;
    },
  ): ReviewApplyResult {
    const response = this.dispatchRequest(elem, { action: "applyProseMirror", ...request });
    return response?.ok && "reviewResult" in response
      ? response.reviewResult
      : { status: "rejected", reason: "unsupported" };
  }

  public getBlockContextAtSelection(elem: HTMLElement): LineEditorBlockContext | null {
    const response = this.dispatchRequest(elem, { action: "getBlockContext" });
    if (!response || !response.ok || !("blockContext" in response)) {
      return null;
    }
    return response.blockContext;
  }

  public applyBlockReplacement(
    elem: HTMLElement,
    args: HostEditorBridgeApplyArgs,
  ): HostEditorApplyResult {
    const response = this.dispatchRequest(elem, {
      action: "applyBlockReplacement",
      ...args,
    });
    if (!response || !response.ok || !("result" in response)) {
      return { applied: false, didDispatchInput: false };
    }
    return response.result;
  }

  private dispatchRequest(elem: HTMLElement, request: BridgeRequest): BridgeResponse | null {
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
