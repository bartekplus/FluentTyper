import { afterEach, describe, expect, jest, test } from "bun:test";
import { DomObserver } from "../src/adapters/chrome/content-script/DomObserver";

const originalMutationObserver = globalThis.MutationObserver;

describe("DomObserver", () => {
  afterEach(() => {
    if (originalMutationObserver) {
      (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver =
        originalMutationObserver;
    } else {
      delete (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
    }
  });

  test("observes visibility-related attributes to catch hidden->visible toggles", () => {
    const observe = jest.fn();
    const disconnect = jest.fn();

    class MockMutationObserver {
      public readonly observe = observe;
      public readonly disconnect = disconnect;

      constructor() {}
    }

    (globalThis as { MutationObserver: typeof MutationObserver }).MutationObserver =
      MockMutationObserver as unknown as typeof MutationObserver;

    const root = document.createElement("div");
    const domObserver = new DomObserver(root, () => undefined);
    domObserver.attach();

    expect(observe).toHaveBeenCalledWith(
      root,
      expect.objectContaining({
        childList: true,
        attributes: true,
        subtree: true,
        attributeFilter: expect.arrayContaining([
          "contenteditable",
          "type",
          "name",
          "id",
          "style",
          "class",
          "hidden",
        ]),
      }),
    );
  });

  test("setNode reconnects observer to the new root", () => {
    const observe = jest.fn();
    const disconnect = jest.fn();

    class MockMutationObserver {
      public readonly observe = observe;
      public readonly disconnect = disconnect;

      constructor() {}
    }

    (globalThis as { MutationObserver: typeof MutationObserver }).MutationObserver =
      MockMutationObserver as unknown as typeof MutationObserver;

    const initialRoot = document.createElement("div");
    const nextRoot = document.createElement("section");
    const domObserver = new DomObserver(initialRoot, () => undefined);

    domObserver.attach();
    observe.mockClear();
    disconnect.mockClear();

    domObserver.setNode(nextRoot);

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(
      nextRoot,
      expect.objectContaining({
        childList: true,
        attributes: true,
        subtree: true,
      }),
    );
  });
});
