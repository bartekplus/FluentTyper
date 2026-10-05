import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Editor,
  EditorState,
  Modifier,
  SelectionState,
  convertFromRaw,
  type ContentBlock,
} from "draft-js";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  UNDO_COMMAND,
  type LexicalEditor,
} from "lexical";
import { registerRichText, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { applyEdits } from "../src/core/domain/grammar/review/textRanges";
import {
  HOST_EDITOR_ENABLED_ATTR,
  HOST_EDITOR_ENABLED_EVENT,
  type HostEditorReviewApplyRequest,
} from "../src/adapters/chrome/content-script/suggestions/HostEditorBridgeProtocol";
import {
  applyReviewModel,
  modelBlockContext,
  readReviewModel,
  replaceModelBlock,
} from "../src/adapters/chrome/content-script/suggestions/ReviewModelEditors";
import { ContentEditableReviewTarget } from "../src/adapters/chrome/content-script/review/ReviewTargets";
import { createReviewController } from "./reviewTestUtils";
// The bridge records IME compositions for the Trix writer, which has no composition state of its own.
import "../src/adapters/chrome/content-script/suggestions/HostEditorMainWorldBridge";

// Direct tests of the Review model writers with the real Lexical, Draft.js and Trix
// libraries in JSDOM. The e2e suite covers the same editors in real browsers.

// ── JSDOM environment ───────────────────────────────────────────────
// Trix reads window globals that the shared preload does not set.
// JSDOM also lacks a few features that they call; no-op versions fill them in.
// Unit files can share one process, so everything added here is removed afterwards.
const cleanups: (() => void)[] = [];
const globals = globalThis as Record<string, unknown>;
for (const name of ["customElements", "requestAnimationFrame", "cancelAnimationFrame"]) {
  if (name in globalThis) continue;
  const value = (window as unknown as Record<string, unknown>)[name];
  globals[name] = typeof value === "function" ? value.bind(window) : value;
  cleanups.push(() => delete globals[name]);
}
function polyfill(prototype: Record<string, unknown>, name: string, value: unknown) {
  if (name in prototype) return;
  prototype[name] = value;
  cleanups.push(() => delete prototype[name]);
}
const prototypeOf = (name: string) =>
  (window as unknown as Record<string, { prototype: Record<string, unknown> }>)[name].prototype;
// Trix is a form-associated element: its ElementInternals sets the form value and validity.
polyfill(prototypeOf("ElementInternals"), "setFormValue", () => undefined);
polyfill(prototypeOf("ElementInternals"), "setValidity", () => undefined);
// Browsers have InputEvent.getTargetRanges, so Trix uses its Level 2 input controller
// there. Without it, Trix falls back to its Level 0 controller, which needs keydown events.
polyfill(prototypeOf("InputEvent"), "getTargetRanges", () => []);
// Lexical measures the caret to scroll it into view.
polyfill(prototypeOf("Range"), "getBoundingClientRect", () => new DOMRect());
polyfill(prototypeOf("Range"), "getClientRects", () => []);
globals.IS_REACT_ACT_ENVIRONMENT = true;
cleanups.push(() => delete globals.IS_REACT_ACT_ENVIRONMENT);
// Trix defines its custom element when it loads, so it loads after the globals above.
beforeAll(async () => {
  await import("trix");
});
afterAll(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
});

let reactRoot: Root | undefined;
afterEach(() => {
  act(() => reactRoot?.unmount());
  reactRoot = undefined;
});

// ── Shared helpers ──────────────────────────────────────────────────
const SEED = "We saw teh cat.";

/** JSDOM has no isContentEditable; Review refuses a field that is not editable. */
function markEditable(element: HTMLElement): void {
  Object.defineProperty(element, "isContentEditable", { configurable: true, value: true });
}

/** Reads the field as Review does and plans the fix "teh" -> "the". */
function planFix(root: HTMLElement): HostEditorReviewApplyRequest {
  const read = readReviewModel(root);
  if (!read) throw new Error("Review cannot read the editor");
  const start = read.text.indexOf("teh");
  const edits = [{ start, end: start + 3, original: "teh", replacement: "the" }];
  return {
    edits,
    before: read.text,
    after: applyEdits(read.text, edits)!,
    signature: read.signature,
  };
}

