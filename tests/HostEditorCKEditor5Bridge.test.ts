import { describe, expect, test } from "bun:test";
import {
  HOST_EDITOR_REQUEST_ATTR,
  HOST_EDITOR_REQUEST_EVENT,
  HOST_EDITOR_RESPONSE_ATTR,
} from "../src/adapters/chrome/content-script/suggestions/HostEditorBridgeProtocol";
// Importing the module auto-installs the bridge via installHostEditorMainWorldBridge().
import "../src/adapters/chrome/content-script/suggestions/HostEditorMainWorldBridge";

// ---------------------------------------------------------------------------
// CKEditor-5 model mock
//
// Simulates the minimal CKEditor-5 model surface that the bridge relies on:
// - editor.model.document.selection.getFirstPosition()
// - editor.model.change(writer => ...)
// - Writer: createPositionAt, createRange, remove, insertText, setSelection
// ---------------------------------------------------------------------------

function createCKEditorMock(initialText: string, initialCursorOffset: number) {
  let text = initialText;
  let cursorOffset = initialCursorOffset;

  const block = {
    is(type: string) {
      return type === "element" || type === "paragraph";
    },
    getChildren() {
      return [{ data: text, is: (type: string) => type === "$text" }];
    },
  };

  const writer = {
    createPositionAt(_element: unknown, offset: number) {
      return { offset };
    },
    createRange(start: { offset: number }, end: { offset: number }) {
      return { start, end };
    },
    createRangeIn() {
      return { start: { offset: 0 }, end: { offset: text.length } };
    },
    remove(range: { start: { offset: number }; end: { offset: number } }) {
      text = text.slice(0, range.start.offset) + text.slice(range.end.offset);
    },
    insertText(insertText: string, position: { offset: number }) {
      text = text.slice(0, position.offset) + insertText + text.slice(position.offset);
    },
    setSelection(position: { offset: number }) {
      cursorOffset = position.offset;
    },
  };

  const editor = {
    model: {
      document: {
        selection: {
          getFirstPosition() {
            return { parent: block, offset: cursorOffset };
          },
        },
      },
      change(callback: (w: typeof writer) => void) {
        callback(writer);
      },
    },
  };

  return {
    editor,
    getText: () => text,
    getCursorOffset: () => cursorOffset,
  };
}

