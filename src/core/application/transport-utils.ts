import { getErrorMessage } from "@core/domain/error";

export function checkLastError(): void {
  try {
    if (chrome.runtime.lastError) {
      console.log("Runtime error:", chrome.runtime.lastError.message);
    }
  } catch (error: unknown) {
    console.error(`Error while checking runtime error: ${getErrorMessage(error)}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function promisifiedSendMessage<T = any>(
  tabId: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any,
  options?: chrome.tabs.MessageSendOptions,
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, options || {}, (res) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(res);
      }
    });
  });
}