const compose = (root: HTMLElement, type: "compositionstart" | "compositionend") =>
  root.dispatchEvent(new window.CompositionEvent(type, { bubbles: true, data: "" }));

function expectFingerprintRefused(root: HTMLElement): void {
  markEditable(root);
  expect(readReviewModel(root)).toBeNull();
  const request = {
    edits: [{ start: 7, end: 10, original: "teh", replacement: "the" }],
    before: SEED,
    after: "We saw the cat.",
    signature: "[]",
  };
  expect(applyReviewModel(root, request)).toEqual({ status: "rejected", reason: "unsupported" });
  expect(root.textContent).toBe(SEED);
}

// ── Lexical ─────────────────────────────────────────────────────────
function mountLexical() {
  const root = document.body.appendChild(document.createElement("div"));
  root.setAttribute("contenteditable", "true");
  markEditable(root);
  const editor: LexicalEditor = createEditor({
    namespace: "ReviewModelEditorsTest",
    nodes: [HeadingNode, QuoteNode],
    onError(error) {
      throw error;
    },
  });
  editor.setRootElement(root);
  registerRichText(editor);
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      paragraph.append(
        $createTextNode("We saw "),
        $createTextNode("teh").toggleFormat("bold"),
        $createTextNode(" cat."),
      );
      $getRoot().clear().append(paragraph);
      paragraph.selectEnd();
    },
    { discrete: true },
  );
  // The seed is the user's document: the base state of the history, not a change.
  const history = createEmptyHistoryState();
  history.current = { editor, editorState: editor.getEditorState() };
  registerHistory(editor, history, 300);
  const read = <T>(callback: () => T) => editor.getEditorState().read(callback);
  return {
    root,
    editor,
    text: () => read(() => $getRoot().getTextContent()),
    bold: () =>
      read(() =>
        $getRoot()
          .getAllTextNodes()
          .filter((node) => node.hasFormat("bold"))
          .map((node) => node.getTextContent()),
      ),
    /** The collapsed caret as [text of its node, offset in that node]. */
    caret: () =>
      read(() => {
        const selection = $getSelection();
        return $isRangeSelection(selection) && selection.isCollapsed()
          ? [selection.anchor.getNode().getTextContent(), selection.anchor.offset]
          : null;
      }),
    type: (text: string) =>
      editor.update(() => $getSelection()?.insertText(text), { discrete: true }),
  };
}

describe("Review model writer – Lexical", () => {
  test("finds the editor from its root and refuses the fingerprint without an editor", () => {
    const { root } = mountLexical();
    expect(readReviewModel(root)?.text).toBe(SEED);

    const fake = document.body.appendChild(document.createElement("div"));
    fake.setAttribute("data-lexical-editor", "true");
    fake.setAttribute("contenteditable", "true");
    fake.textContent = SEED;
    expectFingerprintRefused(fake);
  });

  test("replaces one word in the model and keeps its bold mark and the caret", () => {
    const { root, text, bold, caret } = mountLexical();
    expect(caret()).toEqual([" cat.", 5]);
    expect(applyReviewModel(root, planFix(root))).toEqual({ status: "applied" });
    expect(text()).toBe("We saw the cat.");
    expect(root.textContent).toBe("We saw the cat.");
    expect(bold()).toEqual(["the"]);
    expect(root.querySelector("strong")?.textContent).toBe("the");
    expect(caret()).toEqual([" cat.", 5]);
  });

  test("one Undo removes only the Review edit and keeps earlier typing", async () => {
    const { root, editor, text, type } = mountLexical();
    type(" It ran.");
    expect(applyReviewModel(root, planFix(root))).toEqual({ status: "applied" });
    expect(text()).toBe("We saw the cat. It ran.");
    editor.dispatchCommand(UNDO_COMMAND, undefined);
    // Lexical commits the restored history state in a microtask.
    await Promise.resolve();
    expect(text()).toBe("We saw teh cat. It ran.");
    expect(root.textContent).toBe("We saw teh cat. It ran.");
  });

  test("refuses a write when the model changed after the read", () => {
    const { root, editor, text } = mountLexical();
    const request = planFix(root);
    // Only the formatting changes: the text stays the same, so only the signature differs.
    editor.update(() => $getRoot().getAllTextNodes()[2].toggleFormat("italic"), {
      discrete: true,
    });
    expect(text()).toBe(SEED);
    expect(applyReviewModel(root, request)).toEqual({ status: "stale" });
    expect(text()).toBe(SEED);
  });

  test("refuses reads and writes while Lexical composes, and writes after the composition", () => {
    const { root, editor, text } = mountLexical();
    const request = planFix(root);
    compose(root, "compositionstart");
    // Lexical also renders a composition suffix into the composed DOM text, so the
    // model/DOM text check refuses too: the composition state is a second guard.
    expect(editor.isComposing()).toBe(true);
    expect(readReviewModel(root)).toBeNull();
    expect(applyReviewModel(root, request)).toEqual({ status: "rejected", reason: "unsupported" });
    expect(text()).toBe(SEED);

    compose(root, "compositionend");
    expect(editor.isComposing()).toBe(false);
    expect(applyReviewModel(root, request)).toEqual({ status: "applied" });
    expect(text()).toBe("We saw the cat.");
  });
});

