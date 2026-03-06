import { beforeEach, describe, expect, jest, test } from "bun:test";
import { SuggestionLifecycleController } from "../src/adapters/chrome/content-script/suggestions/SuggestionLifecycleController";
import { createSuggestionEntry } from "./suggestionTestUtils";

describe("SuggestionLifecycleController", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("dismisses entry on outside mousedown", () => {
    const elem = document.createElement("input");
    const menu = document.createElement("div");
    const outside = document.createElement("div");
    document.body.appendChild(elem);
    document.body.appendChild(menu);
    document.body.appendChild(outside);
    const entry = createSuggestionEntry({ elem, menu });
    const dismissEntry = jest.fn();

    const controller = new SuggestionLifecycleController({
      getEntries: () => [entry],
      dismissEntry,
      reconcileEntrySelection: () => undefined,
    });
    controller.attachEntryListeners(entry);

    outside.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
    expect(dismissEntry).toHaveBeenCalledWith(entry);
  });

  test("does not dismiss on inside target click and detaches global listener", () => {
    const elem = document.createElement("input");
    const menu = document.createElement("div");
    const outside = document.createElement("div");
    document.body.appendChild(elem);
    document.body.appendChild(menu);
    document.body.appendChild(outside);
    const entry = createSuggestionEntry({ elem, menu });
    const dismissEntry = jest.fn();

    const controller = new SuggestionLifecycleController({
      getEntries: () => [entry],
      dismissEntry,
      reconcileEntrySelection: () => undefined,
    });
    controller.attachEntryListeners(entry);

    elem.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
    expect(dismissEntry).not.toHaveBeenCalled();

    controller.detachEntryListeners(entry);
    outside.dispatchEvent(new Event("mousedown", { bubbles: true, cancelable: true }));
    expect(dismissEntry).not.toHaveBeenCalled();
  });
});
