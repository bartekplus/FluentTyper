import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { createEditor, setCaret } from "./codeContextTestUtils";
import {
  buildContentEditableTextMap,
  domPositionToOffset,
  offsetRangeToDomRange,
} from "../src/adapters/chrome/content-script/review/ContentEditableTextMap";
import {
  ContentEditableReviewTarget,
  TextControlReviewTarget,
  resolveReviewTarget,
} from "../src/adapters/chrome/content-script/review/ReviewTargets";
import { ReviewController } from "../src/adapters/chrome/content-script/review/ReviewController";
import {
  ReviewLauncher,
  launcherFieldFor,
} from "../src/adapters/chrome/content-script/review/ReviewLauncher";
import { windowReviewable } from "../src/adapters/chrome/content-script/review/GoogleDocsReviewTarget";
import { REVIEW_HIGHLIGHT_NAMES } from "../src/adapters/chrome/content-script/review/reviewStyles";
import { GRAMMAR_RULE_IDS } from "../src/core/domain/grammar/ruleCatalog";
import type { ReviewEdit } from "../src/core/domain/grammar/review/types";
import * as fs from "fs";
import path from "path";

type ExecCommand = (command: string, showUi?: boolean, value?: string) => boolean;

function setExecCommand(implementation: ExecCommand | null): void {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: implementation ?? (() => false),
  });
}

/** Browser-like insertText for text controls: replaces the selection, fires input. */
const textControlInsert: ExecCommand = (command, _ui, value = "") => {
  const field = document.activeElement as HTMLTextAreaElement;
  field.setRangeText(
    command === "delete" ? "" : value,
    field.selectionStart!,
    field.selectionEnd!,
    "end",
  );
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
};

/** Browser-like insertText for contenteditable: replaces the selected range in place. */
const contentEditableInsert: ExecCommand = (command, _ui, value = "") => {
  const range = document.getSelection()!.getRangeAt(0);
  const start = range.startContainer;
  if (start.nodeType === 3 && range.startContainer === range.endContainer) {
    const text = start as Text;
    text.data =
      text.data.slice(0, range.startOffset) +
      (command === "delete" ? "" : value) +
      text.data.slice(range.endOffset);
    return true;
  }
  range.deleteContents();
  if (command !== "delete") range.insertNode(document.createTextNode(value));
  return true;
};

function textarea(value: string): HTMLTextAreaElement {
  const field = document.createElement("textarea");
  field.value = value;
  document.body.append(field);
  field.focus();
  return field;
}

function edit(start: number, end: number, original: string, replacement: string): ReviewEdit {
  return { start, end, original, replacement };
}

beforeEach(() => {
  // Other suites share this document; a leftover editable body would be "the editor".
  document.body.removeAttribute("contenteditable");
  delete (document.body as { isContentEditable?: boolean }).isContentEditable;
  document.designMode = "off";
});

afterEach(() => {
  jest.restoreAllMocks();
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  document.querySelectorAll("[data-fluenttyper-review]").forEach((node) => node.remove());
  setExecCommand(null);
});

