import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createEditor, type Descendant, type Editor } from "slate";
import { withHistory, type HistoryEditor } from "slate-history";
import {
  Editable,
  Slate,
  withReact,
  type ReactEditor,
  type RenderElementProps,
  type RenderLeafProps,
} from "slate-react";
import {
  HOST_EDITOR_ENABLED_ATTR,
  HOST_EDITOR_ENABLED_EVENT,
} from "../src/adapters/chrome/content-script/suggestions/HostEditorBridgeProtocol";
import { ContentEditableReviewTarget } from "../src/adapters/chrome/content-script/review/ReviewTargets";
import { editorCapabilities } from "../src/adapters/chrome/content-script/suggestions/EditorCapabilities";
import {
  applySlate,
  readSlate,
  replaceSlateBlock,
  slateBlockContext,
} from "../src/adapters/chrome/content-script/suggestions/SlateEditor";
import { applyEdits } from "../src/core/domain/grammar/review/textRanges";
import type { ReviewEdit } from "../src/core/domain/grammar/review/types";
import "../src/adapters/chrome/content-script/suggestions/HostEditorMainWorldBridge";

// slate-dom reads these window globals; the shared preload defines only the common ones.
// Unit files share one process, so the added globals are removed afterwards.
const added: string[] = [];
afterAll(() => {
  for (const name of added) delete (globalThis as Record<string, unknown>)[name];
});
for (const name of [
  "Document",
  "ShadowRoot",
  "Text",
  "Selection",
  "DataTransfer",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const) {
  if (name in globalThis) continue;
  const value = (window as unknown as Record<string, unknown>)[name];
  (globalThis as Record<string, unknown>)[name] =
    typeof value === "function" && !/^[A-Z]/.test(name) ? value.bind(window) : value;
  added.push(name);
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type TestEditor = Editor & ReactEditor & HistoryEditor;
let root: Root | undefined;
beforeEach(() => {
  document.documentElement.setAttribute(HOST_EDITOR_ENABLED_ATTR, "true");
  document.dispatchEvent(new Event(HOST_EDITOR_ENABLED_EVENT));
  document.documentElement.removeAttribute(HOST_EDITOR_ENABLED_ATTR);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function renderElement({ attributes, children, element }: RenderElementProps): ReactElement {
  const node = element as { type?: string; url?: string };
  if (node.type === "link") return createElement("a", { ...attributes, href: node.url }, children);
  if (node.type === "code")
    return createElement("pre", attributes, createElement("code", null, children));
  return createElement("p", attributes, children);
}
function renderLeaf({ attributes, children, leaf }: RenderLeafProps): ReactElement {
  const marks = leaf as { bold?: boolean; italic?: boolean };
  let content = children;
  if (marks.bold) content = createElement("strong", null, content);
  if (marks.italic) content = createElement("em", null, content);
  return createElement("span", attributes, content);
}

function mount(value: unknown[]) {
  const editor = withHistory(withReact(createEditor())) as TestEditor;
  const { isInline } = editor;
  editor.isInline = (element) =>
    (element as { type?: string }).type === "link" || isInline(element);
  const container = document.body.appendChild(document.createElement("div"));
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(Slate, {
        editor,
        initialValue: value as Descendant[],
        children: createElement(Editable, { renderElement, renderLeaf }),
      }),
    );
  });
  const dom = container.querySelector<HTMLElement>("[data-slate-editor]")!;
  Object.defineProperty(dom, "isContentEditable", { configurable: true, value: true });
  return { editor, dom };
}
/** Let slate-react flush its onChange microtask and render. */
const settle = () => act(async () => {});

async function review(dom: HTMLElement, edits: (text: string) => ReviewEdit[]) {
  const target = new ContentEditableReviewTarget(dom);
  const before = target.read();
  if (!before.ok) throw new Error("unreadable");
  const planned = edits(before.text);
  // Outside act(): the target waits for slate-react's normal asynchronous render.
  const result = await target.apply({
    edits: planned,
    before: before.text,
    after: applyEdits(before.text, planned)!,
    signature: before.signature,
  });
  return { target, result };
}
const fix = (text: string, from: string, to: string, at = 0): ReviewEdit => {
  const start = text.indexOf(from, at);
  return { start, end: start + from.length, original: from, replacement: to };
};

describe("real Slate corrections", () => {
  test("Review is a verified model writer: split marks, inline links, protected code, one undo step", async () => {
    const { editor, dom } = mount([
      {
        type: "paragraph",
        children: [
          { text: "We saw " },
          { text: "te", bold: true },
          { text: "h", italic: true },
          { text: " cat and " },
          { type: "link", url: "https://example.com/", children: [{ text: "teh" }] },
          { text: " dog." },
        ],
      },
      { type: "code", children: [{ text: "teh code" }] },
    ]);
    const original = structuredClone(editor.children);
    const target = new ContentEditableReviewTarget(dom);
    expect(target.kind).toBe("slate");
    expect(target.capabilities).toEqual({ apply: true, bulk: true });
    const { result } = await review(dom, (text) => [
      fix(text, "teh", "the"),
      fix(text, "teh", "the", text.indexOf("and")),
    ]);
    expect(result).toEqual({ status: "applied", signature: expect.any(String) });
    // The default Slate types know no marks, links or block types.
    expect<unknown>(editor.children).toEqual([
      {
        type: "paragraph",
        children: [
          { text: "We saw " },
          { text: "th", bold: true },
          { text: "e", italic: true },
          { text: " cat and " },
          { type: "link", url: "https://example.com/", children: [{ text: "the" }] },
          { text: " dog." },
        ],
      },
      original[1],
    ]);
    expect(dom.textContent).toBe("We saw the cat and the dog.teh code");
    act(() => editor.undo());
    expect(editor.children).toEqual(original);
    act(() => editor.redo());
    expect(JSON.stringify(editor.children)).toContain('"the"');
  });

  test("code stays protected and a stale signature is refused without a write", async () => {
    const { editor, dom } = mount([{ type: "code", children: [{ text: "teh code" }] }]);
    const original = structuredClone(editor.children);
    const { result } = await review(dom, (text) => [fix(text, "teh", "the")]);
    expect(result.status).toBe("rejected");
    const target = new ContentEditableReviewTarget(dom);
    const read = target.read();
    if (!read.ok) throw new Error("unreadable");
    expect(
      await target.apply({
        edits: [],
        before: read.text,
        after: read.text,
        signature: "stale",
      }),
    ).toEqual({ status: "stale" });
    expect(editor.children).toEqual(original);
  });

  test("typing replacement writes the model, moves its caret and is its own undo step", async () => {
    const { editor, dom } = mount([
      { type: "paragraph", children: [{ text: "Hello" }] },
      { type: "paragraph", children: [{ text: "We w", bold: true }] },
    ]);
    act(() => editor.select({ path: [1, 0], offset: 4 }));
    // The user's typing ends with "w"; a host merge would undo it with the completion.
    act(() => editor.insertText("x"));
    act(() => editor.deleteBackward("character"));
    await settle();
    const undos = editor.history.undos.length;
    expect(slateBlockContext(dom)).toEqual({
      beforeCursor: "We w",
      afterCursor: "",
      blockText: "We w",
    });
    await act(async () => {
      expect(
        replaceSlateBlock(dom, {
          replaceStart: 3,
          replaceEnd: 4,
          replacementText: "was ",
          cursorAfter: 7,
          expectedBlockText: "We w",
        }),
      ).toEqual({ applied: true, didDispatchInput: false });
    });
    expect<unknown>(editor.children[1]).toEqual({
      type: "paragraph",
      children: [{ text: "We was ", bold: true }],
    });
    expect(editor.selection).toEqual({
      anchor: { path: [1, 0], offset: 7 },
      focus: { path: [1, 0], offset: 7 },
    });
    expect(editor.history.undos.length).toBe(undos + 1);
    expect(readSlate(dom)?.text).toBe("Hello\nWe was ");
    act(() => editor.undo());
    expect<unknown>(editor.children[1]).toEqual({
      type: "paragraph",
      children: [{ text: "We w", bold: true }],
    });
    // A changed block is refused, never rebuilt.
    expect(
      replaceSlateBlock(dom, {
        replaceStart: 0,
        replaceEnd: 0,
        replacementText: "x",
        cursorAfter: 1,
        expectedBlockText: "other",
      }),
    ).toEqual({ applied: false, didDispatchInput: false });
  });

  test("an IME composition blocks Review reads, Review writes and typing writes", async () => {
    const { editor, dom } = mount([{ type: "paragraph", children: [{ text: "We saw teh" }] }]);
    act(() => editor.select({ path: [0, 0], offset: 10 }));
    await settle();
    const before = readSlate(dom)!;
    const edits = [fix(before.text, "teh", "the")];
    const review = { edits, before: before.text, after: "We saw the", signature: before.signature };
    const typing = {
      replaceStart: 7,
      replaceEnd: 10,
      replacementText: "the",
      cursorAfter: 10,
      expectedBlockText: "We saw teh",
    };
    const compose = (type: string) =>
      act(() => dom.dispatchEvent(new Event(type, { bubbles: true, composed: true })));

    compose("compositionstart");
    // While the IME composes, the DOM holds text that the model does not have yet.
    expect(readSlate(dom)).toBeNull();
    expect(slateBlockContext(dom)).toBeNull();
    expect(applySlate(dom, review)).toEqual({ status: "rejected", reason: "unsupported" });
    expect(replaceSlateBlock(dom, typing)).toEqual({ applied: false, didDispatchInput: false });
    expect<unknown>(editor.children).toEqual([
      { type: "paragraph", children: [{ text: "We saw teh" }] },
    ]);

    compose("compositionend");
    await act(async () => {
      expect(replaceSlateBlock(dom, typing)).toEqual({ applied: true, didDispatchInput: false });
    });
    expect<unknown>(editor.children).toEqual([
      { type: "paragraph", children: [{ text: "We saw the" }] },
    ]);
  });

  test("an unflushed or unrendered model is not read", async () => {
    const { editor, dom } = mount([{ type: "paragraph", children: [{ text: "teh" }] }]);
    expect(readSlate(dom)?.text).toBe("teh");
    await act(async () => {
      editor.apply({ type: "insert_text", path: [0, 0], offset: 3, text: "!" });
      expect(readSlate(dom)).toBeNull();
    });
    expect(readSlate(dom)?.text).toBe("teh!");
  });

  test("a Slate fingerprint without its React editor stays review-only", () => {
    const field = document.body.appendChild(document.createElement("div"));
    field.setAttribute("data-slate-editor", "true");
    field.contentEditable = "true";
    Object.defineProperty(field, "isContentEditable", { configurable: true, value: true });
    field.innerHTML = "<p>teh</p>";
    expect(readSlate(field)).toBeNull();
    const target = new ContentEditableReviewTarget(field);
    expect(target.kind).toBe("model-editor");
    expect(target.capabilities.apply).toBe(false);
    expect(editorCapabilities(field).reason).toBe("available");
  });
});
