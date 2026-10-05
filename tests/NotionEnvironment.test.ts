import { afterEach, expect, jest, test } from "bun:test";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
import { editorCapabilities } from "../src/adapters/chrome/content-script/suggestions/EditorCapabilities";
import {
  gutenbergSelectedField,
  isGutenbergContainer,
} from "../src/adapters/chrome/content-script/suggestions/GutenbergEnvironment";
import { classifyField } from "../src/adapters/chrome/content-script/suggestions/NativeAutocompleteConflictDetector";
import {
  notionRootOf,
  notionWriteKept,
} from "../src/adapters/chrome/content-script/suggestions/NotionEnvironment";
import { recordComposition } from "../src/adapters/chrome/content-script/suggestions/HostEditorControllerUtils";
import {
  ContentEditableReviewTarget,
  resolveReviewTarget,
} from "../src/adapters/chrome/content-script/review/ReviewTargets";
import { SuggestionManagerRuntime } from "../src/adapters/chrome/content-script/suggestions/SuggestionManagerRuntime";
import { SuggestionMenuPresenter } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuPresenter";
import { SuggestionMenuView } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuView";
import type { SuggestionPositioningService } from "../src/adapters/chrome/content-script/suggestions/SuggestionPositioningService";
import { setCaret } from "./codeContextTestUtils";
import { createRuntimeOptions } from "./suggestionTestUtils";

afterEach(() => {
  recordComposition(new Event("compositionend"));
  document.body.replaceChildren();
});

/** A Notion page: one root contenteditable, one nested leaf for each block. */
function notionPage(...blocks: string[]) {
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.tabIndex = 0;
  root.setAttribute("data-content-editable-root", "true");
  // jsdom does not implement inherited isContentEditable.
  Object.defineProperty(root, "isContentEditable", { value: true });
  const content = document.createElement("div");
  content.className = "notion-page-content";
  root.append(content);
  const leaves = blocks.map((text, index) => {
    const block = document.createElement("div");
    block.dataset.blockId = `b${index}`;
    const leaf = document.createElement("div");
    leaf.contentEditable = "true";
    leaf.setAttribute("data-content-editable-leaf", "true");
    Object.defineProperty(leaf, "isContentEditable", { value: true });
    leaf.textContent = text;
    block.append(leaf);
    content.append(block);
    return leaf;
  });
  document.body.append(root);
  return { root, leaves };
}

/** A stand-in for the browser's insertText: it replaces the selected range. */
function withInsertText(run: () => void): void {
  const original = document.execCommand;
  document.execCommand = ((command: string, _ui?: boolean, value?: string) => {
    const range = document.getSelection()!.getRangeAt(0);
    if (command !== "insertText") return false;
    range.deleteContents();
    const text = document.createTextNode(value ?? "");
    range.insertNode(text);
    setCaret(text);
    return true;
  }) as typeof document.execCommand;
  try {
    run();
  } finally {
    document.execCommand = original;
  }
}

test("the leaf that holds the selection is the field, never the Notion page root", () => {
  const { root, leaves } = notionPage("First block", "Second block");
  root.focus();
  setCaret(leaves[1].firstChild!, 3);
  expect(gutenbergSelectedField(root)).toBe(leaves[1]);
  expect(isGutenbergContainer(root)).toBe(true);
  expect(classifyField(root).kind).toBe("blocked");
  expect(notionRootOf(leaves[1])).toBe(root);
  expect(editorCapabilities(leaves[1])).toMatchObject({
    displaySuggestions: true,
    renderReview: true,
    reason: "available",
  });
  // The Review target is the leaf, with one write per fix and no Fix all.
  const resolved = resolveReviewTarget(document);
  expect(resolved.ok && resolved.target.element).toBe(leaves[1]);
  expect(new ContentEditableReviewTarget(leaves[1]).capabilities).toEqual({
    apply: true,
    bulk: false,
  });
  // Without a selection in a leaf the root has no field and no Review target.
  setCaret(root, 0);
  expect(gutenbergSelectedField(root)).toBe(root);
  expect(resolveReviewTarget(document)).toEqual({ ok: false, reason: "no-editor" });
});