describe("contenteditable text map", () => {
  test("blocks and <br> become virtual line breaks; islands become objects", () => {
    const root = createEditor(
      '<p>One <b>two</b></p><p>three<br>four</p><p>see <span contenteditable="false">@Ann</span> now</p>',
    );
    const map = buildContentEditableTextMap(root);
    expect(map.text).toBe("One two\nthree\nfour\nsee \uFFFC now");
    expect(map.protectedRanges).toEqual([
      { start: 7, end: 8, reason: "structure" },
      { start: 13, end: 14, reason: "structure" },
      { start: 18, end: 19, reason: "structure" },
      { start: 23, end: 24, reason: "structure" },
    ]);
  });

  test("code, pre, kbd and Quill code blocks are code ranges, read in place", () => {
    const root = createEditor(
      '<p>run <code>teh x</code> now</p><div class="ql-code-block">teh</div><p>press <kbd>Ctrl</kbd></p>',
    );
    const map = buildContentEditableTextMap(root);
    expect(map.text).toBe("run teh x now\nteh\npress Ctrl");
    const code = map.protectedRanges.filter((range) => range.reason === "code");
    expect(code.map((range) => map.text.slice(range.start, range.end))).toEqual([
      "teh x",
      "teh",
      "Ctrl",
    ]);
  });

  test("collapsed whitespace reads as one protected space; preserved whitespace maps 1:1", () => {
    const collapsed = createEditor('<p style="white-space: normal">a \n   b c</p>');
    const map = buildContentEditableTextMap(collapsed);
    expect(map.text).toBe("a b c");
    // The "\n   " run is one visible space, never an edit target; "b c" maps 1:1.
    expect(map.protectedRanges).toContainEqual({ start: 1, end: 2, reason: "structure" });
    const preserved = createEditor('<p style="white-space: pre-wrap">a  b</p>');
    expect(buildContentEditableTextMap(preserved).text).toBe("a  b");
  });

  test("offsets round-trip, and a range never spills into a neighboring node", () => {
    const root = createEditor("<p>We saw <b>teh</b> cat</p>");
    const map = buildContentEditableTextMap(root);
    const range = offsetRangeToDomRange(map, { start: 7, end: 10 }, document)!;
    expect(range.toString()).toBe("teh");
    expect(range.startContainer.parentElement?.tagName).toBe("B");
    expect(range.endContainer.parentElement?.tagName).toBe("B");
    expect(domPositionToOffset(map, range.startContainer, range.startOffset)).toBe(7);
    expect(domPositionToOffset(map, root.firstChild!, 1)).toBe(7);
    // A virtual separator cannot be addressed as editable text.
    const multi = createEditor("<p>a</p><p>b</p>");
    expect(
      offsetRangeToDomRange(buildContentEditableTextMap(multi), { start: 1, end: 2 }, document),
    ).toBeNull();
  });

  test("the signature changes when text becomes code without changing characters", () => {
    const root = createEditor("<p>see teh cat</p>");
    const before = buildContentEditableTextMap(root);
    root.innerHTML = "<p>see <code>teh</code> cat</p>";
    const after = buildContentEditableTextMap(root);
    expect(after.text).toBe(before.text);
    expect(after.signature).not.toBe(before.signature);
  });
});

describe("resolving the review target before any UI opens", () => {
  test("a textarea selection becomes the scope; a caret means the whole field", () => {
    const field = textarea("one teh two");
    field.setSelectionRange(4, 7);
    const selected = resolveReviewTarget(document);
    expect(selected.ok && selected.scope).toEqual({ start: 4, end: 7 });
    field.setSelectionRange(2, 2);
    const whole = resolveReviewTarget(document);
    expect(whole.ok && whole.scope).toBeNull();
    expect(whole.ok && whole.target).toBeInstanceOf(TextControlReviewTarget);
  });

  test("sensitive, locked and non-text fields are excluded", () => {
    const cases: Array<(input: HTMLInputElement) => void> = [
      (input) => (input.type = "password"),
      (input) => (input.type = "email"),
      (input) => input.setAttribute("autocomplete", "one-time-code"),
      (input) => input.setAttribute("autocomplete", "cc-number"),
      (input) => (input.name = "cvv"),
      (input) => input.setAttribute("inputmode", "numeric"),
      (input) => (input.readOnly = true),
    ];
    for (const configure of cases) {
      document.body.replaceChildren();
      const input = document.createElement("input");
      input.type = "text";
      configure(input);
      document.body.append(input);
      input.focus();
      expect(resolveReviewTarget(document)).toEqual({ ok: false, reason: "sensitive" });
    }
  });

  test("code editors and code hosts are not prose", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "CodeMirror";
    const field = document.createElement("textarea");
    wrapper.append(field);
    document.body.append(wrapper);
    field.focus();
    expect(resolveReviewTarget(document)).toEqual({ ok: false, reason: "sensitive" });
  });

  test("nothing focused means no editor, never the page", () => {
    expect(resolveReviewTarget(document)).toEqual({ ok: false, reason: "no-editor" });
  });

  test("a contenteditable selection inside the editor is the scope; crossing out fails safely", () => {
    const root = createEditor("<p>Hello teh world</p>");
    root.tabIndex = 0;
    root.focus();
    const text = root.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 9);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    const inside = resolveReviewTarget(document);
    expect(inside.ok && inside.scope).toEqual({ start: 6, end: 9 });

    const outside = document.createElement("p");
    outside.textContent = "page text";
    document.body.append(outside);
    const crossing = document.createRange();
    crossing.setStart(text, 2);
    crossing.setEnd(outside.firstChild!, 4);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(crossing);
    expect(resolveReviewTarget(document)).toEqual({ ok: false, reason: "cross-selection" });
  });
});

