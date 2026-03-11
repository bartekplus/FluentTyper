import {
  HOST_EDITOR_MAIN_WORLD_FLAG,
  HOST_EDITOR_REQUEST_ATTR,
  HOST_EDITOR_REQUEST_EVENT,
  HOST_EDITOR_RESPONSE_ATTR,
} from "./HostEditorBridgeProtocol";

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

type BridgeRequest =
  | {
      action: "getBlockContext";
    }
  | {
      action: "applyBlockReplacement";
      replaceStart: number;
      replaceEnd: number;
      replacementText: string;
      cursorAfter: number;
      expectedBlockText: string;
    };

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

function findLineEditorController(elem: HTMLElement): LineEditorController | null {
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

function readCursor(controller: LineEditorController): LineEditorCursor | null {
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

function getBlockContext(controller: LineEditorController) {
  const cursor = readCursor(controller);
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

function findBackingTextValueTarget(
  elem: HTMLElement,
): HTMLInputElement | HTMLTextAreaElement | null {
  const codeMirrorRoot = elem.closest(".CodeMirror");
  if (!(codeMirrorRoot instanceof HTMLElement)) {
    return null;
  }
  const candidate = codeMirrorRoot.previousElementSibling;
  if (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) {
    return candidate;
  }
  return null;
}

function syncBackingSelection(
  controller: LineEditorController,
  elem: HTMLElement,
  selection: LineEditorCursor,
): void {
  const target = findBackingTextValueTarget(elem);
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

function applyBlockReplacement(
  controller: LineEditorController,
  elem: HTMLElement,
  request: Extract<BridgeRequest, { action: "applyBlockReplacement" }>,
) {
  const cursor = readCursor(controller);
  if (!cursor) {
    return { applied: false, didDispatchInput: false };
  }
  const blockText = controller.getLine(cursor.line);
  if (
    typeof blockText !== "string" ||
    blockText !== request.expectedBlockText ||
    request.replaceStart < 0 ||
    request.replaceEnd < request.replaceStart ||
    request.replaceEnd > blockText.length
  ) {
    return { applied: false, didDispatchInput: false };
  }

  const expectedLength =
    blockText.length - (request.replaceEnd - request.replaceStart) + request.replacementText.length;
  if (request.cursorAfter < 0 || request.cursorAfter > expectedLength) {
    return { applied: false, didDispatchInput: false };
  }

  const from = { line: cursor.line, ch: request.replaceStart };
  const to = { line: cursor.line, ch: request.replaceEnd };
  const selection = { line: cursor.line, ch: request.cursorAfter };
  const run = () => {
    controller.replaceRange(request.replacementText, from, to, "+input");
    controller.setCursor(selection);
  };

  if (typeof controller.operation === "function") {
    controller.operation(run);
  } else {
    run();
  }

  syncBackingSelection(controller, elem, selection);
  controller.focus?.();

  return { applied: true, didDispatchInput: false };
}

export function installHostEditorMainWorldBridge(doc: Document = document): void {
  const win = doc.defaultView;
  if (!win) {
    return;
  }
  if ((win as Window & { [HOST_EDITOR_MAIN_WORLD_FLAG]?: boolean })[HOST_EDITOR_MAIN_WORLD_FLAG]) {
    return;
  }

  (win as Window & { [HOST_EDITOR_MAIN_WORLD_FLAG]?: boolean })[HOST_EDITOR_MAIN_WORLD_FLAG] = true;

  doc.addEventListener(
    HOST_EDITOR_REQUEST_EVENT,
    (event) => {
      const source = event.composedPath()[0];
      if (!(source instanceof HTMLElement)) {
        return;
      }
      const rawRequest = source.getAttribute(HOST_EDITOR_REQUEST_ATTR);
      if (!rawRequest) {
        return;
      }

      let response: unknown = { ok: false };
      try {
        const request = JSON.parse(rawRequest) as BridgeRequest;
        const controller = findLineEditorController(source);
        if (controller) {
          if (request.action === "getBlockContext") {
            const blockContext = getBlockContext(controller);
            if (blockContext) {
              response = { ok: true, blockContext };
            }
          } else {
            response = {
              ok: true,
              result: applyBlockReplacement(controller, source, request),
            };
          }
        }
      } catch {
        response = { ok: false };
      }

      try {
        source.setAttribute(HOST_EDITOR_RESPONSE_ATTR, JSON.stringify(response));
      } catch {
        // Ignore DOM attribute failures; the content script will fall back.
      }
    },
    true,
  );
}

installHostEditorMainWorldBridge();
