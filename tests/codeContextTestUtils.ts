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
  const doc = node.ownerDocument ?? document;
  const selection = doc.getSelection();
  if (!selection) throw new Error("Missing fixture selection");
  const range = doc.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
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
