import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { whenDocumentFocused } from "../src/adapters/chrome/content-script/review/whenDocumentFocused";

/** A page whose focus the test moves; its window fires "focus" only when told to. */
function fakePage() {
  const listeners = new Set<() => void>();
  const view = {
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    setInterval: (handler: () => void, ms: number) => setInterval(handler, ms),
    clearInterval: (id: number) => clearInterval(id),
  };
  const page = {
    focused: false,
    listeners,
    doc: { defaultView: view, hasFocus: () => page.focused } as unknown as Document,
    fireWindowFocus: () => [...listeners].forEach((listener) => listener()),
  };
  return page;
}

describe("a review asked for from the popup waits for the page's focus", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("focus returning into a child frame (Google Docs' input frame) starts it", () => {
    const page = fakePage();
    const run = jest.fn();
    whenDocumentFocused(page.doc, run, 1500);
    jest.advanceTimersByTime(200);
    expect(run).not.toHaveBeenCalled();
    // The popup closes; focus lands in the child frame, so this window gets no "focus" event.
    page.focused = true;
    jest.advanceTimersByTime(60);
    expect(run).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2000);
    page.fireWindowFocus();
    expect(run).toHaveBeenCalledTimes(1);
    expect(page.listeners.size).toBe(0);
  });

  test("the window's own focus event starts it at once", () => {
    const page = fakePage();
    const run = jest.fn();
    whenDocumentFocused(page.doc, run, 1500);
    page.focused = true;
    page.fireWindowFocus();
    expect(run).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("a page that never regains focus, or a cancelled wait, runs nothing", () => {
    const page = fakePage();
    const run = jest.fn();
    whenDocumentFocused(page.doc, run, 1500);
    jest.advanceTimersByTime(1600);
    page.focused = true;
    page.fireWindowFocus();
    jest.advanceTimersByTime(200);
    expect(run).not.toHaveBeenCalled();
    expect(page.listeners.size).toBe(0);

    const cancel = whenDocumentFocused(page.doc, run, 1500);
    page.focused = false;
    cancel();
    page.focused = true;
    jest.advanceTimersByTime(200);
    expect(run).not.toHaveBeenCalled();
  });
});
