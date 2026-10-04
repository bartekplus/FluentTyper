import { TextTargetAdapter } from "../src/adapters/chrome/content-script/suggestions/TextTargetAdapter";
import { expect, test } from "bun:test";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
import { EditableContextResolver } from "../src/adapters/chrome/content-script/suggestions/EditableContextResolver";
import { createEditor, setCaret } from "./codeContextTestUtils";

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
    fullText: "hello",
    selectionStable: true,
  });
});

test("returns null for non-text-value elements", () => {
  const element = document.createElement("div");

  const resolver = new EditableContextResolver();

  expect(resolver.resolve(element)).toBeNull();
});

test("resolves contenteditable with exact block-local values when block context is available", () => {
  const editable = createEditor("<p>Alpha beta</p><p>Gamma</p>");
  setCaret(editable.querySelector("p")!.firstChild!, 5);

  const resolver = new EditableContextResolver();
  const context = resolver.resolve(editable);

  expect(context).toMatchObject({
    kind: "contenteditable",
    beforeCursor: "Alpha",
    fullText: "Alpha betaGamma",
    selectionStable: true,
  });
});

test("marks contenteditable selectionStable false for a cross-block selection", () => {
  const editable = createEditor("<p>Alpha</p><p>Beta</p>");
  const paragraphs = editable.querySelectorAll("p");
  window
    .getSelection()!
    .setBaseAndExtent(paragraphs[0]!.firstChild!, 1, paragraphs[1]!.firstChild!, 2);

  const resolver = new EditableContextResolver();
  const context = resolver.resolve(editable);

  expect(context?.selectionStable).toBe(false);
});

test("marks contenteditable selectionStable false when selection is outside the editable", () => {
  const editable = createEditor("<p>Alpha beta</p>");
  const outside = document.createElement("div");
  outside.textContent = "Outside selection";
  document.body.appendChild(outside);
  window.getSelection()!.setBaseAndExtent(outside.firstChild!, 0, outside.firstChild!, 7);

  const resolver = new EditableContextResolver();
  const context = resolver.resolve(editable);

  expect(context).toMatchObject({
    kind: "contenteditable",
    fullText: "Alpha beta",
    selectionStable: false,
  });
});

test("uses contenteditable adapter block context and selection-safety results directly", () => {
  const editable = createEditor("Snapshot text");

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
      selectionStable: false,
      fullText: "Snapshot text",
    });
  } finally {
    ContentEditableAdapter.prototype.getBlockContext = originalGetBlockContext;
    ContentEditableAdapter.prototype.hasUnstableSelection = originalHasUnstableSelection;
  }
});

test("FT-INV-2 block context does not extract a 50k editor until full text is requested", () => {
  const editable = createEditor(`<p>Hello</p><p>${"x".repeat(50000)}</p>`);
  setCaret(editable.firstChild!.firstChild!, 5);
  const original = TextTargetAdapter.snapshot;
  let extracts = 0;
  TextTargetAdapter.snapshot = (...args) => {
    extracts++;
    return original(...args);
  };
  try {
    const context = new EditableContextResolver().resolve(editable)!;
    expect(context.beforeCursor).toBe("Hello");
    expect(context.selectionStable).toBe(true);
    expect(extracts).toBe(0);
    expect(context.fullText.length).toBe(50005);
    expect(context.fullText.length).toBe(50005);
    expect(extracts).toBe(1);
  } finally {
    TextTargetAdapter.snapshot = original;
  }
});
