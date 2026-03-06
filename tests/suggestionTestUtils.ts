import type {
  SuggestionEntry,
  SuggestionElement,
} from "../src/adapters/chrome/content-script/suggestions/types";

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
    menu,
    list,
    requestId: overrides.requestId ?? 0,
    suggestions: overrides.suggestions ?? [],
    selectedIndex: overrides.selectedIndex ?? 0,
    menuHeader: overrides.menuHeader ?? null,
    latestMentionText: overrides.latestMentionText ?? "",
    latestMentionStart: overrides.latestMentionStart ?? 0,
    inlineSuggestion: overrides.inlineSuggestion ?? null,
    pendingInlineAccept: overrides.pendingInlineAccept ?? false,
    missingTrailingSpace: overrides.missingTrailingSpace ?? false,
    expectedCursorPos: overrides.expectedCursorPos ?? 0,
    pendingExtensionEdit: overrides.pendingExtensionEdit ?? null,
    manualAutoFixSuppression: overrides.manualAutoFixSuppression ?? null,
    isComposing: overrides.isComposing ?? false,
    lastKeydownKey: overrides.lastKeydownKey ?? null,
    lastInputAction: overrides.lastInputAction ?? null,
    lastBeforeCursorText: overrides.lastBeforeCursorText ?? null,
    pendingRequestTimer: overrides.pendingRequestTimer ?? null,
    handlers: overrides.handlers ?? {
      input: () => undefined,
      keydown: () => undefined,
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