test("the Notion leaf markup alone, outside a Notion page, is no Notion leaf", () => {
  const leaf = document.createElement("div");
  leaf.setAttribute("data-content-editable-leaf", "true");
  leaf.contentEditable = "true";
  document.body.append(leaf);
  expect(notionRootOf(leaf)).toBeNull();
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.setAttribute("data-content-editable-root", "true");
  Object.defineProperty(root, "isContentEditable", { value: true });
  document.body.append(root);
  expect(isGutenbergContainer(root)).toBe(false);
});

// Notion's DOM lock removes each foreign attribute of a block leaf at once (live
// check). Its page root keeps them, and the MAIN-world early Tab bridge reads them there.
test("FluentTyper keeps the state of a Notion leaf on the page root, not on the leaf", () => {
  const { root, leaves } = notionPage("We saw teh", "Other block");
  // jsdom has no contentEditable property: discovery needs the attribute.
  for (const element of [root, ...leaves]) element.setAttribute("contenteditable", "true");
  const runtime = new SuggestionManagerRuntime(
    createRuntimeOptions({ selectors: "[contenteditable]" }),
  );
  const ownAttributes = (element: Element) =>
    element.getAttributeNames().filter((name) => /^data-(ft-|suggestion$)/.test(name));
  try {
    root.focus();
    setCaret(leaves[0].firstChild!, 10);
    runtime.queryAndAttachHelper();
    expect(leaves.map(ownAttributes)).toEqual([[], []]);
    expect(root.getAttribute("data-suggestion")).toBe("true");

    // The root names the entry of the leaf that shows the menu.
    const { menu, list } = SuggestionMenuView.ensureMenu();
    const positioning = {
      syncMenuTypography: jest.fn(),
      positionMenu: jest.fn(() => true),
    } as unknown as SuggestionPositioningService;
    expect(
      new SuggestionMenuPresenter(positioning).render({
        menuId: 41,
        menu,
        list,
        target: leaves[0],
        suggestions: ["teh"],
        selectedIndex: 0,
        showShortcutDigits: false,
        menuHeader: null,
        mentionText: "",
      }),
    ).toBe(true);
    expect(leaves.map(ownAttributes)).toEqual([[], []]);
    expect(root.getAttribute("data-ft-suggestion-id")).toBe("41");
    expect(root.getAttribute("data-ft-suggestion-visible")).toBe("true");
  } finally {
    runtime.detachAllHelpers();
  }
  expect(ownAttributes(root)).toEqual([]);
});

// All leaves share the page root as state host: one leaf that detaches (a
// Review write suspends it) must not take the state of the other leaves.
test("a Notion leaf that detaches leaves the shared root state to the other leaves", () => {
  const { root, leaves } = notionPage("We saw teh", "Other block");
  for (const element of [root, ...leaves]) element.setAttribute("contenteditable", "true");
  const runtime = new SuggestionManagerRuntime(
    createRuntimeOptions({ selectors: "[contenteditable]" }),
  );
  const entryId = (leaf: Element) =>
    (runtime as unknown as { entryByElement: WeakMap<Element, { id: number }> }).entryByElement.get(
      leaf,
    )?.id;
  try {
    root.focus();
    setCaret(leaves[0].firstChild!, 10);
    runtime.queryAndAttachHelper();
    setCaret(leaves[1].firstChild!, 5);
    runtime.queryAndAttachHelper();
    const other = entryId(leaves[1]);
    expect(entryId(leaves[0])).toBeNumber();
    expect(other).toBeNumber();
    // The root names the last attached leaf; make it name the leaf that detaches.
    root.setAttribute("data-ft-suggestion-id", String(entryId(leaves[0])));

    runtime.suspendForReview(leaves[0]);
    expect(entryId(leaves[0])).toBeUndefined();
    expect(root.getAttribute("data-suggestion")).toBe("true");
    expect(root.getAttribute("data-ft-autocomplete-on-tab")).toBe("true");
    expect(root.getAttribute("data-ft-early-tab-bridge")).toBe("true");
    expect(root.getAttribute("data-ft-suggestion-id")).toBe(String(other));
    expect(root.getAttribute("data-ft-suggestion-visible")).toBe("false");
  } finally {
    runtime.detachAllHelpers();
  }
  expect(root.getAttributeNames().filter((name) => /^data-(ft-|suggestion$)/.test(name))).toEqual(
    [],
  );
});

