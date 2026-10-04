import { describe, expect, jest, test } from "bun:test";
import { DomObserver } from "../src/adapters/chrome/content-script/DomObserver";

describe("DomObserver", () => {
  test("observes native autocomplete conflict attributes", () => {
    const observe = jest.spyOn(MutationObserver.prototype, "observe");
    const observer = new DomObserver(document.body, jest.fn());
    try {
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
      observer.disconnect();
      observe.mockRestore();
    }
  });
});
