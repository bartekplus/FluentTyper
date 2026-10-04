import { TextTargetAdapter } from "./TextTargetAdapter";
import { InjectedHostEditorPageBridge, type HostEditorPageBridge } from "./HostEditorPageBridge";
import type { LineEditorBlockContext } from "./HostEditorControllerUtils";
import type { PostEditFingerprint } from "./types";

export interface HostEditorApplyResult {
  applied: boolean;
  didDispatchInput: boolean;
  /** A host transaction landed but could not be verified; never retry it. */
  unverified?: boolean;
}

export interface HostEditorSession {
  getBlockContextAtSelection(): LineEditorBlockContext | null;
  applyBlockReplacement(args: {
    replaceStart: number;
    replaceEnd: number;
    replacementText: string;
    cursorAfter: number;
    /** Expected pre-edit host text; mismatches are refused, never reconstructed. */
    expectedBlockText?: string;
  }): HostEditorApplyResult;
  createPostEditFingerprint(): PostEditFingerprint;
}

type BlockReplacementArgs = Parameters<HostEditorSession["applyBlockReplacement"]>[0];

export class HostEditorAdapterResolver {
  constructor(private readonly pageBridge?: HostEditorPageBridge) {}

  public resolve(elem: HTMLElement): HostEditorSession | null {
    if (!elem.isContentEditable) {
      return null;
    }

    // The host controller is a page expando, visible only in the MAIN world, so
    // the page bridge reads it. The bridge of the element's own document is used,
    // because the element can be in an editor canvas frame. The backing target is
    // looked up last: the page bridge runs host code that may still be creating it.
    const pageBridge = this.pageBridge ?? new InjectedHostEditorPageBridge(elem.ownerDocument);
    const bridgedBlockContext = pageBridge.getBlockContextAtSelection(elem);
    return bridgedBlockContext
      ? new BridgedLineEditorHostSession(
          elem,
          pageBridge,
          bridgedBlockContext.blockText,
          TextTargetAdapter.findBackingTextValueTarget(elem),
        )
      : null;
  }
}

class BridgedLineEditorHostSession implements HostEditorSession {
  constructor(
    private readonly elem: HTMLElement,
    private readonly pageBridge: HostEditorPageBridge,
    private readonly expectedBlockText: string,
    private readonly backingTarget: HTMLInputElement | HTMLTextAreaElement | null,
  ) {}

  public getBlockContextAtSelection(): LineEditorBlockContext | null {
    return this.pageBridge.getBlockContextAtSelection(this.elem);
  }

  public applyBlockReplacement(args: BlockReplacementArgs): HostEditorApplyResult {
    return this.pageBridge.applyBlockReplacement(this.elem, {
      ...args,
      expectedBlockText: args.expectedBlockText ?? this.expectedBlockText,
    });
  }

  public createPostEditFingerprint(): PostEditFingerprint {
    return TextTargetAdapter.createPostEditFingerprint(this.backingTarget ?? this.elem);
  }
}
