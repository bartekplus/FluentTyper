import { createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
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

type TestEditor = Editor & ReactEditor & HistoryEditor;

declare global {
  interface Window {
    __testSlate?: TestEditor;
    __testSlateSetValue?: (value: Descendant[]) => void;
  }
}

const editor = withHistory(withReact(createEditor())) as TestEditor;
const { isInline } = editor;
editor.isInline = (element) => (element as { type?: string }).type === "link" || isInline(element);

function renderElement({ attributes, children, element }: RenderElementProps): ReactNode {
  const node = element as { type?: string; url?: string };
  if (node.type === "link") return createElement("a", { ...attributes, href: node.url }, children);
  if (node.type === "code")
    return createElement("pre", attributes, createElement("code", null, children));
  return createElement("p", attributes, children);
}

function renderLeaf({ attributes, children, leaf }: RenderLeafProps): ReactNode {
  const marks = leaf as { bold?: boolean; italic?: boolean };
  let content = children;
  if (marks.bold) content = createElement("strong", null, content);
  if (marks.italic) content = createElement("em", null, content);
  return createElement("span", attributes, content);
}

const initialValue = [{ type: "paragraph", children: [{ text: "" }] }] as Descendant[];
const mount = document.getElementById("test-slate")!;
createRoot(mount).render(
  createElement(
    Slate,
    { editor, initialValue },
    createElement(Editable, {
      id: "test-slate-editor",
      placeholder: "Write something",
      renderElement,
      renderLeaf,
    }),
  ),
);

window.__testSlate = editor;
// Replaces the document like a host reset: no history, no selection.
window.__testSlateSetValue = (value) => {
  editor.children = value;
  editor.selection = null;
  editor.history = { undos: [], redos: [] };
  editor.onChange();
};
