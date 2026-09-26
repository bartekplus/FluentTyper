import type { GrammarHints } from "@core/domain/grammar/types";
import { resolveCodeContext } from "./CodeContextResolver";
import { isLockedField, isSensitiveField } from "./FieldEligibility";

/** DOM knowledge stays in the adapter, outside the measurement parser. */
export function measurementEditingContext(
  element: HTMLElement,
): GrammarHints["measurementContext"] {
  if (resolveCodeContext(element) !== "prose") return "protected";
  if (isSensitiveField(element)) return "protected";
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    const field = element as HTMLInputElement | HTMLTextAreaElement;
    if (isLockedField(field) || field.selectionStart !== field.selectionEnd) return "protected";
  }
  return "prose";
}
