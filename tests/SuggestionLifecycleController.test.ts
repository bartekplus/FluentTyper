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

  test("listens to backing textarea lifecycle events for CodeMirror-backed entries", () => {
    const textarea = document.createElement("textarea");
    const codeMirror = document.createElement("div");
    codeMirror.className = "CodeMirror-code";
    codeMirror.setAttribute("contenteditable", "true");
    const menu = document.createElement("div");
    document.body.append(textarea, codeMirror, menu);

    const input = jest.fn();
    const focus = jest.fn();
    const blur = jest.fn();
    const entry = createSuggestionEntry({
      elem: codeMirror as unknown as SuggestionElement,
      inputEventTarget: textarea,
      menu,
      handlers: {
        input,
        keydown: () => undefined,
        paste: () => undefined,
        focus,
        blur,
        click: () => undefined,
        compositionStart: () => undefined,
        compositionEnd: () => undefined,
        menuMouseDown: () => undefined,
        menuClick: () => undefined,
      },
    });

    const controller = new SuggestionLifecycleController({
      getEntries: () => [entry],
      dismissEntry: () => undefined,
      reconcileEntrySelection: () => undefined,
    });
    controller.attachEntryListeners(entry);

    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("focus", { bubbles: true }));
    textarea.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(input).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(blur).toHaveBeenCalledTimes(1);

    controller.detachEntryListeners(entry);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("focus", { bubbles: true }));
    textarea.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(input).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(blur).toHaveBeenCalledTimes(1);
  });
});
