export interface LineEditorCursor {
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

export interface LineEditorBlockContext {
  beforeCursor: string;
  afterCursor: string;
  blockText: string;
}

export function isLineEditorController(value: unknown): value is LineEditorController {
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

export function readLineEditorCursor(controller: LineEditorController): LineEditorCursor | null {
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
  if (typeof blockText !== "string" || cursor.ch < 0 || cursor.ch > blockText.length) {
    return null;
  }
  return {
    beforeCursor: blockText.slice(0, cursor.ch),
    afterCursor: blockText.slice(cursor.ch),
    blockText,
  };
}
