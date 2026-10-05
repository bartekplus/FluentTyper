import type { HostEditorBlockReplacement } from "./HostEditorBridgeProtocol";

interface LineEditorCursor {
  line: number;
  ch: number;
}

export interface LineEditorController {
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

/**
 * The target of the IME composition that runs now. The MAIN-world bridge and
 * the content script each keep their own value in their own module instance.
 */
let compositionTarget: Node | null = null;

/** Records the target of a compositionstart or compositionend event. */
export function recordComposition(event: Event): void {
  compositionTarget = event.type === "compositionstart" ? (event.composedPath()[0] as Node) : null;
}

/**
 * True while an IME composition runs in `root`, in a descendant or in an
 * ancestor of it. During a composition the DOM holds text that the editor
 * model does not have yet. Thus no writer may change the text then.
 */
export function isComposingIn(root: Node): boolean {
  const target = compositionTarget;
  return !!target?.isConnected && (root.contains(target) || target.contains(root));
}

export interface LineEditorBlockContext {
  beforeCursor: string;
  afterCursor: string;
  blockText: string;
}

function isLineEditorController(value: unknown): value is LineEditorController {
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

export function findLineEditorController(elem: HTMLElement): LineEditorController | null {
  let current: HTMLElement | null = elem;
  while (current) {
    for (const key of Object.getOwnPropertyNames(current)) {
      let value: unknown;
      try {
        value = (current as unknown as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      if (isLineEditorController(value)) {
        return value;
      }
    }
    current = current.parentElement;
  }
  return null;
}

function readLineEditorCursor(controller: LineEditorController): LineEditorCursor | null {
  const cursor = controller.getCursor();
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

export function readLineEditorBlockContext(
  controller: LineEditorController,
): LineEditorBlockContext | null {
  const cursor = readLineEditorCursor(controller);
  if (!cursor) {
    return null;
  }
  const blockText = controller.getLine(cursor.line);
  if (typeof blockText !== "string" || cursor.ch > blockText.length) {
    return null;
  }
  return {
    beforeCursor: blockText.slice(0, cursor.ch),
    afterCursor: blockText.slice(cursor.ch),
    blockText,
  };
}

/** Mirrors the editor caret onto the hidden backing input/textarea, if any. */
export function syncBackingSelection(
  controller: LineEditorController,
  target: HTMLInputElement | HTMLTextAreaElement | null,
  selection: LineEditorCursor,
): void {
  if (!target) {
    return;
  }
  const absoluteIndex = controller.indexFromPos(selection);
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
    // Ignore selection sync failures on hidden backing inputs.
  }
}

/** Checks that the replace range fits the block and the caret fits the new text. */
export function isValidBlockReplacement(
  blockText: string,
  request: Pick<
    HostEditorBlockReplacement,
    "replaceStart" | "replaceEnd" | "replacementText" | "cursorAfter"
  >,
): boolean {
  const { replaceStart, replaceEnd, replacementText, cursorAfter } = request;
  return (
    Number.isSafeInteger(replaceStart) &&
    Number.isSafeInteger(replaceEnd) &&
    Number.isSafeInteger(cursorAfter) &&
    replaceStart >= 0 &&
    replaceEnd >= replaceStart &&
    replaceEnd <= blockText.length &&
    cursorAfter >= 0 &&
    cursorAfter <= blockText.length - (replaceEnd - replaceStart) + replacementText.length
  );
}

/**
 * Replaces a range of the caret line, then moves the caret. Refuses when the
 * caret line, its text or the range is not as expected.
 */
export function applyLineEditorReplacement(
  controller: LineEditorController,
  backingTarget: HTMLInputElement | HTMLTextAreaElement | null,
  expectedText: string | null,
  request: Pick<
    HostEditorBlockReplacement,
    "replaceStart" | "replaceEnd" | "replacementText" | "cursorAfter"
  >,
): boolean {
  const { replaceStart, replaceEnd, replacementText, cursorAfter } = request;
  const cursor = readLineEditorCursor(controller);
  if (!cursor) {
    return false;
  }
  const blockText = controller.getLine(cursor.line);
  if (
    typeof blockText !== "string" ||
    blockText !== expectedText ||
    !isValidBlockReplacement(blockText, request)
  ) {
    return false;
  }

  const from = { line: cursor.line, ch: replaceStart };
  const to = { line: cursor.line, ch: replaceEnd };
  const selection = { line: cursor.line, ch: cursorAfter };
  const run = () => {
    controller.replaceRange(replacementText, from, to, "+input");
    controller.setCursor(selection);
  };

  if (typeof controller.operation === "function") {
    controller.operation(run);
  } else {
    run();
  }

  syncBackingSelection(controller, backingTarget, selection);
  controller.focus?.();
  return true;
}
