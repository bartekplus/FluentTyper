import { isInDocument } from "@core/application/dom-utils";
import { createLogger } from "@core/application/logging/Logger";
import { CMD_CONTENT_SCRIPT_USAGE_EVENT } from "@core/domain/constants";
import { LANG_SEPARATOR_CHARS_REGEX, SUPPORTED_LANGUAGES } from "@core/domain/lang";
import type {
  ContentScriptPredictRequestContext,
  ContentScriptUsageEventMessage,
  PredictResponseContext,
  TextEditOperation,
} from "@core/domain/messageTypes";
import { SPACING_RULES, Spacing } from "@core/domain/spacingRules";
import { InlineSuggestionView } from "./suggestions/InlineSuggestionView";
import { SuggestionMenuView } from "./suggestions/SuggestionMenuView";
import { TextTargetAdapter, type TextTarget } from "./suggestions/TextTargetAdapter";

const logger = createLogger("SuggestionManager");

type SuggestionElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | (HTMLElement & {
      tributeMenu?: HTMLElement | null;
      suggestionMenu?: HTMLElement | null;
    });

interface SuggestionManagerOptions {
  selectors: string;
  minWordLengthToPredict: number;
  autocomplete: boolean;
  autocompleteOnEnter: boolean;
  autocompleteOnTab: boolean;
  lang: string;
  selectByDigit: boolean;
  revertOnBackspace: boolean;
  displayLangHeader: boolean;
  inline_suggestion: boolean;
  getPrediction: (context: ContentScriptPredictRequestContext) => void;
}

interface ReplacementSnapshot {
  triggerText: string;
  insertedText: string;
  cursorAfter: number;
}

interface ContentEditableTextPosition {
  node: Text;
  offset: number;
}

interface MenuDimensions {
  width: number;
  height: number;
}

interface MenuCoordinates {
  position: "fixed";
  left: number | "auto";
  top: number | "auto";
  right?: number;
  bottom?: number;
  maxHeight?: number;
  maxWidth?: number;
}

interface Entry {
  id: number;
  elem: SuggestionElement;
  menu: HTMLDivElement;
  list: HTMLUListElement;
  requestId: number;
  suggestions: string[];
  selectedIndex: number;
  menuHeader: string | null;
  latestMentionText: string;
  inlineSuggestion: string | null;
  pendingInlineAccept: boolean;
  missingTrailingSpace: boolean;
  expectedCursorPos: number;
  lastReplacement: ReplacementSnapshot | null;
  pendingRequestTimer: ReturnType<typeof setTimeout> | null;
  handlers: {
    input: EventListener;
    keydown: EventListener;
    focus: EventListener;
    blur: EventListener;
    click: EventListener;
    menuMouseDown: EventListener;
    menuClick: EventListener;
  };
}

export class SuggestionManager {
  private static readonly REQUEST_DEBOUNCE_MS = 120;

  private readonly selectors: string;
  private readonly getPrediction: (context: ContentScriptPredictRequestContext) => void;

  private minWordLengthToPredict: number;
  private autocompleteOnSpace: boolean;
  private autocompleteOnEnter: boolean;
  private autocompleteOnTab: boolean;
  private selectByDigit: boolean;
  private revertOnBackspace: boolean;
  private displayLangHeader: boolean;
  private inlineSuggestionEnabled: boolean;

  private lang: string;
  private separatorRegex: RegExp;

  private nextEntryId = 1;
  private entries = new Map<number, Entry>();
  private entryIdByElement = new WeakMap<Element, number>();
  private activeEntryId: number | null = null;

  constructor(options: SuggestionManagerOptions) {
    this.selectors = options.selectors;
    this.getPrediction = options.getPrediction;

    this.minWordLengthToPredict = options.minWordLengthToPredict;
    this.autocompleteOnSpace = options.autocomplete;
    this.autocompleteOnEnter = options.autocompleteOnEnter;
    this.autocompleteOnTab = options.autocompleteOnTab;
    this.selectByDigit = options.selectByDigit;
    this.revertOnBackspace = options.revertOnBackspace;
    this.displayLangHeader = options.displayLangHeader;
    this.inlineSuggestionEnabled = options.inline_suggestion;

    this.lang = options.lang;
    this.separatorRegex = LANG_SEPARATOR_CHARS_REGEX[this.lang] || /\s+/;
  }

  public fulfillPrediction(context: PredictResponseContext): void {
    const entry = this.entries.get(context.suggestionId);
    if (!entry) {
      return;
    }

    const isCurrentRequest = entry.requestId === context.requestId;
    const hasTextEdit = context.textEdit != null;

    if (!isCurrentRequest && !hasTextEdit) {
      return;
    }

    if (context.textEdit) {
      this.applyTextEdit(entry, context.textEdit);
    }

    if (!isCurrentRequest) {
      return;
    }

    entry.suggestions = Array.isArray(context.predictions) ? context.predictions.slice() : [];
    entry.selectedIndex = 0;
    entry.menuHeader =
      this.displayLangHeader && context.lang ? `Lang: ${SUPPORTED_LANGUAGES[context.lang]}` : null;

    if (this.inlineSuggestionEnabled) {
      entry.inlineSuggestion = entry.suggestions[0] ?? null;
      this.hideMenu(entry);
      this.renderInlineSuggestion(entry);
    } else {
      entry.inlineSuggestion = null;
      InlineSuggestionView.removeAll(document);
      this.renderMenu(entry);
    }

    if (entry.pendingInlineAccept) {
      entry.pendingInlineAccept = false;
      const suggested = entry.inlineSuggestion ?? entry.suggestions[0] ?? null;
      if (suggested) {
        this.acceptSuggestion(entry, suggested);
      }
    }

    if (entry.suggestions.length > 0) {
      this.emitUsageEvent({
        eventType: "suggestion_shown",
        suggestionCount: entry.suggestions.length,
        language: context.lang,
      });
    }
  }

