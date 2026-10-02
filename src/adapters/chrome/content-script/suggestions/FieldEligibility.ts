const SECRET_AUTOCOMPLETE =
  /(?:^|\s)(?:current-password|new-password|one-time-code|cc-[a-z-]+)(?:\s|$)/;
const SECRET_NAME =
  /pass(?:word|wd|code|phrase)|(?<![a-z])(?:pass|pwd|otp|totp|hotp|cvc|cvv|csc)(?![a-z])|one.?time|card.?num|cc.?num|security.?code|\bpin\b|(?<![a-z0-9])(?:ssn|[2m]fa)(?![a-z0-9])|social.?security|verif(?:y|ication).?code|auth.?code/i;

/**
 * Fields whose content is a secret or not prose: passwords, one-time codes,
 * payment and security codes, non-text input modes. Shared by typing-time
 * measurement formatting and review, so every entry point excludes the same.
 */
export function isCredentialField(element: HTMLElement): boolean {
  if (SECRET_AUTOCOMPLETE.test((element.getAttribute("autocomplete") ?? "").toLowerCase()))
    return true;
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement;
    const identifiers = `${input.name} ${input.id}`
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    if (input.type === "password" || SECRET_NAME.test(identifiers)) return true;
  }
  const masking = element.ownerDocument.defaultView
    ?.getComputedStyle(element)
    .getPropertyValue("-webkit-text-security");
  return !!masking && masking !== "none";
}

export function isSensitiveField(element: HTMLElement): boolean {
  if (isCredentialField(element)) return true;
  // Preserve Review/formatting's existing conservative exclusion independently of activation.
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement;
    if (/pass|pwd|otp|cvc|cvv|csc/i.test(`${input.name} ${input.id}`)) return true;
  }
  const inputMode = element.getAttribute("inputmode")?.toLowerCase();
  if (inputMode && !["text", "search"].includes(inputMode)) return true;
  return (
    element.tagName === "INPUT" &&
    !["text", "search", ""].includes((element as HTMLInputElement).type.toLowerCase())
  );
}

/** A disabled or read-only control; the user cannot edit it, so nothing may write to it. */
export function isLockedField(element: HTMLElement): boolean {
  if (element.getAttribute("aria-readonly") === "true" || element.closest("[inert]")) return true;
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    const field = element as HTMLInputElement | HTMLTextAreaElement;
    return field.disabled || field.readOnly || field.matches(":disabled");
  }
  return !element.isContentEditable || element.getAttribute("aria-readonly") === "true";
}