describe("Google Docs review window", () => {
  const cut = (text: string, windowStart: number, documentLength: number) =>
    windowReviewable({
      token: "t",
      scope: "doc",
      text,
      windowStart,
      documentLength,
      anchor: windowStart,
      focus: windowStart,
    });

  test("a window cut from a longer document starts at a sentence and ends at a word", () => {
    const text = "rds here. Next one\nPara two. Final wo";
    const reviewable = cut(text, 100, 100 + text.length + 50);
    expect(text.slice(reviewable.start, reviewable.end)).toBe("Next one\nPara two. Final ");
    // A paragraph break is a start too; with neither, the first word start.
    expect(cut("rds\nNext", 5, 100).start).toBe(4);
    expect(cut("rds next", 5, 100).start).toBe(4);
  });

  test("a document read whole, or an edge at the document boundary, is not cut", () => {
    expect(cut("whole doc", 0, 9)).toEqual({ start: 0, end: 9 });
    expect(cut("start of doc wo", 0, 100)).toEqual({ start: 0, end: 13 });
    expect(cut("ail. end", 50, 58)).toEqual({ start: 5, end: 8 });
  });
});

describe("text control writes", () => {
  test("one verified native edit for several fixes; selection is carried through", async () => {
    setExecCommand(textControlInsert);
    const field = textarea("teh cat , teh dog");
    field.setSelectionRange(17, 17);
    const target = new TextControlReviewTarget(field);
    let inserts = 0;
    setExecCommand((...args) => {
      inserts += 1;
      return textControlInsert(...args);
    });
    const result = await target.apply({
      edits: [edit(10, 13, "teh", "the"), edit(7, 8, " ", ""), edit(0, 3, "teh", "the")],
      before: "teh cat , teh dog",
      after: "the cat, the dog",
    });
    expect(result).toEqual({ status: "applied" });
    expect(field.value).toBe("the cat, the dog");
    expect(inserts).toBe(1);
    expect(field.selectionStart).toBe(16);
  });

  test("a caret or selection between separate fixes keeps its place", async () => {
    setExecCommand(textControlInsert);
    const request = {
      edits: [edit(1, 3, "eh", "he"), edit(13, 15, "eh", "he")],
      before: "teh cat and teh dog",
      after: "the cat and the dog",
    };
    const caret = textarea(request.before);
    caret.setSelectionRange(5, 5);
    expect(await new TextControlReviewTarget(caret).apply(request)).toEqual({
      status: "applied",
    });
    expect([caret.selectionStart, caret.selectionEnd]).toEqual([5, 5]);
    caret.remove();

    const selected = textarea(request.before);
    selected.setSelectionRange(4, 11, "backward");
    expect(await new TextControlReviewTarget(selected).apply(request)).toEqual({
      status: "applied",
    });
    expect(selected.value.slice(selected.selectionStart!, selected.selectionEnd!)).toBe("cat and");
    expect(selected.selectionDirection).toBe("backward");
  });

  test("a focus handler that changes the field makes the write fail without mutation", async () => {
    setExecCommand(textControlInsert);
    const request = { edits: [edit(1, 3, "eh", "he")], before: "teh cat", after: "the cat" };
    const field = textarea(request.before);
    field.blur();
    field.addEventListener("focus", () => (field.value = `PREFIX: ${field.value}`), {
      once: true,
    });
    expect(await new TextControlReviewTarget(field).apply(request)).toEqual({ status: "stale" });
    expect(field.value).toBe("PREFIX: teh cat");

    const locked = textarea(request.before);
    locked.blur();
    locked.addEventListener("focus", () => (locked.readOnly = true), { once: true });
    expect(await new TextControlReviewTarget(locked).apply(request)).toEqual({
      status: "rejected",
      reason: "ineligible",
    });
    expect(locked.value).toBe("teh cat");
  });

  test("a control without a native edit is refused, never written outside undo", async () => {
    setExecCommand(() => false);
    const field = textarea("teh cat");
    field.setSelectionRange(7, 7);
    expect(
      await new TextControlReviewTarget(field).apply({
        edits: [edit(1, 3, "eh", "he")],
        before: "teh cat",
        after: "the cat",
      }),
    ).toEqual({ status: "rejected", reason: "host-refused" });
    expect(field.value).toBe("teh cat");
    expect([field.selectionStart, field.selectionEnd]).toEqual([7, 7]);
  });

  test("stale text, composition and a host that rewrites the value are refused", async () => {
    setExecCommand(textControlInsert);
    const field = textarea("teh cat");
    const target = new TextControlReviewTarget(field);
    const request = { edits: [edit(0, 3, "teh", "the")], before: "teh", after: "the" };
    expect(await target.apply(request)).toEqual({ status: "stale" });
    target.composing = true;
    expect(await target.apply({ ...request, before: "teh cat", after: "the cat" })).toEqual({
      status: "rejected",
      reason: "composing",
    });
    target.composing = false;
    // A host that normalizes the value differently: reported, not trusted.
    setExecCommand(() => {
      field.value = "THE cat";
      return true;
    });
    expect(await target.apply({ ...request, before: "teh cat", after: "the cat" })).toEqual({
      status: "unverified",
    });
    field.disabled = true;
    expect(target.read()).toEqual({ ok: false, reason: "ineligible" });
  });
});

