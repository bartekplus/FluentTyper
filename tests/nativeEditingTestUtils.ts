/** DOM-only native editing simulation. This helper does not prove browser history support. */
export function simulateNativeEdit(command: string, _ui?: boolean, value = ""): boolean {
  if (command !== "insertText" && command !== "delete") return false;
  const text = command === "delete" ? "" : value;
  const target = document.activeElement;
  if (!target) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
    const field = target as HTMLTextAreaElement;
    field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
  } else {
    const selection = document.getSelection();
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    // Native editing inserts into the adjacent text node at an inline boundary.
    if (range.startContainer.nodeType === 1) {
      const previous = range.startContainer.childNodes[range.startOffset - 1];
      const next = range.startContainer.childNodes[range.startOffset];
      const node = next?.nodeType === 3 ? next : previous?.nodeType === 3 ? previous : null;
      if (node) range.setStart(node, node === next ? 0 : node.textContent!.length);
      else if (next?.nodeType === 1 && !next.textContent) range.setStart(next, 0);
      range.collapse(true);
    }
    if (text) {
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      node.parentNode?.normalize();
    }
  }
  target.dispatchEvent(
    new window.InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: command === "delete" ? "deleteContentBackward" : "insertText",
      data: text,
    }),
  );
  return true;
}
