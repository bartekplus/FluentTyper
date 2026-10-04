import { createEditor, setCaret } from "./codeContextTestUtils";
import { afterEach, beforeEach, describe, expect, jest, test, type Mock } from "bun:test";
import {
  EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR,
  EARLY_TAB_ACCEPT_ENTRY_ID_ATTR,
  EARLY_TAB_ACCEPT_ENABLED_ATTR,
  EARLY_TAB_ACCEPT_MESSAGE_TYPE,
  EARLY_TAB_ACCEPT_VISIBLE_ATTR,
} from "../src/adapters/chrome/content-script/suggestions/EarlyTabAcceptBridgeProtocol";
import {
  installEarlyTabAcceptMainWorldBridge,
  uninstallEarlyTabAcceptMainWorldBridge,
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

/** Sets the bridge markers on element. All markers are "true" unless overrides change them. */
function bridgeTarget(
  entryId: string,
  overrides: Record<string, string> = {},
  element: Element = createEditor(""),
): Element {
  const attributes = {
    "data-suggestion": "true",
    [EARLY_TAB_ACCEPT_ENABLED_ATTR]: "true",
    [EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR]: "true",
    [EARLY_TAB_ACCEPT_ENTRY_ID_ATTR]: entryId,
    [EARLY_TAB_ACCEPT_VISIBLE_ATTR]: "true",
    ...overrides,
  };
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function pressTab(target: EventTarget): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function acceptRequest(entryId: string) {
  return { source: "ft-early-tab-accept-request", type: EARLY_TAB_ACCEPT_MESSAGE_TYPE, entryId };
}

describe("EarlyTabAcceptMainWorldBridge", () => {
  let postMessageSpy: Mock<typeof window.postMessage>;

  beforeEach(() => {
    installEarlyTabAcceptMainWorldBridge(document);
    postMessageSpy = jest.spyOn(window, "postMessage");
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
    document.querySelectorAll('[id^="ft-menu-"]').forEach((node) => node.remove());
    uninstallEarlyTabAcceptMainWorldBridge(document);
  });

  test("does not capture Tab when a linked site popup opens before observers run", () => {
    const input = bridgeTarget("race", { "aria-controls": "site-list" });
    const popup = document.createElement("div");
    popup.id = "site-list";
    popup.setAttribute("role", "listbox");
    popup.innerHTML = '<div role="option">Site choice</div>';
    for (const node of [popup, popup.firstElementChild!])
      node.getClientRects = () =>
        [
          { left: 10, top: 10, right: 20, bottom: 20, width: 10, height: 10 },
        ] as unknown as DOMRectList;
    document.body.append(createMenu("race"), popup);
    expect(pressTab(input).defaultPrevented).toBe(false);
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  test.each([
    ["page", document],
    ["window", window],
  ] as const)(
    "posts an early accept request before a later %s capture listener stops propagation",
    (_, captureTarget) => {
      const input = bridgeTarget("7");
      document.body.append(createMenu("7"));
      const captureBlocker = (event: Event) => {
        event.stopImmediatePropagation();
      };
      captureTarget.addEventListener("keydown", captureBlocker, true);

      const keydown = pressTab(input);

      expect(postMessageSpy).toHaveBeenCalledWith(acceptRequest("7"), "*");
      expect(keydown.defaultPrevented).toBe(true);
      captureTarget.removeEventListener("keydown", captureBlocker, true);
    },
  );

  test("does not post when there is no visible FluentTyper menu", () => {
    const input = bridgeTarget("7", { [EARLY_TAB_ACCEPT_VISIBLE_ATTR]: "false" });
    document.body.append(createMenu("7", { display: "none" }));

    expect(pressTab(input).defaultPrevented).toBe(false);
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  test("does not post when Tab acceptance is disabled for the managed target", () => {
    const input = bridgeTarget("11", { [EARLY_TAB_ACCEPT_ENABLED_ATTR]: "false" });
    document.body.append(createMenu("11"));

    expect(pressTab(input).defaultPrevented).toBe(false);
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  test("does not post for plain text inputs that should keep the regular Tab handler", () => {
    const input = bridgeTarget(
      "13",
      { [EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR]: "false" },
      document.createElement("input"),
    );
    document.body.append(input, createMenu("13"));

    expect(pressTab(input).defaultPrevented).toBe(false);
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  test("does not post when the popup host was removed without clearing the visible flag", () => {
    const input = bridgeTarget("17");
    const menu = createMenu("17");
    document.body.append(menu);
    menu.remove();

    expect(pressTab(input).defaultPrevented).toBe(false);
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  test("does not post when the popup host is computed hidden without clearing the visible flag", () => {
    const input = bridgeTarget("19");
    document.body.append(createMenu("19", { visibility: "hidden" }));

    expect(pressTab(input).defaultPrevented).toBe(false);
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  test("leaves Tab to a toolbar control with stale managed markers", () => {
    const toolbar = document.createElement("div");
    toolbar.setAttribute("role", "toolbar");
    const input = bridgeTarget(
      "31",
      { "data-ft-avoid-conflicts": "false" },
      document.createElement("input"),
    );
    toolbar.append(input);
    document.body.append(toolbar, createMenu("31"));

    expect(pressTab(input).defaultPrevented).toBe(false);
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  test("posts for a contenteditable body when the bridge markers live on the html root", () => {
    document.body.setAttribute("contenteditable", "true");
    Object.defineProperty(document.body, "isContentEditable", {
      value: true,
      configurable: true,
    });
    bridgeTarget("29", {}, document.documentElement);
    document.documentElement.append(createMenu("29"));

    const keydown = pressTab(document.body);

    expect(postMessageSpy).toHaveBeenCalledWith(acceptRequest("29"), "*");
    expect(keydown.defaultPrevented).toBe(true);
  });

  test("early Tab yields after a rendered prose suggestion moves into code", () => {
    const root = bridgeTarget(
      "context",
      { "data-ft-suggestion-context": "prose" },
      createEditor("<p>hel</p><code>hel</code>"),
    );
    document.body.append(createMenu("context"));
    setCaret(root.lastElementChild!.firstChild!);
    expect(pressTab(root).defaultPrevented).toBe(false);
  });
});
