/**
 * Sends a runtime message without awaiting it. A suspended or reloading
 * background (or runtime teardown) must never break the suggestion flow.
 */
export function sendFireAndForget<TMessage>(
  message: TMessage,
  sendMessage: (message: TMessage, callback: () => void) => void = (value, callback) => {
    chrome.runtime.sendMessage(value, callback);
  },
  readLastError: () => unknown = () => chrome.runtime.lastError,
): void {
  try {
    sendMessage(message, () => {
      try {
        void readLastError();
      } catch {
        // Ignore runtime teardown.
      }
    });
  } catch {
    // Background unavailable; drop the event.
  }
}