// ── Draft.js ────────────────────────────────────────────────────────
/** Runs a write inside act(), so React renders the state that Draft.js pushed. */
function inAct<T>(write: () => T): T {
  let result!: T;
  act(() => {
    result = write();
  });
  return result;
}

function mountDraft() {
  let latest = EditorState.createWithContent(
    convertFromRaw({
      blocks: [
        {
          key: "seed1",
          text: SEED,
          type: "unstyled",
          depth: 0,
          inlineStyleRanges: [{ offset: 7, length: 3, style: "BOLD" }],
          entityRanges: [],
          data: {},
        },
      ],
      entityMap: {},
    }),
  );
  let setState: (state: EditorState) => void = () => undefined;
  function App() {
    const [state, set] = useState(latest);
    setState = set;
    return createElement(Editor, {
      editorState: state,
      onChange(next: EditorState) {
        latest = next;
        set(next);
      },
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  act(() => {
    reactRoot = createRoot(container);
    reactRoot.render(createElement(App));
  });
  const root = container.querySelector<HTMLElement>(".public-DraftEditor-content")!;
  markEditable(root);
  const block = (): ContentBlock => latest.getCurrentContent().getBlockForKey("seed1");
  const set = (next: EditorState) =>
    act(() => {
      latest = next;
      setState(next);
    });
  const at = (offset: number, end = offset) =>
    SelectionState.createEmpty("seed1").merge({ anchorOffset: offset, focusOffset: end });
  // The caret at the end of the block, as after typing.
  set(EditorState.acceptSelection(latest, at(SEED.length)));
  return {
    root,
    state: () => latest,
    set,
    at,
    text: () => block().getText(),
    bold: () =>
      Array.from(block().getText())
        .filter((_, index) => block().getInlineStyleAt(index).has("BOLD"))
        .join(""),
    caret: () => [latest.getSelection().getAnchorOffset(), latest.getSelection().getFocusOffset()],
    apply: (request: HostEditorReviewApplyRequest) => inAct(() => applyReviewModel(root, request)),
  };
}

describe("Review model writer – Draft.js", () => {
  test("finds the editor component from its content root and refuses the fingerprint without an editor", () => {
    const { root } = mountDraft();
    expect(readReviewModel(root)?.text).toBe(SEED);

    const fake = document.body.appendChild(document.createElement("div"));
    fake.className = "public-DraftEditor-content";
    fake.setAttribute("contenteditable", "true");
    fake.textContent = SEED;
    expectFingerprintRefused(fake);
  });

  test("replaces one word in the model and keeps its bold style and the caret", () => {
    const { root, text, bold, caret, apply } = mountDraft();
    expect(apply(planFix(root))).toEqual({ status: "applied" });
    expect(text()).toBe("We saw the cat.");
    expect(root.textContent).toBe("We saw the cat.");
    expect(bold()).toBe("the");
    expect(root.querySelector<HTMLElement>('[style*="bold"]')?.textContent).toBe("the");
    expect(caret()).toEqual([SEED.length, SEED.length]);
  });

  test("one Undo removes only the Review edit and keeps earlier typing", () => {
    const { root, state, set, text, apply } = mountDraft();
    const typed = Modifier.insertText(
      state().getCurrentContent(),
      state().getSelection(),
      " It ran.",
    );
    set(EditorState.push(state(), typed, "insert-characters"));
    expect(apply(planFix(root))).toEqual({ status: "applied" });
    expect(text()).toBe("We saw the cat. It ran.");
    set(EditorState.undo(state()));
    expect(text()).toBe("We saw teh cat. It ran.");
    expect(root.textContent).toBe("We saw teh cat. It ran.");
  });

  test("refuses a write when the model changed after the read", () => {
    const { root, state, set, at, text, apply } = mountDraft();
    const request = planFix(root);
    // Only the style changes: the text stays the same, so only the signature differs.
    const styled = Modifier.applyInlineStyle(state().getCurrentContent(), at(11, 14), "ITALIC");
    set(EditorState.push(state(), styled, "change-inline-style"));
    expect(text()).toBe(SEED);
    expect(apply(request)).toEqual({ status: "stale" });
    expect(text()).toBe(SEED);
  });

  test("refuses reads and writes while Draft.js composes, and writes after the composition", async () => {
    const { root, state, text, apply } = mountDraft();
    const request = planFix(root);
    act(() => compose(root, "compositionstart"));
    expect(state().isInCompositionMode()).toBe(true);
    expect(readReviewModel(root)).toBeNull();
    expect(apply(request)).toEqual({ status: "rejected", reason: "unsupported" });
    expect(text()).toBe(SEED);

    act(() => compose(root, "compositionend"));
    // Draft.js leaves composition mode on its own timer, 20 ms after compositionend.
    for (let wait = 0; state().isInCompositionMode() && wait < 50; wait++)
      await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(state().isInCompositionMode()).toBe(false);
    expect(apply(request)).toEqual({ status: "applied" });
    expect(text()).toBe("We saw the cat.");
  });

  test("typing replaces the word before the caret in one undo step", () => {
    const { root, state, set, text, bold, caret } = mountDraft();
    // The user has typed "teh" and the caret is after it.
    const word = root.querySelector('[style*="bold"] [data-text="true"]')!.firstChild!;
    document.getSelection()!.collapse(word, 3);
    expect(modelBlockContext(root)).toEqual({
      beforeCursor: "We saw teh",
      afterCursor: " cat.",
      blockText: SEED,
    });
    const result = inAct(() =>
      replaceModelBlock(root, {
        expectedBlockText: SEED,
        replaceStart: 7,
        replaceEnd: 10,
        replacementText: "the",
        cursorAfter: 10,
      }),
    );
    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(text()).toBe("We saw the cat.");
    expect(root.textContent).toBe("We saw the cat.");
    expect(bold()).toBe("the");
    expect(caret()).toEqual([10, 10]);
    set(EditorState.undo(state()));
    expect(text()).toBe(SEED);
  });

  /** Puts text into the DOM after " cat." that the model does not have: native typing before Draft.js takes it. */
  function typeAheadOfModel(root: HTMLElement, typed: string): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node as Text).data !== " cat.") continue;
      (node as Text).data += typed;
      return;
    }
    throw new Error("No text node holds ' cat.'");
  }

  /** Turns the MAIN-world bridge on, as the content script does, for the Review target. */
  function enableBridge(enabled: boolean): void {
    document.documentElement.setAttribute(HOST_EDITOR_ENABLED_ATTR, String(enabled));
    document.dispatchEvent(new Event(HOST_EDITOR_ENABLED_EVENT));
    document.documentElement.removeAttribute(HOST_EDITOR_ENABLED_ATTR);
  }
  beforeEach(() => enableBridge(true));
  afterEach(() => enableBridge(false));

  test("a DOM ahead of the model when Review opens gets Apply after the model takes the text", async () => {
    const { root, state, set, text } = mountDraft();
    typeAheadOfModel(root, " It");
    const target = new ContentEditableReviewTarget(root);
    expect(target.capabilities).toEqual({ apply: false, bulk: false });
    // Draft.js takes the typed text into its model, and the DOM already shows it.
    const content = Modifier.insertText(state().getCurrentContent(), state().getSelection(), " It");
    set(EditorState.push(state(), content, "insert-characters"));
    expect(text()).toBe(`${SEED} It`);

    const read = target.read();
    expect(target.capabilities).toEqual({ apply: true, bulk: true });
    if (!read.ok) throw new Error(`Review cannot read the editor: ${read.reason}`);
    expect(read.text).toBe(`${SEED} It`);
    const edits = [{ start: 7, end: 10, original: "teh", replacement: "the" }];
    const request = {
      edits,
      before: read.text,
      after: applyEdits(read.text, edits)!,
      signature: read.signature,
    };
    // The target waits for React to render the write, as in a browser. act() would
    // keep the render until the write returns, so React renders on its own here.
    globals.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      expect((await target.apply(request)).status).toBe("applied");
    } finally {
      globals.IS_REACT_ACT_ENVIRONMENT = true;
    }
    expect(text()).toBe("We saw the cat. It");
    // One Undo removes the Review edit only.
    set(EditorState.undo(state()));
    expect(text()).toBe(`${SEED} It`);
  });

  test("an open Review loses its Review-only note when the model takes the text", async () => {
    const { root, state, set } = mountDraft();
    typeAheadOfModel(root, " It");
    act(() => root.focus());
    const review = createReviewController();
    const notes = () =>
      document.querySelector("[data-fluenttyper-review]")?.shadowRoot?.querySelector(".notes")
        ?.textContent ?? "";
    // The open Review checks the editor once a second. Its events can update Draft.js.
    const until = async (condition: () => boolean) => {
      for (let wait = 0; !condition() && wait < 60; wait++) await act(() => Bun.sleep(50));
      expect(condition()).toBe(true);
    };
    try {
      act(() => review.invoke());
      await until(() => notes().includes("Review only"));
      const content = Modifier.insertText(
        state().getCurrentContent(),
        state().getSelection(),
        " It",
      );
      set(EditorState.push(state(), content, "insert-characters"));
      await until(() => !notes().includes("Review only"));
    } finally {
      act(() => review.close());
    }
  });

  test("DOM text that the model never takes keeps the editor Review-only and writes nothing", async () => {
    const { root, text } = mountDraft();
    typeAheadOfModel(root, " It");
    const target = new ContentEditableReviewTarget(root);
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = target.read();
      expect(read.ok && read.text).toBe(`${SEED} It`);
      expect(target.capabilities).toEqual({ apply: false, bulk: false });
    }
    const request = {
      edits: [{ start: 7, end: 10, original: "teh", replacement: "the" }],
      before: `${SEED} It`,
      after: "We saw the cat. It",
      signature: "[]",
    };
    expect(await target.apply(request)).toEqual({ status: "rejected", reason: "unsupported" });
    expect(applyReviewModel(root, request)).toEqual({ status: "rejected", reason: "unsupported" });
    expect(text()).toBe(SEED);
    expect(root.textContent).toBe(`${SEED} It`);
  });
});

