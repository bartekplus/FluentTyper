import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import { InjectedHostEditorPageBridge, type HostEditorPageBridge } from "./HostEditorPageBridge";
import {
  isLineEditorController,
  readLineEditorBlockContext,
  readLineEditorCursor,
  type LineEditorController,
  type LineEditorCursor,
} from "./HostEditorControllerUtils";
import type { PostEditFingerprint } from "./types";

export interface HostEditorBlockContext {
  beforeCursor: string;
  afterCursor: string;
  blockText: string;
}

export interface HostEditorApplyResult {
  applied: boolean;
  didDispatchInput: boolean;
}

export interface HostEditorSession {
  getBlockContextAtSelection(): HostEditorBlockContext | null;
  applyBlockReplacement(args: {
    replaceStart: number;
    replaceEnd: number;
    replacementText: string;
    cursorAfter: number;
  }): HostEditorApplyResult;
  createPostEditFingerprint(): PostEditFingerprint;
}

export class HostEditorAdapterResolver {
  constructor(
    private readonly pageBridge: HostEditorPageBridge = new InjectedHostEditorPageBridge(),
  ) {}

  public resolve(elem: HTMLElement): HostEditorSession | null {
    if (!elem.isContentEditable) {
      return null;
    }

    const controller = this.findLineEditorController(elem);
    if (!controller) {
      const bridgedBlockContext = this.pageBridge.getBlockContextAtSelection(elem);
      if (!bridgedBlockContext) {
        return null;
      }

      return new BridgedLineEditorHostSession(
        elem,
        this.pageBridge,
        bridgedBlockContext.blockText,
        TextTargetAdapter.findBackingTextValueTarget(elem),
      );
    }

    return new LineEditorHostSession(
      elem,
      controller,
      TextTargetAdapter.findBackingTextValueTarget(elem),
    );
  }

  private findLineEditorController(elem: HTMLElement): LineEditorController | null {
    let current: HTMLElement | null = elem;
    while (current) {
      const controller = this.findControllerOnElement(current);
      if (controller) {
        return controller;
      }
      current = current.parentElement;
    }
    return null;
  }

  private findControllerOnElement(elem: HTMLElement): LineEditorController | null {
    for (const key of Object.getOwnPropertyNames(elem)) {
      let value: unknown;
      try {
        value = (elem as unknown as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      if (isLineEditorController(value)) {
        return value;
      }
    }
    return null;
  }
}

class BridgedLineEditorHostSession implements HostEditorSession {
  constructor(
    private readonly elem: HTMLElement,
    private readonly pageBridge: HostEditorPageBridge,
    private readonly expectedBlockText: string,
    private readonly backingTarget: HTMLInputElement | HTMLTextAreaElement | null,
  ) {}

  public getBlockContextAtSelection(): HostEditorBlockContext | null {
    return this.pageBridge.getBlockContextAtSelection(this.elem);
  }

  public applyBlockReplacement({
    replaceStart,
    replaceEnd,
    replacementText,
    cursorAfter,
  }: {
    replaceStart: number;
    replaceEnd: number;
    replacementText: string;
    cursorAfter: number;
  }): HostEditorApplyResult {
    return this.pageBridge.applyBlockReplacement(this.elem, {
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
      expectedBlockText: this.expectedBlockText,
    });
  }

  public createPostEditFingerprint(): PostEditFingerprint {
    const target = (this.backingTarget ?? this.elem) as TextTarget;
    return TextTargetAdapter.createPostEditFingerprint(target);
  }
}

class LineEditorHostSession implements HostEditorSession {
  constructor(
    private readonly elem: HTMLElement,
    private readonly controller: LineEditorController,
    private readonly backingTarget: HTMLInputElement | HTMLTextAreaElement | null,
  ) {}

  public getBlockContextAtSelection(): HostEditorBlockContext | null {
    return readLineEditorBlockContext(this.controller);
  }

  public applyBlockReplacement({
    replaceStart,
    replaceEnd,
    replacementText,
    cursorAfter,
  }: {
    replaceStart: number;
    replaceEnd: number;
    replacementText: string;
    cursorAfter: number;
  }): HostEditorApplyResult {
    const cursor = this.readCursor();
    if (!cursor) {
      return { applied: false, didDispatchInput: false };
    }
    const blockText = this.controller.getLine(cursor.line);
    if (
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

    this.syncBackingSelection(selection);
    this.controller.focus?.();

    return { applied: true, didDispatchInput: false };
  }

  public createPostEditFingerprint(): PostEditFingerprint {
    const target = (this.backingTarget ?? this.elem) as TextTarget;
    return TextTargetAdapter.createPostEditFingerprint(target);
  }

  private readCursor(): LineEditorCursor | null {
    return readLineEditorCursor(this.controller);
  }

  private syncBackingSelection(position: LineEditorCursor): void {
    const target = this.backingTarget;
    if (!target) {
      return;
    }
    const absoluteIndex = this.controller.indexFromPos(position);
    if (!Number.isFinite(absoluteIndex)) {
      return;
    }
    const selectionIndex = Math.max(0, Math.trunc(absoluteIndex));
    if (selectionIndex > target.value.length) {
      return;
    }
    try {
      target.setSelectionRange(selectionIndex, selectionIndex);
    } catch {
      // Ignore selection sync failures on host-owned hidden inputs.
    }
  }
}
