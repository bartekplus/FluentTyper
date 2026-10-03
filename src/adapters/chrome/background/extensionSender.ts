/** True when the sender is a page of this extension (for example the options page). */
export function isExtensionPageSender(
  sender: chrome.runtime.MessageSender | undefined,
  api: typeof chrome = chrome,
): boolean {
  return typeof sender?.url === "string" && sender.url.startsWith(api.runtime.getURL(""));
}
