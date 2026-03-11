import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import { InjectedHostEditorPageBridge, type HostEditorPageBridge } from "./HostEditorPageBridge";
import type { PostEditFingerprint } from "./types";

interface LineEditorCursor {
  line: number;
  ch: number;
}

interface LineEditorController {
  replaceRange(
    replacementText: string,
    from: LineEditorCursor,
    to?: LineEditorCursor,
    origin?: string,
  ): void;
  setCursor(position: LineEditorCursor): void;
  getCursor(): LineEditorCursor;
  getLine(line: number): string;
  posFromIndex(index: number): LineEditorCursor;
  indexFromPos(position: LineEditorCursor): number;
  operation?(callback: () => void): void;
  focus?(): void;
}

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
      if (this.isLineEditorController(value)) {
        return value;
      }
    }
    return null;
  }

  private isLineEditorController(value: unknown): value is LineEditorController {
    if (!value || typeof value !== "object") {
      return false;
    }
    const candidate = value as Partial<LineEditorController>;
    return (
      typeof candidate.replaceRange === "function" &&
      typeof candidate.setCursor === "function" &&
      typeof candidate.getCursor === "function" &&
      typeof candidate.getLine === "function" &&
      typeof candidate.posFromIndex === "function" &&
      typeof candidate.indexFromPos === "function"
    );
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
    const cursor = this.readCursor();
    if (!cursor) {
      return null;
    }
    const blockText = this.controller.getLine(cursor.line);
    if (typeof blockText !== "string" || cursor.ch < 0 || cursor.ch > blockText.length) {
      return null;
    }
    return {
      beforeCursor: blockText.slice(0, cursor.ch),
      afterCursor: blockText.slice(cursor.ch),
      blockText,
    };
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
    const cursor = this.controller.getCursor();
    if (
      !cursor ||
      typeof cursor !== "object" ||
      typeof cursor.line !== "number" ||
      typeof cursor.ch !== "number" ||
      !Number.isFinite(cursor.line) ||
      !Number.isFinite(cursor.ch)
    ) {
      return null;
    }
    return {
      line: Math.max(0, Math.trunc(cursor.line)),
      ch: Math.max(0, Math.trunc(cursor.ch)),
    };
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