describe("contenteditable writes", () => {
  test("minimal edits inside text nodes keep formatting and are verified", async () => {
    setExecCommand(contentEditableInsert);
    const root = createEditor("<p>We saw <b>teh</b> cat , ok</p>");
    const target = new ContentEditableReviewTarget(root);
    const read = target.read();
    if (!read.ok) throw new Error("unreadable");
    const result = await target.apply({
      edits: [edit(14, 15, " ", ""), edit(8, 10, "eh", "he")],
      before: read.text,
      after: "We saw the cat, ok",
      signature: read.signature,
    });
    expect(result).toEqual({ status: "applied" });
    expect(root.innerHTML).toBe("<p>We saw <b>the</b> cat, ok</p>");
  });

  test("a long batch yields to the page and continues only while nothing changed", async () => {
    setExecCommand(contentEditableInsert);
    // Every clock read is 100 ms later: the batch yields before each edit.
    let clock = 0;
    jest.spyOn(window.performance, "now").mockImplementation(() => (clock += 100));
    const request = (root: HTMLElement) => {
      const read = new ContentEditableReviewTarget(root).read();
      if (!read.ok) throw new Error("unreadable");
      return {
        edits: [edit(1, 3, "eh", "he"), edit(9, 11, "eh", "he")],
        before: read.text,
        after: "the and the",
        signature: read.signature,
      };
    };

    const calm = createEditor("<p>teh and <b>teh</b></p>");
    calm.tabIndex = 0;
    expect(await new ContentEditableReviewTarget(calm).apply(request(calm))).toEqual({
      status: "applied",
    });
    expect(calm.innerHTML).toBe("<p>the and <b>the</b></p>");

    // The user types during a pause: the batch stops and says how far it got.
    const busy = createEditor("<p>teh and <b>teh</b></p>");
    busy.tabIndex = 0;
    const pending = new ContentEditableReviewTarget(busy).apply(request(busy));
    await new Promise((resolve) => setTimeout(resolve, 0));
    busy.querySelector("b")!.append("!");
    expect(await pending).toEqual({ status: "partial", applied: 1 });
    expect(busy.innerHTML).toBe("<p>teh and <b>the!</b></p>");

    // Focus moved elsewhere during a pause: nothing more is written.
    const left = createEditor("<p>teh and <b>teh</b></p>");
    left.tabIndex = 0;
    const other = textarea("elsewhere");
    const pendingLeft = new ContentEditableReviewTarget(left).apply(request(left));
    other.focus();
    expect(await pendingLeft).toEqual({ status: "stale" });
    expect(left.innerHTML).toBe("<p>teh and <b>teh</b></p>");
  });

  test("formatting-only changes make a pending fix stale", async () => {
    setExecCommand(contentEditableInsert);
    const root = createEditor("<p>see teh cat</p>");
    const target = new ContentEditableReviewTarget(root);
    const read = target.read();
    if (!read.ok) throw new Error("unreadable");
    root.innerHTML = "<p>see <code>teh</code> cat</p>";
    expect(
      await target.apply({
        edits: [edit(5, 7, "eh", "he")],
        before: read.text,
        after: "see the cat",
        signature: read.signature,
      }),
    ).toEqual({ status: "stale" });
    expect(root.textContent).toBe("see teh cat");
  });

  test("a host that ignores the edit is reported as refused, never as success", async () => {
    setExecCommand(() => true);
    const root = createEditor("<p>teh</p>");
    const target = new ContentEditableReviewTarget(root);
    const read = target.read();
    if (!read.ok) throw new Error("unreadable");
    expect(
      await target.apply({
        edits: [edit(1, 3, "eh", "he")],
        before: "teh",
        after: "the",
        signature: read.signature,
      }),
    ).toEqual({ status: "rejected", reason: "host-refused" });
  });

  test("model-backed editors are review-only; Quill is writable", () => {
    const prose = createEditor("<p>x</p>");
    prose.className = "ProseMirror";
    expect(new ContentEditableReviewTarget(prose).capabilities).toEqual({
      inline: true,
      apply: false,
      bulk: false,
      undo: "none",
    });
    const container = document.createElement("div");
    container.className = "ql-container";
    const quill = createEditor("<p>x</p>");
    quill.className = "ql-editor";
    container.append(quill);
    document.body.append(container);
    expect(new ContentEditableReviewTarget(quill).kind).toBe("quill");
    expect(new ContentEditableReviewTarget(quill).capabilities.apply).toBe(true);
  });
});