  public detachAllHelpers(): void {
    for (const id of [...this.entries.keys()]) {
      this.detachHelper(id);
    }
    this.entries.clear();
    this.entryIdByElement = new WeakMap<Element, number>();
    this.activeEntryId = null;
  }

  public removeHelpersNotInDocument(): void {
    for (const [id, entry] of this.entries) {
      if (!isInDocument(entry.elem) || !this.isEligibleElement(entry.elem)) {
        this.detachHelper(id);
      }
    }
  }

  public queryAndAttachHelper(root?: Element): void {
    const candidates = this.queryCandidates(root);

    for (const candidate of candidates) {
      if (this.isHelperAttached(candidate)) {
        continue;
      }

      let shouldSkip = false;
      for (const [existingId, existing] of this.entries) {
        if (candidate.contains(existing.elem)) {
          this.detachHelper(existingId);
          continue;
        }
        if (existing.elem.contains(candidate)) {
          shouldSkip = true;
          break;
        }
      }

      if (!shouldSkip) {
        this.attachHelper(candidate);
      }
    }
  }

  public triggerActiveSuggestion(): void {
    const entry = this.getActiveEntry();
    if (!entry) {
      return;
    }
    this.schedulePrediction(entry, true);
  }

  public updateLangConfig(lang: string): void {
    this.lang = lang;
    this.separatorRegex = LANG_SEPARATOR_CHARS_REGEX[lang] || /\s+/;
    this.triggerActiveSuggestion();
  }

  private queryCandidates(root?: Element): SuggestionElement[] {
    const elements = root
      ? root.matches(this.selectors)
        ? [root]
        : Array.from(root.querySelectorAll(this.selectors))
      : Array.from(document.querySelectorAll(this.selectors));

    return elements.filter((elem): elem is SuggestionElement => this.isEligibleElement(elem));
  }

  private isEligibleElement(elem: Element): elem is SuggestionElement {
    if (!(elem instanceof HTMLElement)) {
      return false;
    }
    if (!this.isVisiblyInteractive(elem)) {
      return false;
    }

    if (this.isTextAreaElement(elem)) {
      return true;
    }

    if (this.isInputElement(elem)) {
      const inputType = (elem.type || "text").toLowerCase();
      if (!["text", "search", ""].includes(inputType)) {
        return false;
      }
      const blocked = `${elem.name} ${elem.id}`.toLowerCase();
      return !blocked.includes("password") && !blocked.includes("username");
    }

    return elem.isContentEditable;
  }

  private isVisiblyInteractive(elem: HTMLElement): boolean {
    const style = window.getComputedStyle(elem);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  private isHelperAttached(elem: Element): boolean {
    const id = this.entryIdByElement.get(elem);
    if (typeof id !== "number") {
      return false;
    }
    const entry = this.entries.get(id);
    return Boolean(entry && entry.elem === elem);
  }

  private attachHelper(elem: SuggestionElement): void {
    const id = this.nextEntryId;
    this.nextEntryId += 1;

    const menu = SuggestionMenuView.ensureMenu(document.body);
    const list = menu.querySelector("ul") as HTMLUListElement;

    const entry: Entry = {
      id,
      elem,
      menu,
      list,
      requestId: 0,
      suggestions: [],
      selectedIndex: 0,
      menuHeader: null,
      latestMentionText: "",
      inlineSuggestion: null,
      pendingInlineAccept: false,
      missingTrailingSpace: false,
      expectedCursorPos: 0,
      lastReplacement: null,
      pendingRequestTimer: null,
      handlers: {
        input: () => undefined,
        keydown: () => undefined,
        focus: () => undefined,
        blur: () => undefined,
        click: () => undefined,
        menuMouseDown: () => undefined,
        menuClick: () => undefined,
      },
    };

    entry.handlers.input = this.onElementInput.bind(this, id);
    entry.handlers.keydown = this.onElementKeyDown.bind(this, id);
    entry.handlers.focus = this.onElementFocus.bind(this, id);
    entry.handlers.blur = this.onElementBlur.bind(this, id);
    entry.handlers.click = this.onElementFocus.bind(this, id);
    entry.handlers.menuMouseDown = (event) => {
      event.preventDefault();
    };
    entry.handlers.menuClick = this.onMenuClick.bind(this, id);

    elem.addEventListener("input", entry.handlers.input, true);
    elem.addEventListener("keydown", entry.handlers.keydown, true);
    elem.addEventListener("focus", entry.handlers.focus, true);
    elem.addEventListener("blur", entry.handlers.blur, true);
    elem.addEventListener("click", entry.handlers.click, true);
    menu.addEventListener("mousedown", entry.handlers.menuMouseDown);
    menu.addEventListener("click", entry.handlers.menuClick);
    this.syncMenuTypography(menu, elem);

    elem.setAttribute("data-tribute", "true");
    elem.setAttribute("data-suggestion", "true");
    elem.tributeMenu = menu;
    elem.suggestionMenu = menu;

    this.entries.set(id, entry);
    this.entryIdByElement.set(elem, id);
  }

  private detachHelper(id: number): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }

    entry.elem.removeEventListener("input", entry.handlers.input, true);
    entry.elem.removeEventListener("keydown", entry.handlers.keydown, true);
    entry.elem.removeEventListener("focus", entry.handlers.focus, true);
    entry.elem.removeEventListener("blur", entry.handlers.blur, true);
    entry.elem.removeEventListener("click", entry.handlers.click, true);

