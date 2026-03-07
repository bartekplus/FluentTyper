import { beforeEach, describe, expect, jest, test } from "bun:test";
import { SuggestionLifecycleController } from "../src/adapters/chrome/content-script/suggestions/SuggestionLifecycleController";
import type { SuggestionElement } from "../src/adapters/chrome/content-script/suggestions/types";
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

  // Regression: without composedPath(), event.target is retargeted to the shadow
  // host when the mousedown originates inside a shadow root, causing the extension
  // to wrongly dismiss the menu on every click within a shadow-hosted field.
  test("does not dismiss entry when mousedown originates inside a shadow-hosted elem", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const shadowInput = document.createElement("input") as unknown as SuggestionElement;
    shadow.appendChild(shadowInput as HTMLElement);
    const menu = document.createElement("div");
    document.body.appendChild(menu);
    const entry = createSuggestionEntry({ elem: shadowInput, menu });
    const dismissEntry = jest.fn();

    const controller = new SuggestionLifecycleController({
      getEntries: () => [entry],
      dismissEntry,
      reconcileEntrySelection: () => undefined,
    });
    controller.attachEntryListeners(entry);

    // composed:true lets the event cross the shadow boundary to the document listener.
    (shadowInput as HTMLElement).dispatchEvent(
      new Event("mousedown", { bubbles: true, composed: true }),
    );
    expect(dismissEntry).not.toHaveBeenCalled();

    controller.detachEntryListeners(entry);
    host.remove();
    menu.remove();
  });

  test("dismisses shadow-hosted entry on mousedown outside its host", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const shadowInput = document.createElement("input") as unknown as SuggestionElement;
    shadow.appendChild(shadowInput as HTMLElement);
    const menu = document.createElement("div");
    const outside = document.createElement("div");
    document.body.appendChild(menu);
    document.body.appendChild(outside);
    const entry = createSuggestionEntry({ elem: shadowInput, menu });
    const dismissEntry = jest.fn();

    const controller = new SuggestionLifecycleController({
      getEntries: () => [entry],
      dismissEntry,
      reconcileEntrySelection: () => undefined,
    });
    controller.attachEntryListeners(entry);

    outside.dispatchEvent(new Event("mousedown", { bubbles: true, composed: true }));
    expect(dismissEntry).toHaveBeenCalledWith(entry);

    controller.detachEntryListeners(entry);
    host.remove();
    menu.remove();
    outside.remove();
  });
});