describe("in-field review button", () => {
  const launcherButton = () =>
    document
      .querySelector("[data-fluenttyper-review-launcher]")
      ?.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? null;
  const shown = () => {
    const button = launcherButton();
    return !!button && !button.hidden;
  };
  function sized(element: HTMLElement, rect = { left: 100, top: 50, width: 300, height: 120 }) {
    element.getBoundingClientRect = () =>
      ({
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
      }) as DOMRect;
    return element;
  }
  function launcher(overrides: Partial<ConstructorParameters<typeof ReviewLauncher>[1]> = {}) {
    const review = jest.fn();
    const instance = new ReviewLauncher(document, {
      isEnabled: () => true,
      canShowFor: () => true,
      reviewedElement: () => null,
      review,
      uiLanguage: "en",
      ...overrides,
    });
    return { instance, review };
  }
  const focusIn = (element: HTMLElement) => {
    element.focus();
    element.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true, composed: true }));
  };

  test("only multi-line editors the review can read get a button", () => {
    const area = document.createElement("textarea");
    const input = document.createElement("input");
    const locked = document.createElement("textarea");
    locked.readOnly = true;
    const rich = createEditor("<p>Some text</p>");
    const single = createEditor("<p>Some text</p>");
    single.setAttribute("aria-multiline", "false");
    document.body.append(area, input, locked);
    expect(launcherFieldFor(area)).toBe(area);
    expect(launcherFieldFor(input)).toBeNull();
    expect(launcherFieldFor(locked)).toBeNull();
    // (jsdom does not inherit isContentEditable to children; the e2e covers a caret inside.)
    expect(launcherFieldFor(rich)).toBe(rich);
    expect(launcherFieldFor(single)).toBeNull();
  });

  test("shows on the focused field with text, in its corner; clicking reviews that field", () => {
    const field = sized(textarea("We saw teh cat."));
    const other = sized(textarea("Another box."), { left: 100, top: 300, width: 300, height: 120 });
    const { instance, review } = launcher();
    focusIn(field);
    expect(shown()).toBe(true);
    // Bottom inline-end corner, inside the field: 100 + 300 - 6 - 24, 50 + 120 - 6 - 24.
    expect(launcherButton()!.style.left).toBe("370px");
    expect(launcherButton()!.style.top).toBe("140px");
    expect(launcherButton()!.getAttribute("aria-label")).toBe("Review this text (FluentTyper)");
    // The page's markup and layout are untouched: the button lives in its own host.
    expect(field.style.paddingRight).toBe("");

    launcherButton()!.click();
    expect(review).toHaveBeenCalledWith(field);
    expect(review).not.toHaveBeenCalledWith(other);
    instance.dispose();
    expect(document.querySelector("[data-fluenttyper-review-launcher]")).toBeNull();
  });

  test("hidden without text, while typing, during its review, and when turned off", async () => {
    const field = sized(textarea(""));
    let reviewed: HTMLElement | null = null;
    let enabled = true;
    const { instance } = launcher({
      reviewedElement: () => reviewed,
      isEnabled: () => enabled,
    });
    focusIn(field);
    expect(shown()).toBe(false);

    field.value = "Now some text";
    field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    // Typing: out of the way until the user pauses.
    expect(shown()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(shown()).toBe(true);

    reviewed = field;
    instance.refresh();
    expect(shown()).toBe(false);
    reviewed = null;
    enabled = false;
    instance.refresh();
    expect(shown()).toBe(false);
    enabled = true;
    instance.refresh();
    expect(shown()).toBe(true);

    // Leaving the field hides it; too small a field never gets one.
    field.blur();
    field.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true, composed: true }));
    expect(shown()).toBe(false);
    const tiny = sized(textarea("Some text here"), { left: 0, top: 0, width: 80, height: 20 });
    focusIn(tiny);
    expect(shown()).toBe(false);
    instance.dispose();
  });

  test("one icon per field: the enable icon wins until FluentTyper is on there", () => {
    const field = sized(textarea("Some text here"));
    let awaitingEnable = true;
    const { instance } = launcher({ canShowFor: () => !awaitingEnable });
    focusIn(field);
    expect(shown()).toBe(false);
    awaitingEnable = false;
    instance.refresh();
    expect(shown()).toBe(true);
    instance.dispose();
  });
});

