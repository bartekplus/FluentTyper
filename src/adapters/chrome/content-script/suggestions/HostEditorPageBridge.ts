import type { HostEditorApplyResult } from "./HostEditorAdapterResolver";
import {
  HOST_EDITOR_REQUEST_ATTR,
  HOST_EDITOR_REQUEST_EVENT,
  HOST_EDITOR_RESPONSE_ATTR,
} from "./HostEditorBridgeProtocol";

export interface HostEditorBridgeBlockContext {
  beforeCursor: string;
  afterCursor: string;
  blockText: string;
}

export interface HostEditorBridgeApplyArgs {
  replaceStart: number;
  replaceEnd: number;
  replacementText: string;
  cursorAfter: number;
  expectedBlockText: string;
}

export interface HostEditorPageBridge {
  getBlockContextAtSelection(elem: HTMLElement): HostEditorBridgeBlockContext | null;
  applyBlockReplacement(elem: HTMLElement, args: HostEditorBridgeApplyArgs): HostEditorApplyResult;
}

type BridgeRequest =
  | {
      action: "getBlockContext";
    }
  | ({
      action: "applyBlockReplacement";
    } & HostEditorBridgeApplyArgs);

type BridgeResponse =
  | {
      ok: true;
      blockContext: HostEditorBridgeBlockContext;
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

  public getBlockContextAtSelection(elem: HTMLElement): HostEditorBridgeBlockContext | null {
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