// ── Trix ────────────────────────────────────────────────────────────
interface TrixElement extends HTMLElement {
  editor: {
    getDocument(): {
      toString(): string;
      getCommonAttributesAtRange(range: [number, number]): { bold?: boolean };
    };
    getSelectedRange(): [number, number];
    setSelectedRange(range: [number, number]): void;
    insertString(text: string): void;
    activateAttribute(name: string): void;
    recordUndoEntry(description: string, options?: { consolidatable?: boolean }): void;
    undo(): void;
  };
}

async function mountTrix() {
  const input = document.createElement("input");
  input.type = "hidden";
  input.id = "review-model-trix-input";
  // Trix keeps blocks as <div>: this is the seed paragraph in its own markup.
  input.value = "<div>We saw <strong>teh</strong> cat.</div>";
  const element = document.createElement("trix-editor") as TrixElement;
  element.setAttribute("input", input.id);
  const ready = new Promise((resolve) => element.addEventListener("trix-initialize", resolve));
  document.body.append(input, element);
  await ready;
  markEditable(element);
  const { editor } = element;
  editor.setSelectedRange([SEED.length, SEED.length]);
  // The document string ends with the last block's newline.
  const text = () => editor.getDocument().toString().replace(/\n$/, "");
  return {
    element,
    editor,
    text,
    bold: () =>
      Array.from(text())
        .filter(
          (_, index) =>
            editor.getDocument().getCommonAttributesAtRange([index, index + 1]).bold === true,
        )
        .join(""),
  };
}

