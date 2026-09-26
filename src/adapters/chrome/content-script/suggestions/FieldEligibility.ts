const SECRET_AUTOCOMPLETE =
  /(?:^|\s)(?:current-password|new-password|one-time-code|cc-[a-z-]+)(?:\s|$)/;
const SECRET_NAME =
  /pass(?:word|wd)?|pwd|otp|one.?time|cvc|cvv|csc|card.?num|cc.?num|security.?code|\bpin\b|(?<![a-z0-9])(?:ssn|[2m]fa)(?![a-z0-9])|social.?security|totp|verif(?:y|ication).?code|auth.?code/i;

/**
 * Fields whose content is a secret or not prose: passwords, one-time codes,
 * payment and security codes, non-text input modes. Shared by typing-time
 * measurement formatting and review, so every entry point excludes the same.
 */
export function isSensitiveField(element: HTMLElement): boolean {
  // Autocomplete tokens are case-insensitive ("One-Time-Code").
  const autocomplete = (element.getAttribute("autocomplete") ?? "").toLowerCase();
  if (SECRET_AUTOCOMPLETE.test(autocomplete)) return true;
  const inputMode = element.getAttribute("inputmode")?.toLowerCase();
  if (inputMode && !["text", "search"].includes(inputMode)) return true;
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement;
    if (!["text", "search", ""].includes((input.type || "text").toLowerCase())) return true;
    if (SECRET_NAME.test(`${input.name} ${input.id}`)) return true;
  }
  // Masked like a password (PIN pads, custom secret fields).
  const masking = element.ownerDocument.defaultView
    ?.getComputedStyle(element)
    .getPropertyValue("-webkit-text-security");
  return !!masking && masking !== "none";
}

/** A disabled or read-only control; the user cannot edit it, so nothing may write to it. */
export function isLockedField(element: HTMLElement): boolean {
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    const field = element as HTMLInputElement | HTMLTextAreaElement;
    return field.disabled || field.readOnly;
  }
  return !element.isContentEditable || element.getAttribute("aria-readonly") === "true";
}
