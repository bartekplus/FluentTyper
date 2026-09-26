const FOCUS_POLL_MS = 50;

/**
 * Runs `callback` once `doc` has focus again (the popup that asked for a review
 * is closing), or never if that takes longer than `timeoutMs`. Returns a
 * cancel function.
 *
 * The window's own "focus" event is not enough: when focus returns into a
 * child frame, only that frame's window gets it. Google Docs types into such a
 * frame while its top document hosts the review, so `hasFocus()`, which is
 * true for a document whose descendant frame holds focus, is also polled.
 */
export function whenDocumentFocused(
  doc: Document,
  callback: () => void,
  timeoutMs: number,
): () => void {
  const view = doc.defaultView;
  if (!view) return () => {};
  const deadline = Date.now() + timeoutMs;
  let done = false;
  let poll = 0;
  const stop = () => {
    done = true;
    view.removeEventListener("focus", check);
    view.clearInterval(poll);
  };
  function check(): void {
    if (done) return;
    if (doc.hasFocus()) {
      stop();
      callback();
    } else if (Date.now() >= deadline) {
      stop();
    }
  }
  view.addEventListener("focus", check);
  poll = view.setInterval(check, FOCUS_POLL_MS);
  return stop;
}
