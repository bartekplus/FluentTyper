export function isMacPlatform(platform = getNavigatorPlatform()): boolean {
  return /mac/i.test(platform);
}

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

  if (isMacPlatform(platform)) {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.metaKey;
}

function getNavigatorPlatform(): string {
  if (typeof navigator === "undefined") {
    return "";
  }
  return navigator.platform || "";
}
