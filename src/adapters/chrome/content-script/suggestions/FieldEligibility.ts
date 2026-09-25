const SECRET_AUTOCOMPLETE =
  /(?:^|\s)(?:current-password|new-password|one-time-code|cc-[a-z-]+)(?:\s|$)/;
const SECRET_NAME =
  /pass(?:word|wd)?|pwd|otp|one.?time|cvc|cvv|csc|card.?num|ccnum|security.?code|\bpin\b/i;

/**
 * Fields whose content is a secret or not prose: passwords, one-time codes,
 * payment and security codes, non-text input modes. Shared by typing-time
 * measurement formatting and review, so every entry point excludes the same.
 */
export function isSensitiveField(element: HTMLElement): boolean {
  if (SECRET_AUTOCOMPLETE.test(element.getAttribute("autocomplete") ?? "")) return true;
  const inputMode = element.getAttribute("inputmode");
  if (inputMode && !["text", "search"].includes(inputMode)) return true;
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement;
    if (!["text", "search", ""].includes((input.type || "text").toLowerCase())) return true;
    if (SECRET_NAME.test(`${input.name} ${input.id}`)) return true;
  }
  return false;
}

/** A disabled or read-only control; the user cannot edit it, so nothing may write to it. */
export function isLockedField(element: HTMLElement): boolean {
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    const field = element as HTMLInputElement | HTMLTextAreaElement;
    return field.disabled || field.readOnly;
  }
  return !element.isContentEditable || element.getAttribute("aria-readonly") === "true";
}