function createCKEditorMockWithDomSelectionBlocks(
  initialTexts: [string, string],
  staleSelection: { blockIndex: 0 | 1; offset: number },
) {
  const texts = [...initialTexts];
  let selectionBlockIndex = staleSelection.blockIndex;
  let selectionOffset = staleSelection.offset;

  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  const paragraphs = texts.map((text) => {
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createTextNode(text));
    editable.appendChild(paragraph);
    return paragraph;
  });

  const blocks = texts.map((_text, index) => ({
    is(type: string) {
      return type === "element" || type === "paragraph";
    },
    getChildren() {
      return [{ data: texts[index], is: (type: string) => type === "$text" }];
    },
  }));

  const writer = {
    createPositionAt(element: unknown, offset: number) {
      return { parent: element, offset };
    },
    createRange(
      start: { parent: unknown; offset: number },
      end: { parent: unknown; offset: number },
    ) {
      return { start, end };
    },
    remove(range: {
      start: { parent: unknown; offset: number };
      end: { parent: unknown; offset: number };
    }) {
      const blockIndex = blocks.indexOf(range.start.parent as (typeof blocks)[number]);
      texts[blockIndex] =
        texts[blockIndex].slice(0, range.start.offset) + texts[blockIndex].slice(range.end.offset);
      paragraphs[blockIndex].textContent = texts[blockIndex];
    },
    insertText(
      insertText: string,
      attrsOrPosition:
        | { parent: unknown; offset: number }
        | Record<string, unknown>
        | null
        | undefined,
      maybePosition?: { parent: unknown; offset: number },
    ) {
      const position = maybePosition ?? (attrsOrPosition as { parent: unknown; offset: number });
      const blockIndex = blocks.indexOf(position.parent as (typeof blocks)[number]);
      texts[blockIndex] =
        texts[blockIndex].slice(0, position.offset) +
        insertText +
        texts[blockIndex].slice(position.offset);
      paragraphs[blockIndex].textContent = texts[blockIndex];
    },
    setSelection(position: { parent: unknown; offset: number }) {
      selectionBlockIndex = blocks.indexOf(position.parent as (typeof blocks)[number]) as 0 | 1;
      selectionOffset = position.offset;
    },
  };

  const editor = {
    model: {
      document: {
        selection: {
          getFirstPosition() {
            return {
              parent: blocks[selectionBlockIndex],
              offset: selectionOffset,
            };
          },
        },
      },
      change(callback: (w: typeof writer) => void) {
        callback(writer);
      },
    },
    ui: {
      view: {
        editable: {
          element: editable,
        },
      },
    },
    editing: {
      view: {
        domConverter: {
          domPositionToView(domParent: Node, domOffset: number) {
            return { domParent, domOffset };
          },
        },
      },
      mapper: {
        toModelPosition(viewPosition: { domParent: Node; domOffset: number }) {
          const node =
            viewPosition.domParent.nodeType === Node.TEXT_NODE
              ? viewPosition.domParent
              : (viewPosition.domParent.childNodes[viewPosition.domOffset] ??
                viewPosition.domParent.childNodes[viewPosition.domOffset - 1] ??
                viewPosition.domParent);
          const paragraph =
            node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
          const blockIndex = paragraphs.indexOf(paragraph as HTMLParagraphElement) as 0 | 1;
          return {
            parent: blocks[blockIndex],
            offset:
              viewPosition.domParent.nodeType === Node.TEXT_NODE
                ? viewPosition.domOffset
                : (paragraph?.textContent?.length ?? 0),
          };
        },
      },
    },
  };

  return {
    editor,
    editable,
    paragraphs,
    getTexts: () => [...texts],
    getSelection: () => ({ blockIndex: selectionBlockIndex, offset: selectionOffset }),
  };
}