describe("Review model writer – Trix", () => {
  test("finds the editor from the trix-editor element and refuses the fingerprint without an editor", async () => {
    const { element } = await mountTrix();
    expect(readReviewModel(element)?.text).toBe(SEED);

    // A document without a browsing context does not upgrade custom elements:
    // the element has the Trix tag but no Trix editor.
    const other = document.implementation.createHTMLDocument();
    const fake = other.body.appendChild(other.createElement("trix-editor"));
    fake.setAttribute("contenteditable", "true");
    fake.textContent = SEED;
    expect("editor" in fake).toBe(false);
    expectFingerprintRefused(fake);
  });

  test("replaces one word in the model and keeps its bold attribute and the caret", async () => {
    const { element, editor, text, bold } = await mountTrix();
    expect(applyReviewModel(element, planFix(element))).toEqual({ status: "applied" });
    expect(text()).toBe("We saw the cat.");
    expect(element.textContent).toBe("We saw the cat.");
    expect(bold()).toBe("the");
    expect(element.querySelector("strong")?.textContent).toBe("the");
    expect(editor.getSelectedRange()).toEqual([SEED.length, SEED.length]);
  });

  test("one Undo removes only the Review edit and keeps earlier typing", async () => {
    const { element, editor, text } = await mountTrix();
    // Trix records typing as a consolidatable undo entry before it inserts the text.
    editor.recordUndoEntry("Typing", { consolidatable: true });
    editor.insertString(" It ran.");
    expect(applyReviewModel(element, planFix(element))).toEqual({ status: "applied" });
    expect(text()).toBe("We saw the cat. It ran.");
    editor.undo();
    expect(text()).toBe("We saw teh cat. It ran.");
    expect(element.textContent).toBe("We saw teh cat. It ran.");
  });

  test("refuses a write when the model changed after the read", async () => {
    const { element, editor, text } = await mountTrix();
    const request = planFix(element);
    // Only the formatting changes: the text stays the same, so only the signature differs.
    editor.setSelectedRange([11, 14]);
    editor.activateAttribute("italic");
    expect(text()).toBe(SEED);
    expect(applyReviewModel(element, request)).toEqual({ status: "stale" });
    expect(text()).toBe(SEED);
  });

  test("refuses reads and writes during a composition that the bridge records, and writes after it", async () => {
    const { element, text } = await mountTrix();
    const request = planFix(element);
    compose(element, "compositionstart");
    expect(readReviewModel(element)).toBeNull();
    expect(applyReviewModel(element, request)).toEqual({
      status: "rejected",
      reason: "unsupported",
    });
    expect(text()).toBe(SEED);

    compose(element, "compositionend");
    expect(applyReviewModel(element, request)).toEqual({ status: "applied" });
    expect(text()).toBe("We saw the cat.");
  });

  test("typing replaces the word before the caret in one undo step", async () => {
    const { element, editor, text, bold } = await mountTrix();
    // The user has typed "teh" and the caret is after it.
    document.getSelection()!.collapse(element.querySelector("strong")!.firstChild!, 3);
    expect(modelBlockContext(element)).toEqual({
      beforeCursor: "We saw teh",
      afterCursor: " cat.",
      blockText: SEED,
    });
    expect(
      replaceModelBlock(element, {
        expectedBlockText: SEED,
        replaceStart: 7,
        replaceEnd: 10,
        replacementText: "the",
        cursorAfter: 10,
      }),
    ).toEqual({ applied: true, didDispatchInput: false });
    expect(text()).toBe("We saw the cat.");
    expect(element.textContent).toBe("We saw the cat.");
    expect(bold()).toBe("the");
    expect(editor.getSelectedRange()).toEqual([10, 10]);
    editor.undo();
    expect(text()).toBe(SEED);
  });
});
