import { afterEach, expect, jest, test } from "bun:test";
import { createEditor as editor, setCaret as caret, withProperty } from "./codeContextTestUtils";
import { resolveCodeContext } from "../src/adapters/chrome/content-script/suggestions/CodeContextResolver";
import { measurementEditingContext } from "../src/adapters/chrome/content-script/suggestions/MeasurementEditingContext";

function text(element: Element): Text {
  const node = element.firstChild;
  if (!node || node.nodeType !== 3) throw new Error("Missing fixture text");
  return node as Text;
}

afterEach(() => {
  jest.restoreAllMocks();
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

test("switches code protection with the caret in the supplied mixed Quill composer", () => {
  const root = editor('<p>hello </p><div class="ql-code-block">hello </div><p>again </p>');
  root.className = "ql-editor";
  root.setAttribute("data-gramm", "false");
  root.setAttribute("spellcheck", "true");
  const [first, code, last] = Array.from(root.children);
  for (const paragraph of [first, last, first]) {
    caret(text(paragraph));
    expect(measurementEditingContext(root)).toBe("prose");
    caret(text(code));
    expect(resolveCodeContext(root)).toBe("code");
    expect(measurementEditingContext(root)).toBe("protected");
  }
  caret(text(first));
  expect(measurementEditingContext(root)).toBe("prose");
});

for (const markup of [
  '<div class="ql-code-block"><span class="hljs-keyword">hello</span></div>',
  '<div class="ql-code-block-container"><div><span>hello</span></div></div>',
  "<pre><code><span>hello</span></code></pre>",
  "<p>before <code><span>hello</span></code> after</p>",
  "<pre><span>hello</span></pre>",
  "<kbd><span>hello</span></kbd>",
  "<samp><span>hello</span></samp>",
]) {
  test(`protects nested editable code representation: ${markup}`, () => {
    const root = editor(markup);
    caret(text(root.querySelector("span")!));
    expect(resolveCodeContext(root)).toBe("code");
    expect(measurementEditingContext(root)).toBe("protected");
  });
}

test("detects an empty Quill code block before the first character and throughout typing", () => {
  const root = editor('<p>prose</p><div class="ql-code-block"><br></div>');
  const block = root.lastElementChild!;
  caret(block, 0);
  expect(measurementEditingContext(root)).toBe("protected");
  for (const value of ["c", "co", "const", "const x=1;"]) {
    block.textContent = value;
    caret(text(block));
    expect(measurementEditingContext(root)).toBe("protected");
  }
});

test("does not inherit code from a sibling of an empty prose paragraph", () => {
  const root = editor('<div class="ql-code-block">code</div><p><br></p>');
  caret(root.lastElementChild!, 0);
  expect(resolveCodeContext(root)).toBe("prose");
});

test("does not disable prose text next to inline code", () => {
  const root = editor("<p>before <code>hello</code> after</p>");
  const paragraph = root.firstElementChild!;
  caret(paragraph.firstChild!, 3);
  expect(measurementEditingContext(root)).toBe("prose");
  caret(paragraph.lastChild!, 0);
  expect(measurementEditingContext(root)).toBe("prose");
});

test("defers at ambiguous parent-offset boundaries instead of choosing a code sibling", () => {
  const root = editor('<p>prose</p><div class="ql-code-block">code</div><p>prose</p>');
  for (const offset of [1, 2]) {
    caret(root, offset);
    expect(resolveCodeContext(root)).toBe("unknown");
    expect(measurementEditingContext(root)).toBe("protected");
  }
  root.innerHTML = "<p>before <code>code</code> after</p>";
  for (const offset of [1, 2]) {
    caret(root.firstElementChild!, offset);
    expect(resolveCodeContext(root)).toBe("unknown");
  }
});

test("only inspects the adjacent edge of a paragraph when resolving a boundary", () => {
  const root = editor("<p><code>code</code> prose</p><p>more prose</p>");
  caret(root, 1);
  expect(resolveCodeContext(root)).toBe("prose");
});

test("rechecks formatting-only DOM changes without cached text or input events", () => {
  const root = editor("<div>same text</div>");
  const block = root.firstElementChild!;
  caret(text(block));
  expect(measurementEditingContext(root)).toBe("prose");
  block.classList.add("ql-code-block");
  expect(measurementEditingContext(root)).toBe("protected");
  block.classList.remove("ql-code-block");
  expect(measurementEditingContext(root)).toBe("prose");
});

test("does not guess code from typography, spellcheck, generic classes, or text", () => {
  const root = editor(
    '<p class="code language-javascript" style="font-family: monospace">x=1;</p>',
  );
  root.setAttribute("spellcheck", "false");
  root.setAttribute("data-gramm", "false");
  caret(text(root.firstElementChild!));
  expect(measurementEditingContext(root)).toBe("prose");
});

for (const className of ["monaco-editor", "CodeMirror", "cm-editor", "ace_editor"]) {
  test(`retains whole-field code protection for ${className}`, () => {
    const host = document.createElement("div");
    host.className = className;
    const input = document.createElement("textarea");
    host.append(input);
    document.body.append(host);
    expect(resolveCodeContext(input)).toBe("code");
    expect(measurementEditingContext(input)).toBe("protected");
  });
}

test("keeps non-code protected contexts distinct from code detection", () => {
  for (const attr of ['contenteditable="false"', 'aria-readonly="true"', 'role="spinbutton"']) {
    const root = editor(`<span ${attr}>value</span>`);
    caret(text(root.firstElementChild!));
    expect(resolveCodeContext(root)).toBe("protected");
    expect(measurementEditingContext(root)).toBe("protected");
    root.remove();
  }
});

test("preserves sensitive, readonly, numeric, and selected text-field exclusions", () => {
  const input = document.createElement("input");
  document.body.append(input);
  input.value = "hello";
  input.setSelectionRange(5, 5);
  expect(measurementEditingContext(input)).toBe("prose");
  for (const [name, value] of [
    ["autocomplete", "section-login current-password"],
    ["autocomplete", "new-password"],
    ["autocomplete", "one-time-code"],
    ["inputmode", "numeric"],
    ["aria-readonly", "true"],
    ["readonly", ""],
    ["disabled", ""],
    ["type", "password"],
    ["type", "number"],
  ]) {
    input.setAttribute(name, value);
    expect(measurementEditingContext(input)).toBe("protected");
    input.removeAttribute(name);
  }
  input.value = "hello";
  input.setSelectionRange(1, 3);
  expect(measurementEditingContext(input)).toBe("protected");
});

test("fails closed for missing, foreign, and non-collapsed contenteditable selections", () => {
  const root = editor("<p>hello</p>");
  document.getSelection()?.removeAllRanges();
  expect(resolveCodeContext(root)).toBe("unknown");
  const other = editor("<p>hello</p>");
  caret(text(other.firstElementChild!));
  expect(resolveCodeContext(root)).toBe("unknown");
  caret(text(root.firstElementChild!), 1);
  document.getSelection()!.extend(text(root.firstElementChild!), 3);
  expect(resolveCodeContext(root)).toBe("unknown");
});

test("uses the editor's owning document for iframe selections", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument!;
  const root = editor('<p>prose</p><div class="ql-code-block">code</div>', doc);
  caret(text(root.firstElementChild!));
  expect(measurementEditingContext(root)).toBe("prose");
  caret(text(root.lastElementChild!));
  expect(measurementEditingContext(root)).toBe("protected");
});

test("supplies nested shadow roots to composed selection resolution", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const outer = host.attachShadow({ mode: "open" });
  const innerHost = document.createElement("div");
  outer.append(innerHost);
  const inner = innerHost.attachShadow({ mode: "open" });
  const root = editor('<p>prose</p><div class="ql-code-block">code</div>');
  inner.append(root);
  let node = text(root.lastElementChild!);
  const getComposedRanges = jest.fn(() => [
    { startContainer: node, startOffset: 2, endContainer: node, endOffset: 2 },
  ]);
  withProperty(document.getSelection()!, "getComposedRanges", getComposedRanges, () => {
    expect(resolveCodeContext(root)).toBe("code");
    expect(measurementEditingContext(root)).toBe("protected");
    node = text(root.firstElementChild!);
    expect(resolveCodeContext(root)).toBe("prose");
    expect(measurementEditingContext(root)).toBe("prose");
    expect(getComposedRanges).toHaveBeenCalledTimes(4);
    expect(getComposedRanges).toHaveBeenCalledWith({ shadowRoots: [inner, outer] });
  });
});

test("does not mistake a shadow-host re-scoped selection for inner prose", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const root = editor("<p>prose</p>");
  shadow.append(root);
  const range = document.createRange();
  range.selectNode(host);
  range.collapse(true);
  const getComposedRanges = jest.fn(() => [range]);
  withProperty(document.getSelection()!, "getComposedRanges", getComposedRanges, () => {
    expect(resolveCodeContext(root)).toBe("unknown");
    expect(getComposedRanges).toHaveBeenCalledWith({ shadowRoots: [shadow] });
  });
});

test("selection API failure cannot classify unknown context as prose", () => {
  const root = editor("<p>prose</p>");
  caret(text(root.firstElementChild!));
  expect(resolveCodeContext(root)).toBe("prose");
  const getSelection = jest.fn(() => {
    throw new Error("Selection unavailable during reconciliation");
  });
  withProperty(document, "getSelection", getSelection, () => {
    expect(resolveCodeContext(root)).toBe("unknown");
    expect(measurementEditingContext(root)).toBe("protected");
    expect(getSelection).toHaveBeenCalledTimes(2);
  });
  expect(resolveCodeContext(root)).toBe("prose");
});
