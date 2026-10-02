import { TextTargetAdapter } from "./TextTargetAdapter";
import { InjectedHostEditorPageBridge, type HostEditorPageBridge } from "./HostEditorPageBridge";
import {
  findLineEditorController,
  readLineEditorBlockContext,
  readLineEditorCursor,
  syncBackingSelection,
  type LineEditorBlockContext,
  type LineEditorController,
} from "./HostEditorControllerUtils";
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
  constructor(
    private readonly pageBridge: HostEditorPageBridge = new InjectedHostEditorPageBridge(),
  ) {}

  public resolve(elem: HTMLElement): HostEditorSession | null {
    if (!elem.isContentEditable) {
      return null;
    }

    // The backing target is looked up last: the page bridge runs host code
    // that may still be creating it.
    const controller = findLineEditorController(elem);
    if (controller) {
      return new LineEditorHostSession(
        elem,
        controller,
        TextTargetAdapter.findBackingTextValueTarget(elem),
      );
    }
    const bridgedBlockContext = this.pageBridge.getBlockContextAtSelection(elem);
    return bridgedBlockContext
      ? new BridgedLineEditorHostSession(
          elem,
          this.pageBridge,
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

  public applyBlockReplacement({
    replaceStart,
    replaceEnd,
    replacementText,
    cursorAfter,
    expectedBlockText,
  }: BlockReplacementArgs): HostEditorApplyResult {
    return this.pageBridge.applyBlockReplacement(this.elem, {
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
      expectedBlockText: expectedBlockText ?? this.expectedBlockText,
    });
  }

  public createPostEditFingerprint(): PostEditFingerprint {
    return TextTargetAdapter.createPostEditFingerprint(this.backingTarget ?? this.elem);
  }
}

class LineEditorHostSession implements HostEditorSession {
  constructor(
    private readonly elem: HTMLElement,
    private readonly controller: LineEditorController,
    private readonly backingTarget: HTMLInputElement | HTMLTextAreaElement | null,
  ) {
    this.expectedCursor = readLineEditorCursor(controller);
    this.expectedBlockText = this.expectedCursor
      ? controller.getLine(this.expectedCursor.line)
      : null;
  }

  private readonly expectedCursor: ReturnType<typeof readLineEditorCursor>;
  private readonly expectedBlockText: string | null;

  public getBlockContextAtSelection(): LineEditorBlockContext | null {
    return readLineEditorBlockContext(this.controller);
  }

  public applyBlockReplacement({
    replaceStart,
    replaceEnd,
    replacementText,
    cursorAfter,
    expectedBlockText,
  }: BlockReplacementArgs): HostEditorApplyResult {
    // FT-INV-1: a synchronous host callback can still change line or text.
    const cursor = readLineEditorCursor(this.controller);
    if (!cursor) {
      return { applied: false, didDispatchInput: false };
    }
    const blockText = this.controller.getLine(cursor.line);
    if (
      cursor.line !== this.expectedCursor?.line ||
      blockText !== (expectedBlockText ?? this.expectedBlockText) ||
      typeof blockText !== "string" ||
      replaceStart < 0 ||
      replaceEnd < replaceStart ||
      replaceEnd > blockText.length ||
      cursorAfter < 0 ||
      cursorAfter > blockText.length - (replaceEnd - replaceStart) + replacementText.length
    ) {
      return { applied: false, didDispatchInput: false };
    }

    const from = { line: cursor.line, ch: replaceStart };
    const to = { line: cursor.line, ch: replaceEnd };
    const selection = { line: cursor.line, ch: cursorAfter };

    const run = () => {
      this.controller.replaceRange(replacementText, from, to, "+input");
      this.controller.setCursor(selection);
    };

    if (typeof this.controller.operation === "function") {
      this.controller.operation(run);
    } else {
      run();
    }

    syncBackingSelection(this.controller, this.backingTarget, selection);
    this.controller.focus?.();

    return { applied: true, didDispatchInput: false };
  }

  public createPostEditFingerprint(): PostEditFingerprint {
    return TextTargetAdapter.createPostEditFingerprint(this.backingTarget ?? this.elem);
  }
}
