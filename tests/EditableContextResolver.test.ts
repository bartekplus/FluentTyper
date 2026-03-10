import { beforeEach, expect, test } from "bun:test";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
import { EditableContextResolver } from "../src/adapters/chrome/content-script/suggestions/EditableContextResolver";

beforeEach(() => {
  document.body.innerHTML = "";
  const selection = window.getSelection();
  selection?.removeAllRanges();
});

test("resolves full text-input context from one snapshot", () => {
  const input = document.createElement("input");
  input.value = "hello";
  input.selectionStart = 5;
  input.selectionEnd = 5;

  const resolver = new EditableContextResolver();
  const context = resolver.resolve(input);

  expect(context).toMatchObject({
    kind: "text-value",
    beforeCursor: "hello",
    afterCursor: "",
    fullText: "hello",
    cursorOffset: 5,
    selectionStable: true,
  });
});

test("returns null for non-text-value elements", () => {
  const element = document.createElement("div");

  const resolver = new EditableContextResolver();

  expect(resolver.resolve(element)).toBeNull();
});

test("resolves contenteditable with exact block-local values when block context is available", () => {
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
  editable.innerHTML = "<p>Alpha beta</p><p>Gamma</p>";
  document.body.appendChild(editable);

  const paragraphText = editable.querySelector("p")?.firstChild;
  if (!paragraphText || paragraphText.nodeType !== Node.TEXT_NODE) {
    throw new Error("Expected paragraph text node");
  }

  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Selection API unavailable");
  }

  const range = document.createRange();
  range.setStart(paragraphText, 5);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  const resolver = new EditableContextResolver();
  const context = resolver.resolve(editable);

  expect(context).toMatchObject({
    kind: "contenteditable",
    beforeCursor: "Alpha",
    afterCursor: " beta",
    fullText: "Alpha betaGamma",
    cursorOffset: 5,
    selectionStable: true,
    blockContext: {
      beforeCursor: "Alpha",
      afterCursor: " beta",
    },
  });
});

test("marks contenteditable selectionStable true for a collapsed caret inside one block", () => {
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
  editable.innerHTML = "<p>Alpha beta</p><p>Gamma</p>";
  document.body.appendChild(editable);

  const paragraphText = editable.querySelector("p")?.firstChild;
  if (!paragraphText || paragraphText.nodeType !== Node.TEXT_NODE) {
    throw new Error("Expected paragraph text node");
  }

  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Selection API unavailable");
  }

  const range = document.createRange();
  range.setStart(paragraphText, 2);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  const resolver = new EditableContextResolver();
  const context = resolver.resolve(editable);

  expect(context?.selectionStable).toBe(true);
});

test("marks contenteditable selectionStable false for a cross-block selection", () => {
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
  editable.innerHTML = "<p>Alpha</p><p>Beta</p>";
  document.body.appendChild(editable);

  const paragraphs = editable.querySelectorAll("p");
  const startText = paragraphs[0]?.firstChild;
  const endText = paragraphs[1]?.firstChild;
  if (
    !startText ||
    startText.nodeType !== Node.TEXT_NODE ||
    !endText ||
    endText.nodeType !== Node.TEXT_NODE
  ) {
    throw new Error("Expected paragraph text nodes");
  }

  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Selection API unavailable");
  }

  const range = document.createRange();
  range.setStart(startText, 1);
  range.setEnd(endText, 2);
  selection.removeAllRanges();
  selection.addRange(range);

  const resolver = new EditableContextResolver();
  const context = resolver.resolve(editable);

  expect(context?.selectionStable).toBe(false);
});

test("marks contenteditable selectionStable false when selection is outside the editable", () => {
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
  editable.innerHTML = "<p>Alpha beta</p>";
  const outside = document.createElement("div");
  outside.textContent = "Outside selection";
  document.body.appendChild(editable);
  document.body.appendChild(outside);

  const outsideText = outside.firstChild;
  if (!outsideText || outsideText.nodeType !== Node.TEXT_NODE) {
    throw new Error("Expected outside text node");
  }

  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Selection API unavailable");
  }

  const range = document.createRange();
  range.setStart(outsideText, 0);
  range.setEnd(outsideText, 7);
  selection.removeAllRanges();
  selection.addRange(range);

  const resolver = new EditableContextResolver();
  const context = resolver.resolve(editable);

  expect(context).toMatchObject({
    kind: "contenteditable",
    fullText: "Alpha beta",
    cursorOffset: "Alpha beta".length,
    selectionStable: false,
    blockContext: null,
  });
});

test("uses contenteditable adapter block context and selection-safety results directly", () => {
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
  editable.textContent = "Snapshot text";
  document.body.appendChild(editable);

  const originalGetBlockContext = ContentEditableAdapter.prototype.getBlockContext;
  const originalHasUnstableSelection = ContentEditableAdapter.prototype.hasUnstableSelection;

  ContentEditableAdapter.prototype.getBlockContext = () => ({
    beforeCursor: "Block before",
    afterCursor: " block after",
  });
  ContentEditableAdapter.prototype.hasUnstableSelection = () => true;

  try {
    const resolver = new EditableContextResolver();
    const context = resolver.resolve(editable);

    expect(context).toMatchObject({
      kind: "contenteditable",
      beforeCursor: "Block before",
      afterCursor: " block after",
      selectionStable: false,
      fullText: "Snapshot text",
      cursorOffset: "Snapshot text".length,
      blockContext: {
        beforeCursor: "Block before",
        afterCursor: " block after",
      },
    });
  } finally {
    ContentEditableAdapter.prototype.getBlockContext = originalGetBlockContext;
    ContentEditableAdapter.prototype.hasUnstableSelection = originalHasUnstableSelection;
  }
});
