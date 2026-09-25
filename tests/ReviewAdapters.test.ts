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