test("a typing write in a Notion leaf needs the selection already in that leaf", () => {
  const { root, leaves } = notionPage("We saw teh", "Other block");
  const adapter = new ContentEditableAdapter();
  withInsertText(() => {
    // The root has no focus: refused, and nothing moves focus or the selection.
    setCaret(leaves[0].firstChild!, 10);
    expect(adapter.replaceTextByOffsets(leaves[0], 7, 10, "the", 10).appliedBy).toBe("refused");
    expect(document.activeElement).not.toBe(root);

    // The selection is in another block: refused, the caret stays there.
    root.focus();
    setCaret(leaves[1].firstChild!, 5);
    expect(adapter.replaceTextByOffsets(leaves[0], 7, 10, "the", 10).appliedBy).toBe("refused");
    expect(document.getSelection()!.anchorNode).toBe(leaves[1].firstChild);

    // A composition in the page: refused.
    setCaret(leaves[0].firstChild!, 10);
    root.addEventListener("compositionstart", recordComposition);
    root.dispatchEvent(new Event("compositionstart"));
    expect(adapter.replaceTextByOffsets(leaves[0], 7, 10, "the", 10).appliedBy).toBe("refused");
    recordComposition(new Event("compositionend"));

    expect(leaves[0].textContent).toBe("We saw teh");
    const result = adapter.replaceTextByOffsets(leaves[0], 7, 10, "the", 10);
    expect(result).toMatchObject({ appliedBy: "fallback-dom", didMutateDom: true });
    expect(result.unverified).toBeUndefined();
    expect(leaves[0].textContent).toBe("We saw the");
    expect(leaves[1].textContent).toBe("Other block");
  });
});

test("a Review fix in Notion writes nothing when the review closes during the focus wait", async () => {
  const { root, leaves } = notionPage("We saw teh", "Other block");
  const target = new ContentEditableReviewTarget(leaves[0]);
  const read = target.read();
  if (!read.ok) throw new Error(`unreadable: ${read.reason}`);
  // Focus is elsewhere (the Review panel): the fix gives focus back to the root and waits.
  setCaret(leaves[0].firstChild!, 10);
  root.blur();
  const original = document.execCommand;
  document.execCommand = ((command: string, _ui?: boolean, value?: string) => {
    if (command !== "insertText") return false;
    const range = document.getSelection()!.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(value ?? ""));
    return true;
  }) as typeof document.execCommand;
  try {
    const pending = target.apply({
      edits: [{ start: 7, end: 10, original: "teh", replacement: "the" }],
      before: read.text,
      after: "We saw the",
      signature: read.signature,
    });
    // Notion puts its selection back in the leaf when its root gets focus.
    setCaret(leaves[0].firstChild!, 10);
    // The user closes Review while the fix waits for Notion.
    target.dispose();
    expect(await pending).toEqual({ status: "rejected", reason: "host-refused" });
    expect(leaves[0].textContent).toBe("We saw teh");
  } finally {
    document.execCommand = original;
  }
});

test("a Notion write counts as kept only when Notion does not revert it in the window", async () => {
  const { leaves } = notionPage("We saw the", "We saw the");
  const [kept, reverted] = [
    notionWriteKept(leaves[0], "We saw teh"),
    notionWriteKept(leaves[1], "We saw teh"),
  ];
  // Notion renders its model again: the old text, then later text typed on top.
  setTimeout(() => (leaves[1].textContent = "We saw teh"), 50);
  setTimeout(() => (leaves[1].textContent = "We saw teh!"), 100);
  expect(await Promise.all([kept, reverted])).toEqual([true, false]);
});