describe("review controller lifecycle", () => {
  async function until(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("condition not reached");
  }

  function controller() {
    const suspend = jest.fn();
    const resume = jest.fn();
    const review = new ReviewController({
      getOptions: () => ({
        lang: "en_US",
        enabledRules: GRAMMAR_RULE_IDS,
        userDictionary: [],
        insertSpaceAfterAutocomplete: true,
      }),
      suspend,
      resume,
      addToDictionary: async () => true,
      getDocsSurface: () => null,
      uiLanguage: "en",
    });
    return { review, suspend, resume };
  }

  const root = () => document.querySelector("[data-fluenttyper-review]")?.shadowRoot ?? null;

  test("invoke reads only, shows results, and Escape restores everything", async () => {
    const field = textarea("We saw teh cat.");
    const { review, suspend, resume } = controller();
    review.invoke();
    expect(field.value).toBe("We saw teh cat.");
    expect(suspend).toHaveBeenCalledWith(field);
    await until(() => root()?.querySelector(".status")?.textContent === "Issues: 1");
    expect(root()!.querySelector(".item .change")?.textContent).toBe("teh \u2192 the");
    // No CSS Custom Highlight API here: the overlay path is used and nothing is registered.
    expect((globalThis as { CSS?: { highlights?: unknown } }).CSS?.highlights).toBeUndefined();

    const KeyboardEventCtor = (window as unknown as { KeyboardEvent: typeof KeyboardEvent })
      .KeyboardEvent;
    field.dispatchEvent(new KeyboardEventCtor("keydown", { key: "Escape", bubbles: true }));
    expect(review.isActive).toBe(false);
    expect(resume).toHaveBeenCalledWith(field);
    expect(root()).toBeNull();
    // Listeners are gone: edits after closing are not observed.
    field.value = "changed";
    field.dispatchEvent(new Event("input"));
    expect(field.value).toBe("changed");
  });

  test("editing invalidates at once; results come back after the pause", async () => {
    const field = textarea("We saw teh cat.");
    const { review } = controller();
    review.invoke();
    await until(() => root()?.querySelector(".status")?.textContent === "Issues: 1");
    field.value = "We saw teh cat and teh dog.";
    field.dispatchEvent(new Event("input"));
    expect(root()!.querySelector(".status")?.textContent).toBe("Text changed. Updating\u2026");
    expect(root()!.querySelectorAll(".item")).toHaveLength(0);
    await until(() => root()?.querySelector(".status")?.textContent === "Issues: 2");
    review.close();
  });

  test("invoking again on the same editor focuses the panel instead of restarting", async () => {
    textarea("teh");
    const { review, suspend } = controller();
    review.invoke();
    review.invoke();
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("[data-fluenttyper-review]")).toHaveLength(1);
    review.close();
  });

  test("an unsupported target explains itself instead of scanning", () => {
    const input = document.createElement("input");
    input.type = "password";
    document.body.append(input);
    input.focus();
    const { review, suspend } = controller();
    review.invoke();
    expect(suspend).not.toHaveBeenCalled();
    expect(root()?.querySelector(".status")?.textContent).toContain("excluded from review");
    review.dispose();
    expect(root()).toBeNull();
  });

  test("only FluentTyper's own highlight names are ever touched", () => {
    const names = Object.values(REVIEW_HIGHLIGHT_NAMES);
    expect(names.every((name) => name.startsWith("fluenttyper-review-"))).toBe(true);
    // The page stylesheet styles exactly these names.
    const css = fs.readFileSync(
      path.resolve(import.meta.dir, "../public/suggestions/suggestions.css"),
      "utf8",
    );
    for (const name of names) expect(css).toContain(`::highlight(${name})`);
  });
});

