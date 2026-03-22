import {
  EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR,
  EARLY_TAB_ACCEPT_ENABLED_ATTR,
  EARLY_TAB_ACCEPT_ENTRY_ID_ATTR,
  EARLY_TAB_ACCEPT_MAIN_WORLD_FLAG,
  EARLY_TAB_ACCEPT_MESSAGE_TYPE,
  EARLY_TAB_ACCEPT_REQUEST_EVENT,
  EARLY_TAB_ACCEPT_VISIBLE_ATTR,
} from "./EarlyTabAcceptBridgeProtocol";
import {
  isSuggestionMenuHostVisible,
  resolveSuggestionMenuHost,
} from "./SuggestionMenuHost";

type FluentTyperManagedElement = HTMLElement;
type FluentTyperBridgeWindow = Window & {
  [EARLY_TAB_ACCEPT_MAIN_WORLD_FLAG]?: boolean;
  __ftEarlyTabAcceptBridgeKeydownHandler?: (event: KeyboardEvent) => void;
};

function isManagedSuggestionTarget(
  element: HTMLElement | null,
  doc: Document,
): element is FluentTyperManagedElement {
  const entryId =
    element instanceof HTMLElement ? element.getAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR) : null;
  return (
    element instanceof HTMLElement &&
    element.getAttribute("data-suggestion") === "true" &&
    element.getAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR) === "true" &&
    element.getAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR) === "true" &&
    element.getAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR) === "true" &&
    !!entryId &&
    isSuggestionMenuHostVisible(resolveSuggestionMenuHost(doc, entryId))
  );
}

function findManagedSuggestionTarget(
  start: HTMLElement | null,
  doc: Document,
): FluentTyperManagedElement | null {
  let current: Node | null = start;
  while (current) {
    if (current instanceof HTMLElement && isManagedSuggestionTarget(current, doc)) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function resolveManagedSuggestionTarget(
  event: KeyboardEvent,
  doc: Document,
): FluentTyperManagedElement | null {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
  for (const node of path) {
    if (node instanceof HTMLElement) {
      const match = findManagedSuggestionTarget(node, doc);
      if (match) {
        return match;
      }
    }
  }

  const activeElement = doc.activeElement;
  return activeElement instanceof HTMLElement ? findManagedSuggestionTarget(activeElement, doc) : null;
}

export function installEarlyTabAcceptMainWorldBridge(doc: Document = document): void {
  const win = doc.defaultView;
  if (!win) {
    return;
  }
  const bridgeWindow = win as FluentTyperBridgeWindow;
  if (bridgeWindow[EARLY_TAB_ACCEPT_MAIN_WORLD_FLAG]) {
    return;
  }

  bridgeWindow[EARLY_TAB_ACCEPT_MAIN_WORLD_FLAG] = true;

  const handler = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.key !== "Tab" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.isComposing
    ) {
      return;
    }

    const target = resolveManagedSuggestionTarget(event, doc);
    if (!target) {
      return;
    }

    const entryId = target.getAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR);
    if (!entryId) {
      return;
    }

    win.postMessage(
      {
        source: EARLY_TAB_ACCEPT_REQUEST_EVENT,
        type: EARLY_TAB_ACCEPT_MESSAGE_TYPE,
        entryId,
      },
      "*",
    );
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };
  bridgeWindow.__ftEarlyTabAcceptBridgeKeydownHandler = handler;

  win.addEventListener("keydown", handler, true);
}

export function resetEarlyTabAcceptMainWorldBridgeForTests(doc: Document = document): void {
  const win = doc.defaultView as FluentTyperBridgeWindow | null;
  if (!win) {
    return;
  }

  const handler = win.__ftEarlyTabAcceptBridgeKeydownHandler;
  if (handler) {
    win.removeEventListener("keydown", handler, true);
    delete win.__ftEarlyTabAcceptBridgeKeydownHandler;
  }

  if (win[EARLY_TAB_ACCEPT_MAIN_WORLD_FLAG]) {
    delete win[EARLY_TAB_ACCEPT_MAIN_WORLD_FLAG];
  }
}

export {
  EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR,
  EARLY_TAB_ACCEPT_ENABLED_ATTR,
  EARLY_TAB_ACCEPT_ENTRY_ID_ATTR,
  EARLY_TAB_ACCEPT_MESSAGE_TYPE,
  EARLY_TAB_ACCEPT_REQUEST_EVENT,
  EARLY_TAB_ACCEPT_VISIBLE_ATTR,
} from "./EarlyTabAcceptBridgeProtocol";
