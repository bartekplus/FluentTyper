import type { GrammarHints } from "@core/domain/grammar/types";
import { resolveCodeContext } from "./CodeContextResolver";

/** DOM knowledge stays in the adapter, outside the measurement parser. */
export function measurementEditingContext(
  element: HTMLElement,
): GrammarHints["measurementContext"] {
  if (resolveCodeContext(element) !== "prose") return "protected";
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
  }
  return "prose";
}
