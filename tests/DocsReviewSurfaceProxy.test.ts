import { describe, expect, jest, test } from "bun:test";
import { DocsReviewSurfaceProxy } from "../src/adapters/chrome/content-script/review/DocsReviewSurfaceProxy";

function fakeAdapter() {
  let notify: () => void = () => {};
  return {
    reviewRead: jest.fn(() => Promise.resolve({ status: "inactive" as const })),
    reviewApply: jest.fn(() => Promise.resolve({ status: "applied" as const })),
    setReviewActive: jest.fn(),
    reviewFocusEditor: jest.fn(),
    onReviewSourceChange: jest.fn((listener: () => void) => {
      notify = listener;
      return () => {};
    }),
    type: () => notify(),
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
});
