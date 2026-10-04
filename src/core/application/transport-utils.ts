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

/** Bound a request without restarting its shared resource load. Late answers are ignored. */
export async function withDeadline<T>(
  request: Promise<T>,
  milliseconds = 10_000,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("resource-timeout")), milliseconds);
        onAbort = () => reject(new DOMException("Review request cancelled", "AbortError"));
        signal?.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
