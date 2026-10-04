/** True when the sender is a page of this extension, optionally under `path` (for example "options/"). */
export function isExtensionPageSender(
  sender: chrome.runtime.MessageSender | undefined,
  api: typeof chrome = chrome,
  path = "",
): boolean {
  return typeof sender?.url === "string" && sender.url.startsWith(api.runtime.getURL(path));
}
