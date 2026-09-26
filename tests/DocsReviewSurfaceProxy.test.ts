import { describe, expect, jest, test } from "bun:test";
import { DocsReviewSurfaceProxy } from "../src/adapters/chrome/content-script/review/DocsReviewSurfaceProxy";

function fakeAdapter() {
  let notify: () => void = () => {};
  let keyListener: (key: string) => boolean = () => false;
  return {
    reviewRead: jest.fn(() => Promise.resolve({ status: "inactive" as const })),
    reviewApply: jest.fn(() => Promise.resolve({ status: "applied" as const })),
    setReviewActive: jest.fn(),
    reviewFocusEditor: jest.fn(),
    onReviewSourceChange: jest.fn((listener: () => void) => {
      notify = listener;
      return () => {};
    }),
    onReviewKey: jest.fn((listener: (key: string) => boolean) => {
      keyListener = listener;
      return () => {};
    }),
    type: () => notify(),
    press: (key: string) => keyListener(key),
  };
}

describe("Docs review surface across a settings restart", () => {
  test("a replacement adapter inherits the open review and its listeners", async () => {
    const proxy = new DocsReviewSurfaceProxy();
    const first = fakeAdapter();
    proxy.attach(first);
    const changes = jest.fn();
    proxy.onReviewSourceChange(changes);
    proxy.setReviewActive(true);
    expect(first.setReviewActive).toHaveBeenCalledWith(true);
    first.type();
    expect(changes).toHaveBeenCalledTimes(1);

    // Settings restart: Docs support stops, then a new adapter starts.
    proxy.attach(null);
    expect(await proxy.reviewRead()).toEqual({ status: "busy" });
    const second = fakeAdapter();
    proxy.attach(second);
    expect(second.setReviewActive).toHaveBeenCalledWith(true);
    second.type();
    expect(changes).toHaveBeenCalledTimes(2);
    // The disposed adapter can no longer reach the review.
    first.type();
    expect(changes).toHaveBeenCalledTimes(2);
    proxy.reviewFocusEditor();
    expect(second.reviewFocusEditor).toHaveBeenCalledTimes(1);

    proxy.setReviewActive(false);
    const third = fakeAdapter();
    proxy.attach(third);
    expect(third.setReviewActive).not.toHaveBeenCalled();
  });

  test("keys in Docs' frame reach the review through whichever adapter is current", () => {
    const proxy = new DocsReviewSurfaceProxy();
    const first = fakeAdapter();
    proxy.attach(first);
    const keys: string[] = [];
    const stop = proxy.onReviewKey((key) => {
      keys.push(key);
      return key === "Escape";
    });
    expect(first.press("Escape")).toBe(true);
    expect(first.press("a")).toBe(false);
    const second = fakeAdapter();
    proxy.attach(second);
    // The replaced adapter no longer reaches the review; the new one does.
    expect(first.press("Escape")).toBe(false);
    expect(second.press("Escape")).toBe(true);
    stop();
    expect(second.press("Escape")).toBe(false);
    expect(keys).toEqual(["Escape", "a", "Escape"]);
  });
});
