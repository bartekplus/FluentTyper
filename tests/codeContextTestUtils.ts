import { expect } from "bun:test";

export function createEditor(html: string, doc: Document = document): HTMLDivElement {
  const element = doc.createElement("div");
  element.setAttribute("contenteditable", "true");
  // jsdom does not implement inherited isContentEditable.
  Object.defineProperty(element, "isContentEditable", { configurable: true, value: true });
  element.innerHTML = html;
  doc.body.append(element);
  return element;
}

export function setCaret(
  node: Node,
  offset = node.nodeType === 3 ? (node.textContent?.length ?? 0) : node.childNodes.length,
): void {
  (node.ownerDocument ?? document).getSelection()!.collapse(node, offset);
}

/** Puts the caret at a text offset of root; adds an empty text node when root has no text. */
export function setCaretAtTextOffset(root: Node, offset: number): void {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, doc.defaultView!.NodeFilter.SHOW_TEXT);
  let node = (walker.nextNode() as Text | null) ?? root.appendChild(doc.createTextNode(""));
  let remaining = Math.max(0, offset);
  while (remaining > node.length) {
    const next = walker.nextNode() as Text | null;
    if (!next) break;
    remaining -= node.length;
    node = next;
  }
  setCaret(node, Math.min(remaining, node.length));
}

/** Scoped, synchronous override; inherited jsdom methods need own properties in Bun. */
export function withProperty(target: object, name: string, value: unknown, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
  try {
    expect(Reflect.get(target, name)).toBe(value);
    run();
  } finally {
    if (previous) Object.defineProperty(target, name, previous);
    else Reflect.deleteProperty(target, name);
  }
}
