export function isNativeUndoChord(
  event: Pick<
    KeyboardEvent,
    "defaultPrevented" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey" | "key"
  >,
  platform = getNavigatorPlatform(),
): boolean {
  if (event.defaultPrevented || event.altKey || event.shiftKey) {
    return false;
  }
  if (event.key.toLowerCase() !== "z") {
    return false;
  }

  if (/mac/i.test(platform)) {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.metaKey;
}

/**
 * Alt+Enter (Option+Return on a Mac): applies the typing-time proposal the
 * popup shows, or opens the card of the last underlined issue before the caret.
 */
export function isQuickFixChord(
  event: Pick<
    KeyboardEvent,
    "defaultPrevented" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey" | "key" | "isComposing"
  >,
): boolean {
  return (
    event.key === "Enter" &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !event.defaultPrevented
  );
}

/** The quick-fix key as its row hint shows it. */
export function quickFixKeyLabel(platform = getNavigatorPlatform()): string {
  return /mac/i.test(platform) ? "⌥⏎" : "Alt+⏎";
}

function getNavigatorPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.platform || "";
}