function dispatchBridgeRequest(
  elem: HTMLElement,
  request: Record<string, unknown>,
): Record<string, unknown> | null {
  elem.removeAttribute(HOST_EDITOR_RESPONSE_ATTR);
  elem.setAttribute(HOST_EDITOR_REQUEST_ATTR, JSON.stringify(request));
  elem.dispatchEvent(new CustomEvent(HOST_EDITOR_REQUEST_EVENT, { bubbles: true, composed: true }));
  const raw = elem.getAttribute(HOST_EDITOR_RESPONSE_ATTR);
  if (!raw) return null;
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("HostEditorMainWorldBridge – CKEditor-5", () => {
  test("returns block context for a CKEditor-5 element", () => {
    const mock = createCKEditorMock("Hello world", 5);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    (editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    document.body.appendChild(editable);

    const response = dispatchBridgeRequest(editable, { action: "getBlockContext" });

    expect(response).toEqual({
      ok: true,
      blockContext: {
        beforeCursor: "Hello",
        afterCursor: " world",
        blockText: "Hello world",
      },
    });
  });

  test("applies block replacement via CKEditor-5 model API", () => {
    const mock = createCKEditorMock("hello world", 1);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    (editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    document.body.appendChild(editable);

    const response = dispatchBridgeRequest(editable, {
      action: "applyBlockReplacement",
      replaceStart: 0,
      replaceEnd: 1,
      replacementText: "H",
      cursorAfter: 1,
      expectedBlockText: "hello world",
    });

    expect(response).toEqual({ ok: true, result: { applied: true, didDispatchInput: false } });
    expect(mock.getText()).toBe("Hello world");
    expect(mock.getCursorOffset()).toBe(1);
  });

  test("rejects replacement when expected block text does not match", () => {
    const mock = createCKEditorMock("hello world", 1);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    (editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    document.body.appendChild(editable);

    const response = dispatchBridgeRequest(editable, {
      action: "applyBlockReplacement",
      replaceStart: 0,
      replaceEnd: 1,
      replacementText: "H",
      cursorAfter: 1,
      expectedBlockText: "WRONG TEXT",
    });

    expect(response).toEqual({ ok: true, result: { applied: false, didDispatchInput: false } });
    expect(mock.getText()).toBe("hello world");
  });

  test("rewrites block when host model lags the caller's view (Firefox leading-char lag)", () => {
    // Simulates Firefox CKEditor-5 where the DOM shows "dThe" (the user
    // just typed `d`) but the editor model is still "The".  The caller's
    // view is "dThe" and it wants to replace [0,1] with "D".  The bridge
    // should detect the lag and rewrite the whole block to "DThe" via
    // model.change without duplicating the typed character.
    const mock = createCKEditorMock("The", 0);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    (editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    document.body.appendChild(editable);

    const response = dispatchBridgeRequest(editable, {
      action: "applyBlockReplacement",
      replaceStart: 0,
      replaceEnd: 1,
      replacementText: "D",
      cursorAfter: 1,
      expectedBlockText: "dThe",
    });

    expect(response).toEqual({ ok: true, result: { applied: true, didDispatchInput: false } });
    expect(mock.getText()).toBe("DThe");
    expect(mock.getCursorOffset()).toBe(1);
  });

  test("rejects stale-model rewrite when host model is not a plausible precursor", () => {
    // Host model is "xyz" which is not "The" with the replace-range
    // removed, so the "Firefox leading-char lag" rewrite is not safe.
    const mock = createCKEditorMock("xyz", 0);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    (editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    document.body.appendChild(editable);

    const response = dispatchBridgeRequest(editable, {
      action: "applyBlockReplacement",
      replaceStart: 0,
      replaceEnd: 1,
      replacementText: "D",
      cursorAfter: 1,
      expectedBlockText: "dThe",
    });

    expect(response).toEqual({ ok: true, result: { applied: false, didDispatchInput: false } });
    expect(mock.getText()).toBe("xyz");
  });

  test("does not activate for elements without ckeditorInstance", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);

    const response = dispatchBridgeRequest(editable, { action: "getBlockContext" });

    expect(response).toEqual({ ok: false });
  });

  test("detects CKEditor-5 instance on a parent element", () => {
    const mock = createCKEditorMock("test", 2);
    const wrapper = document.createElement("div");
    (wrapper as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    wrapper.appendChild(editable);
    document.body.appendChild(wrapper);

    const response = dispatchBridgeRequest(editable, { action: "getBlockContext" });

    expect(response).toEqual({
      ok: true,
      blockContext: {
        beforeCursor: "te",
        afterCursor: "st",
        blockText: "test",
      },
    });
  });

  test("applies multi-character replacement correctly", () => {
    const mock = createCKEditorMock("teh quick", 4);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    (editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    document.body.appendChild(editable);

    const response = dispatchBridgeRequest(editable, {
      action: "applyBlockReplacement",
      replaceStart: 0,
      replaceEnd: 4,
      replacementText: "the ",
      cursorAfter: 4,
      expectedBlockText: "teh quick",
    });

    expect(response).toEqual({ ok: true, result: { applied: true, didDispatchInput: false } });
    expect(mock.getText()).toBe("the quick");
    expect(mock.getCursorOffset()).toBe(4);
  });

  test("returns block context from DOM selection when CKEditor model selection is stale", () => {
    const mock = createCKEditorMockWithDomSelectionBlocks(["First line", "Second line"], {
      blockIndex: 0,
      offset: 0,
    });
    (mock.editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    document.body.appendChild(mock.editable);

    const secondParagraphText = mock.paragraphs[1].firstChild as Text;
    const range = document.createRange();
    range.setStart(secondParagraphText, 6);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const response = dispatchBridgeRequest(mock.editable, { action: "getBlockContext" });

    expect(response).toEqual({
      ok: true,
      blockContext: {
        beforeCursor: "Second",
        afterCursor: " line",
        blockText: "Second line",
      },
    });
  });

  test("applies replacement from DOM selection when CKEditor model selection is stale", () => {
    const mock = createCKEditorMockWithDomSelectionBlocks(["First line", "t"], {
      blockIndex: 0,
      offset: 0,
    });
    (mock.editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    document.body.appendChild(mock.editable);

    const secondParagraphText = mock.paragraphs[1].firstChild as Text;
    const range = document.createRange();
    range.setStart(secondParagraphText, 1);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const response = dispatchBridgeRequest(mock.editable, {
      action: "applyBlockReplacement",
      replaceStart: 0,
      replaceEnd: 1,
      replacementText: "T",
      cursorAfter: 1,
      expectedBlockText: "t",
    });

    expect(response).toEqual({ ok: true, result: { applied: true, didDispatchInput: false } });
    expect(mock.getTexts()).toEqual(["First line", "T"]);
    expect(mock.getSelection()).toEqual({ blockIndex: 1, offset: 1 });
  });

  test("prefers LineEditorController over CKEditor-5 when both are present", () => {
    const ckMock = createCKEditorMock("from ckeditor", 5);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    (editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = ckMock.editor;

    // Also attach a LineEditorController
    let lineText = "from controller";
    let lineCh = 5;
    (editable as HTMLElement & { editorCtl?: unknown }).editorCtl = {
      replaceRange(text: string, from: { ch: number }, to?: { ch: number }) {
        lineText = `${lineText.slice(0, from.ch)}${text}${lineText.slice(to?.ch ?? from.ch)}`;
      },
      setCursor(pos: { ch: number }) {
        lineCh = pos.ch;
      },
      getCursor: () => ({ line: 0, ch: lineCh }),
      getLine: (l: number) => (l === 0 ? lineText : ""),
      posFromIndex: (i: number) => ({ line: 0, ch: i }),
      indexFromPos: (p: { ch: number }) => p.ch,
    };
    document.body.appendChild(editable);

    const response = dispatchBridgeRequest(editable, { action: "getBlockContext" });

    expect(response).toEqual({
      ok: true,
      blockContext: {
        beforeCursor: "from ",
        afterCursor: "controller",
        blockText: "from controller",
      },
    });
  });

  // ── softBreak tests ──────────────────────────────────────────────────
  // CKEditor-5 represents Shift+Enter as a <softBreak> model element that
  // occupies 1 model offset but adds 0 text characters.

  function createCKEditorMockWithSoftBreak(
    textBefore: string,
    textAfter: string,
    cursorModelOffset: number,
  ) {
    // Internal state uses model offsets: textBefore + softBreak(1) + textAfter
    let beforeText = textBefore;
    let afterText = textAfter;
    let cursor = cursorModelOffset;

    const block = {
      is(type: string) {
        return type === "element" || type === "paragraph";
      },
      getChildren() {
        return [
          { data: beforeText, is: (type: string) => type === "$text" },
          {
            is: (type: string) =>
              type === "softBreak" || type === "element" || (type === "element" && false),
          },
          { data: afterText, is: (type: string) => type === "$text" },
        ];
      },
    };

    // Model layout: [beforeText chars][softBreak(1)][afterText chars]
    // Offsets: 0..beforeText.length = beforeText, beforeText.length = softBreak,
    //          beforeText.length+1..end = afterText

    const writer = {
      createPositionAt(_element: unknown, offset: number) {
        return { offset };
      },
      createRange(start: { offset: number }, end: { offset: number }) {
        return { start, end };
      },
      remove(range: { start: { offset: number }; end: { offset: number } }) {
        const sbOffset = beforeText.length;
        const startOff = range.start.offset;
        const endOff = range.end.offset;
        // Replacement should be within one text segment (before or after softBreak)
        if (startOff > sbOffset) {
          // In afterText segment
          const localStart = startOff - sbOffset - 1;
          const localEnd = endOff - sbOffset - 1;
          afterText = afterText.slice(0, localStart) + afterText.slice(localEnd);
        } else {
          const localStart = startOff;
          const localEnd = endOff;
          beforeText = beforeText.slice(0, localStart) + beforeText.slice(localEnd);
        }
      },
      insertText(insertTextStr: string, position: { offset: number }) {
        const sbOffset = beforeText.length;
        if (position.offset > sbOffset) {
          const localOff = position.offset - sbOffset - 1;
          afterText = afterText.slice(0, localOff) + insertTextStr + afterText.slice(localOff);
        } else {
          beforeText =
            beforeText.slice(0, position.offset) +
            insertTextStr +
            beforeText.slice(position.offset);
        }
      },
      setSelection(position: { offset: number }) {
        cursor = position.offset;
      },
    };

    const editor = {
      model: {
        document: {
          selection: {
            getFirstPosition() {
              return { parent: block, offset: cursor };
            },
          },
        },
        change(callback: (w: typeof writer) => void) {
          callback(writer);
        },
      },
    };

    return {
      editor,
      getBeforeText: () => beforeText,
      getAfterText: () => afterText,
      getFullText: () => beforeText + afterText,
      getCursorModelOffset: () => cursor,
    };
  }

  test("returns block context with softBreak, cursor after break", () => {
    // Model: "First line."<softBreak>"second line a"
    // softBreak is at model offset 11, cursor at model offset 24 (11+1+12)
    const mock = createCKEditorMockWithSoftBreak("First line.", "second line a", 24);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    (editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    document.body.appendChild(editable);

    const response = dispatchBridgeRequest(editable, { action: "getBlockContext" });

    // Text offset for model offset 24: 24 - 1 softBreak = 23
    // Full text = "First line.second line a" (24 chars)
    // beforeCursor = text[0:23] = "First line.second line "
    // afterCursor = text[23:] = "a"
    expect(response).toEqual({
      ok: true,
      blockContext: {
        beforeCursor: "First line.second line ",
        afterCursor: "a",
        blockText: "First line.second line a",
      },
    });
  });

  test("applies replacement after softBreak with correct model offsets", () => {
    // Model: "First line."<softBreak>"second line. a"
    // Text: "First line.second line. a" (25 chars)
    // softBreak at model offset 11
    // Cursor at model offset 26 (11 + 1 + 14)
    // Want to replace text offset 24-25 ("a") with "A" (capitalize)
    const mock = createCKEditorMockWithSoftBreak("First line.", "second line. a", 26);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    (editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    document.body.appendChild(editable);

    const response = dispatchBridgeRequest(editable, {
      action: "applyBlockReplacement",
      replaceStart: 24, // text offset of "a"
      replaceEnd: 25,
      replacementText: "A",
      cursorAfter: 25,
      expectedBlockText: "First line.second line. a",
    });

    expect(response).toEqual({ ok: true, result: { applied: true, didDispatchInput: false } });
    // The "a" in afterText should be capitalized
    expect(mock.getAfterText()).toBe("second line. A");
    expect(mock.getFullText()).toBe("First line.second line. A");
    // Model cursor should be at 26 (25 text + 1 softBreak)
    expect(mock.getCursorModelOffset()).toBe(26);
  });

  test("preserves softBreak when replacing text that ends at the break boundary", () => {
    // Model: "The edit"<softBreak>"second line"
    // Text: "The editsecond line" (19 chars)
    // softBreak at model offset 8
    // Cursor at model offset 8 (right before softBreak, end of "The edit")
    // Replace text 4-8 ("edit") with "editor " — must NOT eat the softBreak
    const mock = createCKEditorMockWithSoftBreak("The edit", "second line", 8);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    (editable as HTMLElement & { ckeditorInstance?: unknown }).ckeditorInstance = mock.editor;
    document.body.appendChild(editable);

    const response = dispatchBridgeRequest(editable, {
      action: "applyBlockReplacement",
      replaceStart: 4,
      replaceEnd: 8,
      replacementText: "editor ",
      cursorAfter: 11,
      expectedBlockText: "The editsecond line",
    });

    expect(response).toEqual({ ok: true, result: { applied: true, didDispatchInput: false } });
    // "edit" should be replaced with "editor " BEFORE the softBreak
    expect(mock.getBeforeText()).toBe("The editor ");
    // Text after softBreak must be preserved
    expect(mock.getAfterText()).toBe("second line");
    expect(mock.getFullText()).toBe("The editor second line");
    // Cursor must stay BEFORE the softBreak (on the same line), not jump after it
    // "The editor " is 11 chars, softBreak is at model offset 11, cursor should be 11 (before break)
    expect(mock.getCursorModelOffset()).toBe(11);
  });
});
