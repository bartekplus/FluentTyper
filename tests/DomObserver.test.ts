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
      expect(observeOptions).not.toHaveProperty("characterData");
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

  test("reports added fields and ignores text changes", async () => {
    const root = document.createElement("div");
    const text = document.createTextNode("a");
    root.appendChild(text);
    document.body.appendChild(root);
    const callback = jest.fn();
    const observer = new DomObserver(root, callback);
    try {
      observer.attach();

      text.data = "b";
      await Promise.resolve();
      expect(callback).not.toHaveBeenCalled();

      const input = document.createElement("input");
      root.appendChild(input);
      await Promise.resolve();
      const records = callback.mock.calls.flatMap(([batch]) => batch as MutationRecord[]);
      expect(records.some((record) => Array.from(record.addedNodes).includes(input))).toBe(true);
    } finally {
      observer.disconnect();
      root.remove();
    }
  });
});
