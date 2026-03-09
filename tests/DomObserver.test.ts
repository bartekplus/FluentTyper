import { beforeEach, describe, expect, jest, test } from "bun:test";

let importNonce = 0;

async function loadDomObserverClass() {
  importNonce += 1;
  const module = await import(
    `../src/adapters/chrome/content-script/DomObserver?bun_test_nonce_dom_observer=${importNonce}`
  );
  return module.DomObserver;
}

describe("DomObserver", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("observes native autocomplete conflict attributes", async () => {
    const observe = jest.fn();
    const disconnect = jest.fn();
    const originalMutationObserver = globalThis.MutationObserver;
    const originalWindowMutationObserver = window.MutationObserver;

    class MockMutationObserver {
      constructor() {}

      observe = observe;
      disconnect = disconnect;
    }

    (
      globalThis as typeof globalThis & { MutationObserver: typeof MutationObserver }
    ).MutationObserver = MockMutationObserver as unknown as typeof MutationObserver;
    (window as Window & { MutationObserver: typeof MutationObserver }).MutationObserver =
      MockMutationObserver as unknown as typeof MutationObserver;

    try {
      const DomObserver = await loadDomObserverClass();
      const observer = new DomObserver(document.body, jest.fn());
      observer.attach();

      const observeOptions = observe.mock.calls[0]?.[1];
      expect(observe).toHaveBeenCalled();
      expect(observeOptions).toEqual(
        expect.objectContaining({
          attributes: true,
          subtree: true,
          attributeFilter: expect.arrayContaining([
            "list",
            "role",
            "autocomplete",
            "aria-autocomplete",
            "aria-expanded",
            "aria-controls",
            "aria-owns",
          ]),
        }),
      );
    } finally {
      (
        globalThis as typeof globalThis & { MutationObserver: typeof MutationObserver }
      ).MutationObserver = originalMutationObserver;
      (window as Window & { MutationObserver: typeof MutationObserver }).MutationObserver =
        originalWindowMutationObserver;
    }
  });
});
