import { afterEach, describe, expect, jest, test } from "bun:test";
import {
  EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR,
  EARLY_TAB_ACCEPT_ENTRY_ID_ATTR,
  EARLY_TAB_ACCEPT_ENABLED_ATTR,
  EARLY_TAB_ACCEPT_MESSAGE_TYPE,
  EARLY_TAB_ACCEPT_VISIBLE_ATTR,
  installEarlyTabAcceptMainWorldBridge,
  resetEarlyTabAcceptMainWorldBridgeForTests,
} from "../src/adapters/chrome/content-script/suggestions/EarlyTabAcceptMainWorldBridge";

declare global {
  interface Window {
    __ftEarlyTabAcceptBridgeInstalled?: boolean;
  }
}

function createMenu(entryId: string, styles: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
  const menu = document.createElement("div");
  menu.id = `ft-menu-${entryId}`;
  menu.style.display = "block";
  Object.assign(menu.style, styles);
  return menu;
}

describe("EarlyTabAcceptMainWorldBridge", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("contenteditable");
    delete (document.body as { isContentEditable?: boolean }).isContentEditable;
    document.documentElement.removeAttribute("data-suggestion");
    document.documentElement.removeAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR);
    document.documentElement.removeAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR);
    document.documentElement.removeAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR);
    document.documentElement.removeAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR);
    document.querySelectorAll('[id^="ft-menu-"]').forEach((node) => node.remove());
    resetEarlyTabAcceptMainWorldBridgeForTests(document);
  });

  test("does not capture Tab when a linked site popup opens before observers run", () => {
    installEarlyTabAcceptMainWorldBridge(document);
    const input = document.createElement("div");
    input.setAttribute("contenteditable", "true");
    Object.defineProperty(input, "isContentEditable", { value: true });
    input.setAttribute("data-suggestion", "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, "race");
    input.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "true");
    input.setAttribute("aria-controls", "site-list");
    const popup = document.createElement("div");
    popup.id = "site-list";
    popup.setAttribute("role", "listbox");
    popup.innerHTML = '<div role="option">Site choice</div>';
    for (const node of [popup, popup.firstElementChild!])
      node.getClientRects = () =>
        [
          { left: 10, top: 10, right: 20, bottom: 20, width: 10, height: 10 },
        ] as unknown as DOMRectList;
    document.body.append(input, createMenu("race"), popup);
    const post = jest.spyOn(window, "postMessage");
    const event = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(post).not.toHaveBeenCalled();
    post.mockRestore();
  });

  test("posts an early accept request before a later page capture listener stops propagation", () => {
    installEarlyTabAcceptMainWorldBridge(document);
    const postMessageSpy = jest.spyOn(window, "postMessage");

    const input = document.createElement("div");
    input.setAttribute("contenteditable", "true");
    Object.defineProperty(input, "isContentEditable", { value: true, configurable: true });
    input.setAttribute("data-suggestion", "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, "7");
    input.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "true");
    const menu = createMenu("7");
    document.body.append(input, menu);

    const pageCaptureBlocker = (event: Event) => {
      event.stopImmediatePropagation();
    };
    document.addEventListener("keydown", pageCaptureBlocker, true);

    const keydown = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keydown);

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        source: "ft-early-tab-accept-request",
        type: EARLY_TAB_ACCEPT_MESSAGE_TYPE,
        entryId: "7",
      },
      "*",
    );
    expect(keydown.defaultPrevented).toBe(true);
    document.removeEventListener("keydown", pageCaptureBlocker, true);
    postMessageSpy.mockRestore();
  });

  test("posts an early accept request before a later window capture listener stops propagation", () => {
    installEarlyTabAcceptMainWorldBridge(document);
    const postMessageSpy = jest.spyOn(window, "postMessage");

    const input = document.createElement("div");
    input.setAttribute("contenteditable", "true");
    Object.defineProperty(input, "isContentEditable", { value: true, configurable: true });
    input.setAttribute("data-suggestion", "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, "9");
    input.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "true");
    const menu = createMenu("9");
    document.body.append(input, menu);

    const windowCaptureBlocker = (event: Event) => {
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", windowCaptureBlocker, true);

    const keydown = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keydown);

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        source: "ft-early-tab-accept-request",
        type: EARLY_TAB_ACCEPT_MESSAGE_TYPE,
        entryId: "9",
      },
      "*",
    );
    expect(keydown.defaultPrevented).toBe(true);
    window.removeEventListener("keydown", windowCaptureBlocker, true);
    postMessageSpy.mockRestore();
  });

  test("does not post when there is no visible FluentTyper menu", () => {
    installEarlyTabAcceptMainWorldBridge(document);
    const postMessageSpy = jest.spyOn(window, "postMessage");

    const input = document.createElement("div");
    input.setAttribute("contenteditable", "true");
    Object.defineProperty(input, "isContentEditable", { value: true, configurable: true });
    input.setAttribute("data-suggestion", "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, "7");
    input.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "false");
    const menu = createMenu("7", { display: "none" });
    document.body.append(input, menu);

    const keydown = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keydown);

    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(keydown.defaultPrevented).toBe(false);
    postMessageSpy.mockRestore();
  });

  test("does not post when Tab acceptance is disabled for the managed target", () => {
    installEarlyTabAcceptMainWorldBridge(document);
    const postMessageSpy = jest.spyOn(window, "postMessage");

    const input = document.createElement("div");
    input.setAttribute("contenteditable", "true");
    Object.defineProperty(input, "isContentEditable", { value: true, configurable: true });
    input.setAttribute("data-suggestion", "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR, "false");
    input.setAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, "11");
    input.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "true");
    const menu = createMenu("11");
    document.body.append(input, menu);

    const keydown = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keydown);

    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(keydown.defaultPrevented).toBe(false);
    postMessageSpy.mockRestore();
  });

  test("does not post for plain text inputs that should keep the regular Tab handler", () => {
    installEarlyTabAcceptMainWorldBridge(document);
    const postMessageSpy = jest.spyOn(window, "postMessage");

    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("data-suggestion", "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR, "false");
    input.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, "13");
    input.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "true");
    const menu = createMenu("13");
    document.body.append(input, menu);

    const keydown = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keydown);

    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(keydown.defaultPrevented).toBe(false);
    postMessageSpy.mockRestore();
  });

  test("does not post when the popup host was removed without clearing the visible flag", () => {
    installEarlyTabAcceptMainWorldBridge(document);
    const postMessageSpy = jest.spyOn(window, "postMessage");

    const input = document.createElement("div");
    input.setAttribute("contenteditable", "true");
    Object.defineProperty(input, "isContentEditable", { value: true, configurable: true });
    input.setAttribute("data-suggestion", "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, "17");
    input.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "true");
    const menu = createMenu("17");
    document.body.append(input, menu);
    menu.remove();

    const keydown = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keydown);

    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(keydown.defaultPrevented).toBe(false);
    postMessageSpy.mockRestore();
  });

  test("does not post when the popup host is computed hidden without clearing the visible flag", () => {
    installEarlyTabAcceptMainWorldBridge(document);
    const postMessageSpy = jest.spyOn(window, "postMessage");

    const input = document.createElement("div");
    input.setAttribute("contenteditable", "true");
    Object.defineProperty(input, "isContentEditable", { value: true, configurable: true });
    input.setAttribute("data-suggestion", "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR, "true");
    input.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, "19");
    input.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "true");
    const menu = createMenu("19", { visibility: "hidden" });
    document.body.append(input, menu);

    const keydown = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keydown);

    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(keydown.defaultPrevented).toBe(false);
    postMessageSpy.mockRestore();
  });

  test("leaves Tab to a toolbar control with stale managed markers", () => {
    installEarlyTabAcceptMainWorldBridge(document);
    const postMessageSpy = jest.spyOn(window, "postMessage");
    const toolbar = document.createElement("div");
    toolbar.setAttribute("role", "toolbar");
    const input = document.createElement("input");
    input.setAttribute("data-suggestion", "true");
    for (const attr of [
      EARLY_TAB_ACCEPT_ENABLED_ATTR,
      EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR,
      EARLY_TAB_ACCEPT_VISIBLE_ATTR,
    ]) {
      input.setAttribute(attr, "true");
    }
    input.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, "31");
    input.setAttribute("data-ft-avoid-conflicts", "false");
    toolbar.append(input);
    document.body.append(toolbar, createMenu("31"));
    const keydown = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keydown);
    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(keydown.defaultPrevented).toBe(false);
    postMessageSpy.mockRestore();
  });

  test("posts for a contenteditable body when the bridge markers live on the html root", () => {
    installEarlyTabAcceptMainWorldBridge(document);
    const postMessageSpy = jest.spyOn(window, "postMessage");

    document.body.setAttribute("contenteditable", "true");
    Object.defineProperty(document.body, "isContentEditable", {
      value: true,
      configurable: true,
    });
    document.documentElement.setAttribute("data-suggestion", "true");
    document.documentElement.setAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR, "true");
    document.documentElement.setAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR, "true");
    document.documentElement.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, "29");
    document.documentElement.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "true");
    const menu = createMenu("29");
    document.documentElement.append(menu);

    const keydown = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(keydown);

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        source: "ft-early-tab-accept-request",
        type: EARLY_TAB_ACCEPT_MESSAGE_TYPE,
        entryId: "29",
      },
      "*",
    );
    expect(keydown.defaultPrevented).toBe(true);
    postMessageSpy.mockRestore();
  });
});