describe("adversarial review regressions", () => {
  async function until(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    for (let i = 0; i < timeoutMs / 5; i += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("condition not reached");
  }
  const hosts = () => document.querySelectorAll("[data-fluenttyper-review]");
  const options = () => ({
    lang: "en_US",
    enabledRules: GRAMMAR_RULE_IDS,
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
  });

  test("a text-control fix is refused when focus cannot move to the field", async () => {
    setExecCommand(textControlInsert);
    const field = textarea("teh cat");
    const other = createEditor("<p>Other editor text.</p>");
    other.tabIndex = 0;
    const target = new TextControlReviewTarget(field);
    // The page keeps focus elsewhere (a hidden field cannot take it either).
    jest.spyOn(field, "focus").mockImplementation(() => other.focus());
    other.focus();
    expect(
      await target.apply({ edits: [edit(1, 3, "eh", "he")], before: "teh cat", after: "the cat" }),
    ).toEqual({ status: "rejected", reason: "host-refused" });
    expect(field.value).toBe("teh cat");
    expect(other.textContent).toBe("Other editor text.");
  });

  test("autocomplete tokens are case-insensitive; more secret names are refused", () => {
    for (const [attribute, value] of [
      ["autocomplete", "One-Time-Code"],
      ["autocomplete", "CC-Number"],
      ["name", "mfa_code"],
      ["name", "ssn"],
      ["id", "verification-code"],
      ["name", "cc_number"],
    ] as const) {
      const field = document.createElement("input");
      field.setAttribute(attribute, value);
      document.body.append(field);
      field.focus();
      expect(resolveReviewTarget(document)).toEqual({ ok: false, reason: "sensitive" });
      field.remove();
    }
  });

  test("editors that keep their own model (Trix, TinyMCE, CKEditor 4) are review-only", () => {
    for (const html of [
      '<trix-editor contenteditable="true"></trix-editor>',
      '<div class="mce-content-body" contenteditable="true"></div>',
      '<div class="cke_editable" contenteditable="true"></div>',
    ]) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      const editor = wrapper.firstElementChild as HTMLElement;
      Object.defineProperty(editor, "isContentEditable", { configurable: true, value: true });
      document.body.append(wrapper);
      expect(new ContentEditableReviewTarget(editor).capabilities.apply).toBe(false);
      wrapper.remove();
    }
  });

  test("pressing the shortcut again from the panel keeps the review", async () => {
    textarea("We saw teh cat.");
    const suspend = jest.fn();
    const review = new ReviewController({
      getOptions: options,
      suspend,
      resume: jest.fn(),
      addToDictionary: async () => true,
      getDocsSurface: () => null,
      uiLanguage: "en",
    });
    review.invoke();
    await until(
      () => hosts()[0]?.shadowRoot?.querySelector(".status")?.textContent === "Issues: 1",
    );
    // Focus is now in the panel, so no editor is focused.
    (hosts()[0].shadowRoot!.querySelector("[data-action=close]") as HTMLElement).focus();
    review.invoke();
    expect(review.isActive).toBe(true);
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(hosts()).toHaveLength(1);
    review.close();
  });

  test("a Docs review still starting is started once and can be cancelled", async () => {
    let answer: (reply: { status: "cancelled" }) => void = () => {};
    const surface = {
      reviewRead: jest.fn(
        () =>
          new Promise<{ status: "cancelled" }>((resolve) => {
            answer = resolve;
          }),
      ),
      reviewApply: jest.fn(),
      setReviewActive: jest.fn(),
      reviewFocusEditor: jest.fn(),
      onReviewSourceChange: jest.fn(() => () => {}),
    };
    const review = new ReviewController({
      getOptions: options,
      suspend: jest.fn(),
      resume: jest.fn(),
      addToDictionary: async () => true,
      getDocsSurface: () => surface as never,
      uiLanguage: "en",
    });
    review.invoke();
    review.invoke();
    expect(surface.setReviewActive.mock.calls).toEqual([[true]]);
    // Closed while Docs is answering: nothing opens afterwards, typing resumes.
    review.close();
    answer({ status: "cancelled" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hosts()).toHaveLength(0);
    expect(review.isActive).toBe(false);
    expect(surface.setReviewActive.mock.calls).toEqual([[true], [false]]);
  });

  test("a Docs window is reported as partial, and Docs input rechecks without the panel", async () => {
    // A window cut from the middle of a long document, mid-sentence at both ends.
    let text = "ut sentence. We saw teh cat. Last wor";
    const windowStart = 20_000;
    const after = 500;
    const listeners = new Set<() => void>();
    const surface = {
      reviewRead: jest.fn(() =>
        Promise.resolve({
          status: "ready" as const,
          snapshot: {
            token: "t",
            scope: "doc",
            text,
            windowStart,
            documentLength: windowStart + text.length + after,
            anchor: windowStart + 20,
            focus: windowStart + 20,
          },
        }),
      ),
      reviewApply: jest.fn(),
      setReviewActive: jest.fn(),
      reviewFocusEditor: jest.fn(),
      onReviewSourceChange: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const review = new ReviewController({
      getOptions: options,
      suspend: jest.fn(),
      resume: jest.fn(),
      addToDictionary: async () => true,
      getDocsSurface: () => surface as never,
      uiLanguage: "en",
    });
    review.invoke();
    const panel = () => hosts()[0]?.shadowRoot;
    const status = () => panel()?.querySelector(".status")?.textContent;
    await until(() => status() === "Issues: 1");
    // "ut" and "wor" are cut words, not findings; they count as not reviewed.
    expect(panel()?.querySelector(".scope")?.textContent).toBe("Part of the document");
    const unread = windowStart + after + "ut sentence. ".length + "wor".length;
    expect(panel()?.querySelector(".notes")?.textContent).toContain(
      `Only the text around the cursor was reviewed; ${unread} characters`,
    );
    // Typing in Docs' own input frame is the only signal; nothing in the panel is touched.
    text = "ut sentence. We saw teh cat and teh dog. Last wor";
    expect(listeners.size).toBe(1);
    listeners.forEach((listener) => listener());
    await until(() => status() === "Issues: 2", 4000);
    review.close();
    expect(listeners.size).toBe(0);
  });

  test("an unknown word offers its suggestions; nothing changes until one is picked", async () => {
    setExecCommand(textControlInsert);
    const field = textarea("Where wa it?");
    field.setSelectionRange(0, 0);
    const lookups: string[] = [];
    const review = new ReviewController({
      getOptions: options,
      suspend: jest.fn(),
      resume: jest.fn(),
      addToDictionary: async () => true,
      lookupSpelling: (_lang, words) => {
        lookups.push(...words.map((item) => item.word));
        return Promise.resolve(
          words.map(({ word }) => (word === "wa" ? ["was", "way", "want", "war", "wax"] : null)),
        );
      },
      getDocsSurface: () => null,
      uiLanguage: "en",
    });
    review.invoke();
    const root = () => hosts()[0]!.shadowRoot!;
    await until(
      () =>
        root().querySelector(".item .change")?.textContent === "wa \u2192 was / way / war / \u2026",
    );
    expect(field.value).toBe("Where wa it?");
    expect(lookups).toContain("wa");

    root().querySelector<HTMLElement>(".item")!.click();
    const card = root().querySelector<HTMLElement>(".card")!;
    // No preselected fix: no Apply button, one button per suggestion, focus on the first.
    expect(card.querySelector("[data-action=apply]")).toBeNull();
    const choices = () => Array.from(card.querySelectorAll<HTMLButtonElement>("button.suggestion"));
    expect(choices().map((button) => button.textContent)).toEqual(["was", "way", "war", "wax"]);
    expect(choices()[1].getAttribute("aria-label")).toBe("Replace with \u201Cway\u201D");
    expect(root().activeElement).toBe(choices()[0]);
    expect(card.textContent).toContain("Nothing changes until you pick a word.");
    expect(card.querySelector("[data-action=dictionary]")?.textContent).toBe(
      "Add \u201Cwa\u201D to dictionary",
    );
    // Arrow keys move between suggestions without applying anything.
    const KeyboardEventCtor = (window as unknown as { KeyboardEvent: typeof KeyboardEvent })
      .KeyboardEvent;
    choices()[0].dispatchEvent(
      new KeyboardEventCtor("keydown", { key: "ArrowRight", bubbles: true, composed: true }),
    );
    expect(root().activeElement).toBe(choices()[1]);
    expect(field.value).toBe("Where wa it?");

    choices()[1].click();
    await until(() => field.value === "Where way it?");
    await until(
      () =>
        root().querySelector(".status")?.textContent === "All found issues are resolved. Fixed: 1.",
    );
    review.close();
  });

  test("an editor removed without any event is noticed", async () => {
    const field = textarea("We saw teh cat.");
    const review = new ReviewController({
      getOptions: options,
      suspend: jest.fn(),
      resume: jest.fn(),
      addToDictionary: async () => true,
      getDocsSurface: () => null,
      uiLanguage: "en",
    });
    review.invoke();
    const status = () => hosts()[0]?.shadowRoot?.querySelector(".status")?.textContent;
    await until(() => status() === "Issues: 1");
    field.value = "We saw teh cat and teh dog.";
    // Checked about once a second, then the usual pause before rechecking.
    await until(() => status() === "Issues: 2", 4000);
    field.remove();
    await until(() => status() === "The reviewed field is no longer available.", 4000);
    review.close();
  }, 15000);
});

test("setCaret helper keeps its contract", () => {
  const root = createEditor("<p>x</p>");
  setCaret(root.querySelector("p")!.firstChild!);
  expect(document.getSelection()?.isCollapsed).toBe(true);
});
