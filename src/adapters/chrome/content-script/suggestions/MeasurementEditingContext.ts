import type { GrammarHints } from "@core/domain/grammar/types";

const PROTECTED_CONTEXT =
  'code, pre, kbd, samp, [contenteditable="false"], [role="spinbutton"], ' +
  ".monaco-editor, .CodeMirror, .cm-editor, .ace_editor";

/** DOM knowledge stays in the adapter, outside the measurement parser. */
export function measurementEditingContext(
  element: HTMLElement,
): GrammarHints["measurementContext"] {
  if (element.closest(PROTECTED_CONTEXT)) return "protected";
  if (element.getAttribute("aria-readonly") === "true") return "protected";
  if (
    /(?:^|\s)(?:current-password|new-password|one-time-code)(?:\s|$)/.test(
      element.getAttribute("autocomplete") ?? "",
    )
  )
    return "protected";
  const inputMode = element.getAttribute("inputmode");
  if (inputMode && !["text", "search"].includes(inputMode)) return "protected";
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    const field = element as HTMLInputElement | HTMLTextAreaElement;
    if (field.disabled || field.readOnly || field.selectionStart !== field.selectionEnd)
      return "protected";
    if (element.tagName === "INPUT" && !["text", "search"].includes(field.type)) return "protected";
    return "prose";
  }
  if (!element.isContentEditable) return "protected";
  const selection = element.ownerDocument.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode || !element.contains(selection.anchorNode))
    return "protected";
  const anchor = selection.anchorNode;
  const parent = anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
  return parent?.closest(PROTECTED_CONTEXT) ? "protected" : "prose";
}