    entry.menu.removeEventListener("mousedown", entry.handlers.menuMouseDown);
    entry.menu.removeEventListener("click", entry.handlers.menuClick);
    entry.menu.remove();
    if (entry.pendingRequestTimer !== null) {
      clearTimeout(entry.pendingRequestTimer);
      entry.pendingRequestTimer = null;
    }

    delete entry.elem.tributeMenu;
    delete entry.elem.suggestionMenu;
    entry.elem.removeAttribute("data-tribute");
    entry.elem.removeAttribute("data-suggestion");

    this.entries.delete(id);
    this.entryIdByElement.delete(entry.elem);

    if (this.activeEntryId === id) {
      this.activeEntryId = null;
    }

    InlineSuggestionView.removeAll(document);
  }

  private getActiveEntry(): Entry | null {
    if (this.activeEntryId !== null) {
      const known = this.entries.get(this.activeEntryId);
      if (known && document.activeElement === known.elem) {
        return known;
      }
    }

    const active = document.activeElement;
    if (!active) {
      return null;
    }
    const id = this.entryIdByElement.get(active);
    if (typeof id !== "number") {
      return null;
    }
    const entry = this.entries.get(id) ?? null;
    if (entry) {
      this.activeEntryId = id;
    }
    return entry;
  }

  private onElementFocus(id: number): void {
    this.activeEntryId = id;
    const entry = this.entries.get(id);
    if (!entry || !this.inlineSuggestionEnabled) {
      return;
    }
    this.renderInlineSuggestion(entry);
  }

  private onElementBlur(id: number): void {
    if (this.activeEntryId === id) {
      this.activeEntryId = null;
    }
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    this.clearSuggestions(entry);
  }

  private onElementInput(id: number): void {
    this.activeEntryId = id;
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    entry.latestMentionText = this.findMentionToken(snapshot.beforeCursor).token;
    if (this.inlineSuggestionEnabled) {
      this.renderInlineSuggestion(entry);
    }
    this.schedulePrediction(entry, false);
  }

  private schedulePrediction(entry: Entry, force: boolean): void {
    if (entry.pendingRequestTimer !== null) {
      clearTimeout(entry.pendingRequestTimer);
      entry.pendingRequestTimer = null;
    }

    if (force) {
      this.requestPrediction(entry, true);
      return;
    }

    entry.pendingRequestTimer = setTimeout(() => {
      entry.pendingRequestTimer = null;
      this.requestPrediction(entry, false);
    }, SuggestionManager.REQUEST_DEBOUNCE_MS);
  }

  private requestPrediction(entry: Entry, force: boolean): void {
    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const beforeCursor = snapshot.beforeCursor;

    const shouldPredict = this.shouldPredict(beforeCursor);
    const shouldRequestForGrammar = this.shouldRequestGrammarEdit(beforeCursor);
    if (!force && !shouldPredict && !shouldRequestForGrammar) {
      this.clearSuggestions(entry);
      return;
    }
    if (!shouldPredict) {
      this.clearSuggestions(entry);
    }

    const tokenInfo = this.findMentionToken(beforeCursor);
    entry.latestMentionText = tokenInfo.token;
    entry.requestId += 1;

    this.getPrediction({
      text: beforeCursor,
      nextChar: snapshot.afterCursor.charAt(0) || "",
      suggestionId: entry.id,
      requestId: entry.requestId,
      lang: this.lang,
    });
  }

  private shouldRequestGrammarEdit(beforeCursor: string): boolean {
    if (beforeCursor.length === 0) {
      return false;
    }
    const lastChar = beforeCursor.charAt(beforeCursor.length - 1);
    return this.isSeparator(lastChar);
  }

  private shouldPredict(beforeCursor: string): boolean {
    if (this.minWordLengthToPredict === -1) {
      return false;
    }

    const lastChar = beforeCursor.charAt(beforeCursor.length - 1) || "";
    if (lastChar && this.isSeparator(lastChar)) {
      return this.minWordLengthToPredict === 0;
    }

    const token = this.findMentionToken(beforeCursor).token;
    return token.length >= this.minWordLengthToPredict;
  }

  private isSeparator(value: string): boolean {
    if (this.separatorRegex.global || this.separatorRegex.sticky) {
      this.separatorRegex.lastIndex = 0;
    }
    return this.separatorRegex.test(value);
  }

  private findMentionToken(beforeCursor: string): { token: string; start: number } {
    let start = beforeCursor.length;
    while (start > 0) {
      const current = beforeCursor.charAt(start - 1);
      if (this.isSeparator(current)) {
        break;
      }
      start -= 1;
    }
    return { token: beforeCursor.slice(start), start };
  }

  private renderMenu(entry: Entry): void {
    entry.list.innerHTML = "";

    if (entry.menuHeader) {
      const header = document.createElement("lh");
      header.textContent = entry.menuHeader;
      entry.list.appendChild(header);
    }

    entry.suggestions.forEach((suggestion, index) => {
      const li = document.createElement("li");
      li.innerHTML = this.buildSuggestionMenuItemHtml(entry.latestMentionText, suggestion);
      li.setAttribute("data-index", String(index));
      if (index === entry.selectedIndex) {
        li.classList.add("highlight");
      }
      entry.list.appendChild(li);
    });

    if (entry.suggestions.length === 0) {
      this.hideMenu(entry);
      return;
    }

    this.syncMenuTypography(entry.menu, entry.elem);
    this.positionMenu(entry);
    entry.menu.style.display = "block";
  }

  private positionMenu(entry: Entry): void {
    const rect = this.getCaretRect(entry);
    if (!rect) {
      this.hideMenu(entry);
      return;
    }

    const coordinates = this.getMenuCoordinatesForRect(entry.menu, rect);

    entry.menu.style.position = coordinates.position;
    entry.menu.style.top =
      coordinates.top === "auto" ? "auto" : `${Math.max(0, coordinates.top)}px`;
    entry.menu.style.left =
      coordinates.left === "auto" ? "auto" : `${Math.max(0, coordinates.left)}px`;
    entry.menu.style.right =
      typeof coordinates.right === "number" ? `${Math.max(0, coordinates.right)}px` : "auto";
    entry.menu.style.bottom =
      typeof coordinates.bottom === "number" ? `${Math.max(0, coordinates.bottom)}px` : "auto";
    entry.menu.style.maxHeight = `${Math.max(0, coordinates.maxHeight ?? 500)}px`;
    entry.menu.style.maxWidth = `${Math.max(0, coordinates.maxWidth ?? 300)}px`;
    entry.menu.style.zIndex = "2147483647";
  }

  private syncMenuTypography(menu: HTMLDivElement, elem: SuggestionElement): void {
    const properties: Array<keyof CSSStyleDeclaration> = [
      "fontStyle",
      "fontVariant",
      "fontWeight",
      "fontStretch",
      "fontSizeAdjust",
      "fontFamily",
    ];
    const computed = window.getComputedStyle(elem);

    menu.style.fontSize = `${Math.round((Number.parseInt(computed.fontSize, 10) || 16) * 0.9)}px`;
    for (const property of properties) {
      const value = computed[property];
      if (typeof value === "string") {
        menu.style[property] = value;
      }
    }
  }

  private getCaretRect(entry: Entry): DOMRect | null {
    if (this.isTextValueElement(entry.elem)) {
      return this.getTextValueCaretRect(entry.elem);
    }
    return this.getContentEditableCaretRect(entry.elem);
  }

  private getTextValueCaretRect(elem: HTMLInputElement | HTMLTextAreaElement): DOMRect | null {
    const position = elem.selectionStart ?? elem.value.length;
    const properties = [
      "direction",
      "boxSizing",
      "width",
      "height",
      "overflowX",
      "overflowY",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "borderStyle",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "fontStyle",
      "fontVariant",
      "fontWeight",
      "fontStretch",
      "fontSize",
      "fontSizeAdjust",
      "lineHeight",
      "fontFamily",
      "textAlign",
      "textTransform",
      "textIndent",
      "textDecoration",
      "letterSpacing",
      "wordSpacing",
    ] as const;

    const mirror = document.createElement("div");
    mirror.style.whiteSpace = "pre-wrap";
    if (elem.nodeName !== "INPUT") {
      mirror.style.wordWrap = "break-word";
    }
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.id = "input-textarea-caret-position-mirror-div";
    document.body.appendChild(mirror);

    const computed = window.getComputedStyle(elem);
    for (const property of properties) {
      mirror.style[property] = computed[property];
    }

    const beforeSpan = document.createElement("span");
    beforeSpan.textContent = elem.value.substring(0, position);
    mirror.appendChild(beforeSpan);

    if (elem.nodeName === "INPUT") {
      mirror.textContent = mirror.textContent.replace(/\s/g, "\xA0");
    }

    const caretSpan = document.createElement("span");
    mirror.appendChild(caretSpan);

    const nextCharSpan = document.createElement("span");
    nextCharSpan.textContent = elem.value.substring(position, position + 1);
    mirror.appendChild(nextCharSpan);

    const elementRect = elem.getBoundingClientRect();
    mirror.style.position = "fixed";
    mirror.style.left = `${elementRect.left}px`;
    mirror.style.top = `${elementRect.top}px`;
    mirror.style.width = `${elementRect.width}px`;
    mirror.style.height = `${elementRect.height}px`;
    mirror.scrollTop = elem.scrollTop;

    const caretRect = caretSpan.getBoundingClientRect();
    const nextCharRect = nextCharSpan.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    const fontSize = Number.parseFloat(computed.fontSize) || 0;
    let lineHeight = Number.parseFloat(computed.lineHeight);
    if (!lineHeight || Number.isNaN(lineHeight)) {
      lineHeight = fontSize ? fontSize * 1.2 : 0;
    }

    const fallbackHeight = lineHeight || fontSize || mirrorRect.height;
    const glyphRect =
      nextCharSpan.textContent && nextCharRect.height > 0 ? nextCharRect : caretRect;
    const glyphHeight = glyphRect.height || fallbackHeight;
    const lineBoxHeight = Math.max(glyphHeight, fallbackHeight);
    const extraLeading = Math.max(0, lineBoxHeight - glyphHeight);
    const lineBoxTop = glyphRect.top - extraLeading / 2;

    document.body.removeChild(mirror);

    const clamp = (value: number, min: number, max: number): number =>
      Math.max(min, Math.min(value, max));

    return this.createRect(
      clamp(caretRect.left, mirrorRect.left, mirrorRect.left + mirrorRect.width),
      clamp(lineBoxTop, mirrorRect.top, mirrorRect.top + mirrorRect.height),
      0,
      Math.min(mirrorRect.height, lineBoxHeight),
    );
  }

  private getContentEditableCaretRect(elem: HTMLElement): DOMRect | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return elem.getBoundingClientRect();
    }

    const range = selection.getRangeAt(0).cloneRange();
    const getRangeRect = (value: Range): DOMRect | null => {
      if (typeof value.getBoundingClientRect !== "function") {
        return null;
      }
      return value.getBoundingClientRect();
    };
    let rect = getRangeRect(range);

    if ((!rect || rect.height === 0) && selection.anchorNode) {
      const marker = document.createElement("span");
      marker.textContent = "\u200b";
      range.insertNode(marker);
      rect = marker.getBoundingClientRect();
      marker.parentNode?.removeChild(marker);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    if (!rect) {
      return elem.getBoundingClientRect();
    }

    const parent =
      selection.anchorNode?.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement
        : (selection.anchorNode as Element | null);
    if (!parent) {
      return rect;
    }

    const parentRect = parent.getBoundingClientRect();
    const clamp = (value: number, min: number, max: number): number =>
      Math.max(min, Math.min(value, max));

    return this.createRect(
      clamp(rect.left, parentRect.left, parentRect.left + parentRect.width),
      clamp(rect.top, parentRect.top, parentRect.top + parentRect.height),
      0,
      Math.min(parentRect.height, rect.height),
    );
  }

  private getMenuCoordinatesForRect(menu: HTMLDivElement, rect: DOMRect): MenuCoordinates {
    const menuDimensions = this.getMenuDimensions(menu);
    const coordinates: MenuCoordinates = {
      position: "fixed",
      left: rect.left,
      top: rect.top + rect.height,
    };

    const availableSpaceOnTop = rect.top;
    const availableSpaceOnBottom = window.innerHeight - (rect.top + rect.height);

    if (availableSpaceOnBottom < menuDimensions.height) {
      if (
        availableSpaceOnTop >= menuDimensions.height ||
        availableSpaceOnTop > availableSpaceOnBottom
      ) {
        coordinates.top = "auto";
        coordinates.bottom = window.innerHeight - rect.top;
        if (availableSpaceOnBottom < menuDimensions.height) {
          coordinates.maxHeight = availableSpaceOnTop;
        }
      } else if (availableSpaceOnTop < menuDimensions.height) {
        coordinates.maxHeight = availableSpaceOnBottom;
      }
    }

    const availableSpaceOnLeft = rect.left;
    const availableSpaceOnRight = window.innerWidth - rect.left;

    if (availableSpaceOnRight < menuDimensions.width) {
      if (
        availableSpaceOnLeft >= menuDimensions.width ||
        availableSpaceOnLeft > availableSpaceOnRight
      ) {
        coordinates.left = "auto";
        coordinates.right = window.innerWidth - rect.left;
        if (availableSpaceOnRight < menuDimensions.width) {
          coordinates.maxWidth = availableSpaceOnLeft;
        }
      } else if (availableSpaceOnLeft < menuDimensions.width) {
        coordinates.maxWidth = availableSpaceOnRight;
      }
    }

    return coordinates;
  }

  private getMenuDimensions(menu: HTMLDivElement): MenuDimensions {
    menu.style.top = "0px";
    menu.style.left = "0px";
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    menu.style.position = "fixed";
    menu.style.visibility = "hidden";
    menu.style.display = "block";

    const dimensions: MenuDimensions = {
      width: menu.offsetWidth,
      height: menu.offsetHeight,
    };

    menu.style.display = "none";
    menu.style.visibility = "visible";

    return dimensions;
  }

  private createRect(left: number, top: number, width: number, height: number): DOMRect {
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

  private hideMenu(entry: Entry): void {
    entry.menu.style.display = "none";
    entry.list.innerHTML = "";
  }

  private renderInlineSuggestion(entry: Entry): void {
    if (!this.inlineSuggestionEnabled) {
      InlineSuggestionView.removeAll(document);
      return;
    }

    const suggestion = entry.inlineSuggestion;
    if (!suggestion) {
      InlineSuggestionView.removeAll(document);
      return;
    }

    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const mentionText =
      this.findMentionToken(snapshot.beforeCursor).token || entry.latestMentionText;
    if (!mentionText) {
      InlineSuggestionView.removeAll(document);
      return;
    }

    const lowerSuggestion = suggestion.toLowerCase();
    const lowerMention = mentionText.toLowerCase();
    if (!lowerSuggestion.startsWith(lowerMention)) {
      InlineSuggestionView.removeAll(document);
      return;
    }

    const suffix = suggestion.slice(mentionText.length);
    if (!suffix) {
      InlineSuggestionView.removeAll(document);
      return;
    }

    const caretRect = this.getCaretRect(entry);
    if (!caretRect) {
      InlineSuggestionView.removeAll(document);
      return;
    }

    InlineSuggestionView.render({
      target: entry.elem,
      text: suffix,
      caretRect,
      doc: document,
    });
  }

  private clearSuggestions(entry: Entry): void {
    entry.suggestions = [];
    entry.selectedIndex = 0;
    entry.inlineSuggestion = null;
    entry.pendingInlineAccept = false;
    this.hideMenu(entry);
    InlineSuggestionView.removeAll(document);
  }

  private onMenuClick(id: number, event: Event): void {
    this.activeEntryId = id;
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const item = target.closest("li");
    if (!item) {
      return;
    }

    const index = Number(item.getAttribute("data-index"));
    if (!Number.isInteger(index)) {
      return;
    }

    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }

    this.acceptSuggestionAtIndex(entry, index);
  }

  private onElementKeyDown(id: number, event: Event): void {
    this.activeEntryId = id;
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }

    const keyboardEvent = event as KeyboardEvent;
    this.handleMissingSpaceAfterAccept(entry, keyboardEvent);

    if (keyboardEvent.defaultPrevented) {
      return;
    }

    const key = keyboardEvent.key;

    if (
      key === "Backspace" &&
      this.revertOnBackspace &&
      this.tryRevertLastReplacement(entry, keyboardEvent)
    ) {
      return;
    }

    if (this.inlineSuggestionEnabled && key === "Tab") {
      if (entry.inlineSuggestion) {
        this.consumeKeyboardEvent(keyboardEvent);
        this.acceptSuggestion(entry, entry.inlineSuggestion);
        return;
      }

      if (entry.latestMentionText.length > 0) {
        this.consumeKeyboardEvent(keyboardEvent);
        entry.pendingInlineAccept = true;
        this.schedulePrediction(entry, true);
        return;
      }
    }

    if (key === "Escape") {
      this.clearSuggestions(entry);
      return;
    }

    if (!this.isMenuVisible(entry)) {
      return;
    }

    if (key === "ArrowDown") {
      this.consumeKeyboardEvent(keyboardEvent);
      this.moveSelection(entry, 1);
      return;
    }

    if (key === "ArrowUp") {
      this.consumeKeyboardEvent(keyboardEvent);
      this.moveSelection(entry, -1);
      return;
    }

    if (this.selectByDigit) {
      const digitIndex = this.mapDigitToIndex(key);
      if (digitIndex !== null && digitIndex < entry.suggestions.length) {
        this.consumeKeyboardEvent(keyboardEvent);
        this.acceptSuggestionAtIndex(entry, digitIndex);
        return;
      }
    }

    if (key === "Tab" && this.autocompleteOnTab) {
      this.consumeKeyboardEvent(keyboardEvent);
      this.acceptSuggestionAtIndex(entry, entry.selectedIndex);
      return;
    }

    if (key === "Enter" && this.autocompleteOnEnter) {
      this.consumeKeyboardEvent(keyboardEvent);
      this.acceptSuggestionAtIndex(entry, entry.selectedIndex);
      return;
    }

    if (key === " " && this.autocompleteOnSpace) {
      this.consumeKeyboardEvent(keyboardEvent);
      this.acceptSuggestionAtIndex(entry, entry.selectedIndex);
    }
  }

  private isMenuVisible(entry: Entry): boolean {
    return entry.menu.style.display !== "none" && entry.suggestions.length > 0;
  }

  private moveSelection(entry: Entry, direction: number): void {
    if (entry.suggestions.length === 0) {
      return;
    }

    const next =
      (entry.selectedIndex + direction + entry.suggestions.length) % entry.suggestions.length;
    entry.selectedIndex = next;

    const items = Array.from(entry.list.querySelectorAll("li"));
    items.forEach((item, index) => {
      if (index === entry.selectedIndex) {
        item.classList.add("highlight");
      } else {
        item.classList.remove("highlight");
      }
    });
  }

  private mapDigitToIndex(key: string): number | null {
    if (!/^\d$/.test(key)) {
      return null;
    }
    return key === "0" ? 9 : Number(key) - 1;
  }

  private buildSuggestionMenuItemHtml(mentionText: string, suggestion: string): string {
    const safeSuggestion = this.escapeHtml(suggestion);
    const mention = (mentionText || "").trim();
    if (!mention) {
      return safeSuggestion;
    }

    const lowerSuggestion = suggestion.toLowerCase();
    const lowerMention = mention.toLowerCase();
    const matchIndex = lowerSuggestion.indexOf(lowerMention);
    if (matchIndex < 0) {
      return safeSuggestion;
    }

    const before = this.escapeHtml(suggestion.slice(0, matchIndex));
    const match = this.escapeHtml(suggestion.slice(matchIndex, matchIndex + mention.length));
    const after = this.escapeHtml(suggestion.slice(matchIndex + mention.length));
    return `${before}<span>${match}</span>${after}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  private acceptSuggestionAtIndex(entry: Entry, index: number): void {
    const suggestion = entry.suggestions[index];
    if (!suggestion) {
      return;
    }

    this.acceptSuggestion(entry, suggestion);
  }

  private acceptSuggestion(entry: Entry, suggestion: string): void {
    let snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const tokenInfo = this.findMentionToken(snapshot.beforeCursor);
    const triggerText = tokenInfo.token || entry.latestMentionText;

    if (!this.isTextValueElement(entry.elem) && triggerText && snapshot.beforeCursor.length === 0) {
      const fullText = entry.elem.textContent ?? "";
      if (fullText.endsWith(triggerText)) {
        snapshot = {
          beforeCursor: fullText,
          afterCursor: "",
          cursorOffset: fullText.length,
        };
      }
    }

    const trailingTokenText = this.findTrailingToken(snapshot.afterCursor);
    const replacedTokenText = `${triggerText}${trailingTokenText}`;
    const currentFullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceEnd = snapshot.beforeCursor.length;
    const replaceStart = Math.max(0, replaceEnd - triggerText.length);
    const baseReplaceEnd = Math.min(currentFullText.length, replaceEnd + trailingTokenText.length);
    const extraWhitespaceToConsume = this.shouldConsumeFollowingSpace(
      suggestion,
      currentFullText.charAt(baseReplaceEnd),
    )
      ? 1
      : 0;
    const finalReplaceEnd = Math.min(
      currentFullText.length,
      baseReplaceEnd + extraWhitespaceToConsume,
    );
    const consumedTrailingWhitespace = currentFullText.slice(baseReplaceEnd, finalReplaceEnd);

    const cursorAfter = replaceStart + suggestion.length;

    this.replaceTextByOffsets(
      entry.elem,
      currentFullText,
      replaceStart,
      finalReplaceEnd,
      suggestion,
      cursorAfter,
    );
    this.dispatchInputEvent(entry.elem);

    entry.lastReplacement = {
      triggerText: `${replacedTokenText}${consumedTrailingWhitespace}`,
      insertedText: suggestion,
      cursorAfter,
    };

    this.finishAcceptedSuggestion(entry, triggerText, suggestion);
  }

  private findTrailingToken(afterCursor: string): string {
    let end = 0;
    while (end < afterCursor.length) {
      const current = afterCursor.charAt(end);
      if (this.isSeparator(current)) {
        break;
      }
      end += 1;
    }
    return afterCursor.slice(0, end);
  }

  private shouldConsumeFollowingSpace(insertedSuggestion: string, nextChar: string): boolean {
    if (!insertedSuggestion || !nextChar) {
      return false;
    }
    const endsWithSpace = /[ \xA0]$/.test(insertedSuggestion);
    const nextIsSpace = /[ \xA0]/.test(nextChar);
    return endsWithSpace && nextIsSpace;
  }

  private finishAcceptedSuggestion(entry: Entry, triggerText: string, insertedText: string): void {
    this.clearSuggestions(entry);

    entry.missingTrailingSpace = true;
    entry.expectedCursorPos = TextTargetAdapter.snapshot(entry.elem as TextTarget).cursorOffset;

    const typedTextLength = triggerText.length;
    const insertedTextLength = insertedText.length;

    this.emitUsageEvent({
      eventType: "suggestion_accepted",
      triggerText,
      typedTextLength,
      insertedTextLength,
      language: this.lang,
    });
    this.emitUsageEvent({
      eventType: "snippet_expanded",
      triggerText,
      typedTextLength,
      insertedTextLength,
      language: this.lang,
    });
    this.emitUsageEvent({
      eventType: "chars_inserted_from_snippet",
      amount: insertedTextLength,
      triggerText,
      language: this.lang,
    });
    this.emitUsageEvent({
      eventType: "chars_typed_for_trigger",
      amount: typedTextLength,
      triggerText,
      language: this.lang,
    });
  }

  private tryRevertLastReplacement(entry: Entry, event: KeyboardEvent): boolean {
    if (!entry.lastReplacement) {
      return false;
    }

    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const { triggerText, insertedText, cursorAfter } = entry.lastReplacement;

    if (snapshot.cursorOffset !== cursorAfter || !snapshot.beforeCursor.endsWith(insertedText)) {
      return false;
    }

    this.consumeKeyboardEvent(event);

    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceEnd = snapshot.beforeCursor.length;
    const replaceStart = Math.max(0, replaceEnd - insertedText.length);
    const nextCursor = replaceStart + triggerText.length;

    this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      triggerText,
      nextCursor,
    );
    this.dispatchInputEvent(entry.elem);

    entry.lastReplacement = null;
    this.clearSuggestions(entry);
    return true;
  }

  private applyTextEdit(entry: Entry, textEdit: TextEditOperation): void {
    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;

    const evaluatedLength = Number.isFinite(textEdit.evaluatedTextLength)
      ? Math.max(0, textEdit.evaluatedTextLength)
      : fullText.length;
    const replaceBackwardCount = Math.max(0, textEdit.replaceBackwardCount);

    const replaceStart = Math.max(
      0,
      Math.min(fullText.length, evaluatedLength - replaceBackwardCount),
    );
    const replaceEnd = Math.max(
      replaceStart,
      Math.min(fullText.length, replaceStart + replaceBackwardCount),
    );

    if (fullText.length > evaluatedLength && this.isTrailingSpaceEdit(textEdit)) {
      return;
    }

    if (textEdit.expectedReplacedText !== undefined) {
      const currentSubstring = fullText.slice(replaceStart, replaceEnd);
      if (currentSubstring !== textEdit.expectedReplacedText) {
        logger.debug("Skipping textEdit due to replaced text mismatch", {
          expected: textEdit.expectedReplacedText,
          actual: currentSubstring,
        });
        return;
      }
    }

    if (textEdit.expectedPrefixToken !== undefined) {
      const tokenStart = Math.max(0, replaceStart - textEdit.expectedPrefixToken.length);
      const actualToken = fullText.slice(tokenStart, replaceStart);
      if (actualToken !== textEdit.expectedPrefixToken) {
        logger.debug("Skipping textEdit due to prefix token mismatch", {
          expected: textEdit.expectedPrefixToken,
          actual: actualToken,
        });
        return;
      }
    }

    const cursorAfter = replaceStart + textEdit.replacementText.length;
    this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      textEdit.replacementText,
      cursorAfter,
    );
    this.dispatchInputEvent(entry.elem);
  }

  private isTrailingSpaceEdit(textEdit: TextEditOperation): boolean {
    if (typeof textEdit.replacementText !== "string") {
      return false;
    }
    return textEdit.replacementText.endsWith("\xA0");
  }

  private handleMissingSpaceAfterAccept(entry: Entry, event: KeyboardEvent): void {
    if (!entry.missingTrailingSpace) {
      return;
    }

    const key = event.key;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Escape"].includes(key)) {
      return;
    }

    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    if (snapshot.cursorOffset !== entry.expectedCursorPos || key.length > 1) {
      entry.missingTrailingSpace = false;
      return;
    }

    if (!(key.length === 1 && key.trim().length > 0)) {
      return;
    }

    entry.missingTrailingSpace = false;

    const charBeforeCursor = snapshot.beforeCursor.charAt(snapshot.beforeCursor.length - 1) || "";
    if (!charBeforeCursor || /\s/.test(charBeforeCursor)) {
      return;
    }

    const spacingRule = SPACING_RULES[key];
    if (
      spacingRule &&
      (spacingRule.spaceBefore === Spacing.REMOVE_SPACE ||
        spacingRule.spaceBefore === Spacing.NO_CHANGE)
    ) {
      return;
    }

    this.consumeKeyboardEvent(event);

    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceStart = snapshot.beforeCursor.length;
    const replaceEnd = replaceStart;
    const replacementText = `\xA0${key}`;
    const cursorAfter = replaceStart + replacementText.length;

    this.replaceTextByOffsets(
      entry.elem,
      fullText,
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
    );
    this.dispatchInputEvent(entry.elem);
  }

  private consumeKeyboardEvent(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  private replaceTextByOffsets(
    elem: SuggestionElement,
    fullText: string,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
  ): void {
    const boundedStart = Math.max(0, Math.min(fullText.length, replaceStart));
    const boundedEnd = Math.max(boundedStart, Math.min(fullText.length, replaceEnd));
    const updatedText = `${fullText.slice(0, boundedStart)}${replacementText}${fullText.slice(boundedEnd)}`;

    if (this.isTextValueElement(elem)) {
      elem.value = updatedText;
      elem.selectionStart = cursorAfter;
      elem.selectionEnd = cursorAfter;
      return;
    }

    this.replaceContentEditableTextByOffsets(
      elem,
      boundedStart,
      boundedEnd,
      replacementText,
      cursorAfter,
    );
  }

  private replaceContentEditableTextByOffsets(
    elem: HTMLElement,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
  ): void {
    const startPosition = this.resolveContentEditablePosition(elem, replaceStart);
    const endPosition = this.resolveContentEditablePosition(elem, replaceEnd);

    elem.focus();

    const range = document.createRange();
    range.setStart(startPosition.node, startPosition.offset);
    range.setEnd(endPosition.node, endPosition.offset);

    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    selection.removeAllRanges();
    selection.addRange(range);

    const beforeText = elem.textContent ?? "";
    this.dispatchContentEditableInputSequence(elem, range, replacementText);

    if ((elem.textContent ?? "") === beforeText) {
      range.deleteContents();
      if (replacementText.length > 0) {
        const replacementNode = document.createTextNode(replacementText);
        range.insertNode(replacementNode);
        replacementNode.parentNode?.normalize();
      }
    }

    this.setContentEditableCaret(elem, cursorAfter);
  }

  private dispatchContentEditableInputSequence(
    elem: HTMLElement,
    range: Range,
    replacementText: string,
  ): void {
    const beforeInputEvent = this.createContentEditableInputEvent("beforeinput", {
      inputType: "insertReplacementText",
      data: replacementText,
      cancelable: true,
      targetRange: range,
    });
    elem.dispatchEvent(beforeInputEvent);

    const inputEvent = this.createContentEditableInputEvent("input", {
      inputType: "insertReplacementText",
      data: replacementText,
      cancelable: false,
      targetRange: range,
    });
    elem.dispatchEvent(inputEvent);
  }

  private createContentEditableInputEvent(
    type: "beforeinput" | "input",
    {
      inputType,
      data,
      cancelable,
      targetRange,
    }: {
      inputType: string;
      data: string;
      cancelable: boolean;
      targetRange: Range;
    },
  ): Event {
    const staticRangeCtor = (globalThis as { StaticRange?: typeof StaticRange }).StaticRange;
    const targetRanges =
      typeof staticRangeCtor === "function"
        ? [
            new staticRangeCtor({
              startContainer: targetRange.startContainer,
              startOffset: targetRange.startOffset,
              endContainer: targetRange.endContainer,
              endOffset: targetRange.endOffset,
            }),
          ]
        : undefined;

    if (typeof InputEvent === "function") {
      const init = {
        bubbles: true,
        cancelable,
        inputType,
        data: data || undefined,
        targetRanges,
      } as unknown as InputEventInit;
      return new InputEvent(type, init);
    }

    const event = new Event(type, {
      bubbles: true,
      cancelable,
    }) as Event & { inputType?: string; data?: string };
    event.inputType = inputType;
    event.data = data;
    return event;
  }

  private setContentEditableCaret(elem: HTMLElement, cursorOffset: number): void {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const position = this.resolveContentEditablePosition(elem, cursorOffset);
    const range = document.createRange();
    range.setStart(position.node, position.offset);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
  }

  private resolveContentEditablePosition(
    elem: HTMLElement,
    targetOffset: number,
  ): ContentEditableTextPosition {
    const walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode() as Text | null;

    if (!current) {
      const textNode = document.createTextNode("");
      elem.appendChild(textNode);
      return { node: textNode, offset: 0 };
    }

    let remaining = Math.max(0, targetOffset);
    let lastNode = current;

    while (current) {
      lastNode = current;
      const length = current.textContent?.length ?? 0;
      if (remaining <= length) {
        return { node: current, offset: remaining };
      }
      remaining -= length;
      current = walker.nextNode() as Text | null;
    }

    return {
      node: lastNode,
      offset: lastNode.textContent?.length ?? 0,
    };
  }

  private dispatchInputEvent(elem: SuggestionElement): void {
    elem.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private isInputElement(elem: Element): elem is HTMLInputElement {
    return elem.tagName === "INPUT";
  }

  private isTextAreaElement(elem: Element): elem is HTMLTextAreaElement {
    return elem.tagName === "TEXTAREA";
  }

  private isTextValueElement(elem: Element): elem is HTMLInputElement | HTMLTextAreaElement {
    return this.isInputElement(elem) || this.isTextAreaElement(elem);
  }

  private emitUsageEvent(context: ContentScriptUsageEventMessage["context"]): void {
    const message: ContentScriptUsageEventMessage = {
      command: CMD_CONTENT_SCRIPT_USAGE_EVENT,
      context,
    };
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  }
}
