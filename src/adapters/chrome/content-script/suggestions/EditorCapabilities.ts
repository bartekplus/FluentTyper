import type { ReviewCapabilities } from "@core/application/review/ReviewSession";
import { ancestorContext, resolveCodeContext, type CodeContext } from "./CodeContextResolver";
import { isCredentialField, isHiddenField, isSensitiveField } from "./FieldEligibility";
import { classifyField, hasActiveAutocompletePopup } from "./NativeAutocompleteConflictDetector";

/** Fingerprints restrict generic writes. They never prove that a host adapter works. */
export const MODEL_EDITOR_SELECTOR =
  "[data-lexical-editor], .ProseMirror, [data-slate-editor], .DraftEditor-root, " +
  "[data-contents], .ck-editor__editable, trix-editor, .cke_editable, " +
  ".mce-content-body, .fr-element, .note-editable";

export type CapabilityReason =
  | "available"
  | "detached"
  | "sensitive"
  | "restricted"
  | "hidden"
  | "code"
  | "manual-activation"
  | "native-popup"
  | "unverified-writer";

export interface EditorCapabilities {
  inspectProse: boolean;
  displaySuggestions: boolean;
  renderReview: boolean;
  reviewApply: boolean;
  consumeAcceptanceKey: boolean;
  conflict: "none" | "native-popup" | "browser-unknown";
  context: CodeContext;
  reason: CapabilityReason;
}

/** Text-free, uncached metadata. Call before reading text and again before a write. */
export function editorCapabilities(
  element: HTMLElement,
  options: {
    preferNativeAutocomplete?: boolean;
    fieldActivated?: boolean;
    review?: ReviewCapabilities;
  } = {},
): EditorCapabilities {
  const denied = (reason: CapabilityReason): EditorCapabilities => ({
    inspectProse: false,
    displaySuggestions: false,
    renderReview: false,
    reviewApply: false,
    consumeAcceptanceKey: false,
    conflict: "none",
    context: "unknown",
    reason,
  });
  if (!element.isConnected) return denied("detached");
  // This check precedes selection, popup inspection, and all adapter reads.
  if (isCredentialField(element)) return denied("sensitive");
  const eligibility = classifyField(element);
  if (eligibility.kind === "blocked") return denied("restricted");
  if (isHiddenField(element)) return denied("hidden");
  const hostContext = ancestorContext(element);
  const context = resolveCodeContext(element);
  const inspectProse = hostContext === null;
  const renderReview = inspectProse && !isSensitiveField(element);
  const model = !!element.closest(MODEL_EDITOR_SELECTOR);
  // These typing paths already validate host transactions. Other fingerprints
  // retain Review/copy only, even if the user enables a structured field.
  const typingWriter =
    !model ||
    element.matches(".ProseMirror, .mce-content-body, .ck-editor__editable, [data-lexical-editor]");
  const preferNative = options.preferNativeAutocomplete !== false;
  const manual = preferNative && eligibility.kind === "manual" && !options.fieldActivated;
  const popup = hasActiveAutocompletePopup(element);
  const conflict = popup
    ? "native-popup"
    : eligibility.kind === "manual" && eligibility.reason === "browser"
      ? "browser-unknown"
      : "none";
  const displaySuggestions =
    typingWriter && context !== "protected" && !manual && !(preferNative && popup);
  return {
    inspectProse,
    displaySuggestions,
    renderReview,
    reviewApply: renderReview && options.review?.apply === true,
    consumeAcceptanceKey: displaySuggestions && !(preferNative && conflict === "browser-unknown"),
    conflict,
    context,
    reason: !inspectProse
      ? "code"
      : !typingWriter
        ? "unverified-writer"
        : manual
          ? "manual-activation"
          : preferNative && popup
            ? "native-popup"
            : "available",
  };
}
