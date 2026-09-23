/**
 * Sends a runtime message without awaiting it. A suspended or reloading
 * background (or runtime teardown) must never break the suggestion flow.
 */
export function sendFireAndForget<TMessage>(
  sendMessage: (message: TMessage, callback: () => void) => void,
  readLastError: () => unknown,
  message: TMessage,
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
