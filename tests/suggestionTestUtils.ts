import type {
  SuggestionEntry,
  SuggestionElement,
} from "../src/adapters/chrome/content-script/suggestions/types";
import { EARLY_TAB_ACCEPT_ENTRY_ID_ATTR } from "../src/adapters/chrome/content-script/suggestions/EarlyTabAcceptMainWorldBridge";
import { SuggestionMenuView } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuView";

export function createSuggestionEntry(
  overrides: Partial<SuggestionEntry> & { elem?: SuggestionElement } = {},
): SuggestionEntry {
  const elem = overrides.elem ?? document.createElement("input");
  const menu = overrides.menu ?? document.createElement("div");
  const list = overrides.list ?? document.createElement("ul");
  if (!menu.contains(list)) {
    menu.appendChild(list);
  }

  return {
    id: overrides.id ?? 1,
    elem,
    inputEventTarget: overrides.inputEventTarget ?? null,
    menu,
    list,
    requestId: overrides.requestId ?? 0,
    suggestions: overrides.suggestions ?? [],
    selectedIndex: overrides.selectedIndex ?? 0,
    menuHeader: overrides.menuHeader ?? null,
    latestMentionText: overrides.latestMentionText ?? "",
    latestMentionStart: overrides.latestMentionStart ?? 0,
    visibleSuggestionBeforeCursorText: overrides.visibleSuggestionBeforeCursorText ?? null,
    visibleSuggestionFullText: overrides.visibleSuggestionFullText ?? null,
    inlineSuggestion: overrides.inlineSuggestion ?? null,
    pendingInlineAccept: overrides.pendingInlineAccept ?? false,
    missingTrailingSpace: overrides.missingTrailingSpace ?? false,
    expectedCursorPos: overrides.expectedCursorPos ?? 0,
    expectedCursorPosIsBlockLocal: overrides.expectedCursorPosIsBlockLocal ?? false,
    expectedCursorPosBlockElement: overrides.expectedCursorPosBlockElement ?? null,
    expectedCursorPosBlockText: overrides.expectedCursorPosBlockText ?? null,
    pendingExtensionEdit: overrides.pendingExtensionEdit ?? null,
    suppressNextSuggestionInputPrediction: overrides.suppressNextSuggestionInputPrediction ?? false,
    manualAutoFixSuppression: overrides.manualAutoFixSuppression ?? null,
    isComposing: overrides.isComposing ?? false,
    lastKeydownKey: overrides.lastKeydownKey ?? null,
    lastInputAction: overrides.lastInputAction ?? null,
    lastBeforeCursorText: overrides.lastBeforeCursorText ?? null,
    hasMultipleBlockDescendants: overrides.hasMultipleBlockDescendants ?? false,
    pendingRequestTimer: overrides.pendingRequestTimer ?? null,
    pendingIdleTimer: overrides.pendingIdleTimer ?? null,
    pendingGrammarPaste: overrides.pendingGrammarPaste ?? false,
    recentInteractionTrail: overrides.recentInteractionTrail ?? [],
    handlers: overrides.handlers ?? {
      input: () => undefined,
      keydown: () => undefined,
      paste: () => undefined,
      focus: () => undefined,
      blur: () => undefined,
      click: () => undefined,
      compositionStart: () => undefined,
      compositionEnd: () => undefined,
      menuMouseDown: () => undefined,
      menuClick: () => undefined,
    },
  };
}

export function createRect(left = 10, top = 20, width = 30, height = 12): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({ left, top, width, height }),
  } as DOMRect;
}

export function getSuggestionMenuRoots(doc: Document = document): ParentNode[] {
  const seen = new Set<ParentNode>();
  const collectManagedElements = (root: ParentNode): HTMLElement[] => [
    ...Array.from(root.querySelectorAll<HTMLElement>('[data-suggestion="true"]')),
    ...Array.from(root.querySelectorAll<HTMLElement>("*")).flatMap((element) =>
      element.shadowRoot ? collectManagedElements(element.shadowRoot) : [],
    ),
  ];

  return collectManagedElements(doc)
    .map((element) => element.getAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR))
    .filter((entryId): entryId is string => typeof entryId === "string" && entryId.length > 0)
    .map((entryId) => doc.getElementById(SuggestionMenuView.resolveHostId(entryId)))
    .filter((menu): menu is HTMLElement => menu instanceof HTMLElement)
    .map((container) => container.shadowRoot ?? container)
    .filter((root) => {
      if (seen.has(root)) {
        return false;
      }
      seen.add(root);
      return true;
    });
}

export function querySuggestionMenuItems(doc: Document = document): HTMLLIElement[] {
  return getSuggestionMenuRoots(doc).flatMap(
    (root) => Array.from(root.querySelectorAll("li[data-index]")) as HTMLLIElement[],
  );
}

export function querySuggestionMenuItemByIndex(
  index: number,
  doc: Document = document,
): HTMLLIElement | null {
  return (
    getSuggestionMenuRoots(doc)
      .map((root) => root.querySelector(`li[data-index="${index}"]`) as HTMLLIElement | null)
      .find((item) => item !== null) ?? null
  );
}
