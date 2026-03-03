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
  | (HTMLElement & { suggestionMenu?: HTMLElement | null });

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
      this.displayLangHeader && context.lang
        ? `Lang: ${SUPPORTED_LANGUAGES[context.lang]}`
        : null;

    if (this.inlineSuggestionEnabled) {
      entry.inlineSuggestion = entry.suggestions[0] ?? null;
      this.hideMenu(entry);
    } else {
      entry.inlineSuggestion = null;
      this.renderMenu(entry);
    }

    if (entry.pendingInlineAccept) {
      entry.pendingInlineAccept = false;
      const suggested = entry.inlineSuggestion ?? entry.suggestions[0] ?? null;
      if (suggested) {
        this.acceptSuggestion(entry, suggested, new KeyboardEvent("keydown", { key: "Tab" }));
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
        click: () => undefined,
        menuMouseDown: () => undefined,
        menuClick: () => undefined,
      },
    };

    entry.handlers.input = this.onElementInput.bind(this, id);
    entry.handlers.keydown = this.onElementKeyDown.bind(this, id);
    entry.handlers.focus = this.onElementFocus.bind(this, id);
    entry.handlers.click = this.onElementFocus.bind(this, id);
    entry.handlers.menuMouseDown = (event) => {
      event.preventDefault();
    };
    entry.handlers.menuClick = this.onMenuClick.bind(this, id);

    elem.addEventListener("input", entry.handlers.input, true);
    elem.addEventListener("keydown", entry.handlers.keydown, true);
    elem.addEventListener("focus", entry.handlers.focus, true);
    elem.addEventListener("click", entry.handlers.click, true);
    menu.addEventListener("mousedown", entry.handlers.menuMouseDown);
    menu.addEventListener("click", entry.handlers.menuClick);

    elem.setAttribute("data-suggestion", "true");
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
    entry.elem.removeEventListener("click", entry.handlers.click, true);

    entry.menu.removeEventListener("mousedown", entry.handlers.menuMouseDown);
    entry.menu.removeEventListener("click", entry.handlers.menuClick);
    entry.menu.remove();
    if (entry.pendingRequestTimer !== null) {
      clearTimeout(entry.pendingRequestTimer);
      entry.pendingRequestTimer = null;
    }

    delete entry.elem.suggestionMenu;
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
  }

  private onElementInput(id: number): void {
    this.activeEntryId = id;
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    entry.latestMentionText = this.findMentionToken(snapshot.beforeCursor).token;
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
      li.textContent = suggestion;
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

    this.positionMenu(entry);
    entry.menu.style.display = "block";
  }

  private positionMenu(entry: Entry): void {
    const rect = entry.elem.getBoundingClientRect();
    const top = window.scrollY + rect.bottom + 4;
    const left = window.scrollX + rect.left;

    entry.menu.style.position = "absolute";
    entry.menu.style.top = `${Math.max(0, top)}px`;
    entry.menu.style.left = `${Math.max(0, left)}px`;
    entry.menu.style.minWidth = `${Math.max(180, rect.width)}px`;
    entry.menu.style.maxWidth = "420px";
    entry.menu.style.maxHeight = "280px";
    entry.menu.style.overflowY = "auto";
    entry.menu.style.zIndex = "2147483647";
  }

  private hideMenu(entry: Entry): void {
    entry.menu.style.display = "none";
    entry.list.innerHTML = "";
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

    this.acceptSuggestionAtIndex(entry, index, event);
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

    if (key === "Backspace" && this.revertOnBackspace && this.tryRevertLastReplacement(entry, keyboardEvent)) {
      return;
    }

    if (this.inlineSuggestionEnabled && key === "Tab") {
      if (entry.inlineSuggestion) {
        this.consumeKeyboardEvent(keyboardEvent);
        this.acceptSuggestion(entry, entry.inlineSuggestion, keyboardEvent);
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
        this.acceptSuggestionAtIndex(entry, digitIndex, keyboardEvent);
        return;
      }
    }

    if (key === "Tab" && this.autocompleteOnTab) {
      this.consumeKeyboardEvent(keyboardEvent);
      this.acceptSuggestionAtIndex(entry, entry.selectedIndex, keyboardEvent);
      return;
    }

    if (key === "Enter" && this.autocompleteOnEnter) {
      this.consumeKeyboardEvent(keyboardEvent);
      this.acceptSuggestionAtIndex(entry, entry.selectedIndex, keyboardEvent);
      return;
    }

    if (key === " " && this.autocompleteOnSpace) {
      this.consumeKeyboardEvent(keyboardEvent);
      this.acceptSuggestionAtIndex(entry, entry.selectedIndex, keyboardEvent);
    }
  }

  private isMenuVisible(entry: Entry): boolean {
    return entry.menu.style.display !== "none" && entry.suggestions.length > 0;
  }

  private moveSelection(entry: Entry, direction: number): void {
    if (entry.suggestions.length === 0) {
      return;
    }

    const next = (entry.selectedIndex + direction + entry.suggestions.length) % entry.suggestions.length;
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

  private acceptSuggestionAtIndex(entry: Entry, index: number, event: Event): void {
    const suggestion = entry.suggestions[index];
    if (!suggestion) {
      return;
    }

    this.acceptSuggestion(entry, suggestion, event);
  }

  private acceptSuggestion(entry: Entry, suggestion: string, event: Event): void {
    let snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const tokenInfo = this.findMentionToken(snapshot.beforeCursor);
    let triggerText = tokenInfo.token || entry.latestMentionText;

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

    if (
      !this.isTextValueElement(entry.elem) &&
      this.tryApplyCkEditorBackwardReplacement(entry.elem, triggerText.length, suggestion)
    ) {
      this.dispatchInputEvent(entry.elem);
      const updatedSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
      entry.lastReplacement = {
        triggerText,
        insertedText: suggestion,
        cursorAfter: updatedSnapshot.cursorOffset,
      };
      this.finishAcceptedSuggestion(entry, triggerText, suggestion, event);
      return;
    }

    const currentFullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceEnd = snapshot.beforeCursor.length;
    const replaceStart = Math.max(0, replaceEnd - triggerText.length);
    const cursorAfter = replaceStart + suggestion.length;

    this.replaceTextByOffsets(entry.elem, currentFullText, replaceStart, replaceEnd, suggestion, cursorAfter);
    this.dispatchInputEvent(entry.elem);

    entry.lastReplacement = {
      triggerText,
      insertedText: suggestion,
      cursorAfter,
    };

    this.finishAcceptedSuggestion(entry, triggerText, suggestion, event);
  }

  private finishAcceptedSuggestion(
    entry: Entry,
    triggerText: string,
    insertedText: string,
    _event: Event,
  ): void {
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

    this.replaceTextByOffsets(entry.elem, fullText, replaceStart, replaceEnd, triggerText, nextCursor);
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

    const replaceStart = Math.max(0, Math.min(fullText.length, evaluatedLength - replaceBackwardCount));
    const replaceEnd = Math.max(replaceStart, Math.min(fullText.length, replaceStart + replaceBackwardCount));

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

    if (!this.isTextValueElement(entry.elem) && entry.elem.classList.contains("ck-editor__editable")) {
      const applied = this.tryApplyCkEditorBackwardReplacement(
        entry.elem,
        replaceBackwardCount,
        textEdit.replacementText,
        replaceEnd,
      );
      if (applied) {
        this.dispatchInputEvent(entry.elem);
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
      (spacingRule.spaceBefore === Spacing.REMOVE_SPACE || spacingRule.spaceBefore === Spacing.NO_CHANGE)
    ) {
      return;
    }

    this.consumeKeyboardEvent(event);

    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceStart = snapshot.beforeCursor.length;
    const replaceEnd = replaceStart;
    const replacementText = `\xA0${key}`;
    const cursorAfter = replaceStart + replacementText.length;

    this.replaceTextByOffsets(entry.elem, fullText, replaceStart, replaceEnd, replacementText, cursorAfter);
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

    elem.textContent = updatedText;
    this.setContentEditableCaret(elem, cursorAfter);
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

  private tryApplyCkEditorBackwardReplacement(
    elem: HTMLElement,
    deleteCount: number,
    insertText: string,
    cursorOffset?: number,
  ): boolean {
    if (!elem.classList.contains("ck-editor__editable")) {
      return false;
    }

    const beforeText = elem.textContent ?? "";

    elem.focus();
    this.setContentEditableCaret(elem, cursorOffset ?? beforeText.length);

    const dispatchInputSequence = (inputType: string, data: string | null): void => {
      const beforeEvent = new InputEvent("beforeinput", {
        inputType,
        data: data ?? undefined,
        bubbles: true,
        cancelable: true,
      });
      elem.dispatchEvent(beforeEvent);

      const inputEvent = new InputEvent("input", {
        inputType,
        data: data ?? undefined,
        bubbles: true,
      });
      elem.dispatchEvent(inputEvent);
    };

    for (let i = 0; i < deleteCount; i += 1) {
      dispatchInputSequence("deleteContentBackward", null);
    }
    dispatchInputSequence("insertText", insertText);

    this.setContentEditableCaret(elem, (elem.textContent ?? "").length);
    return (elem.textContent ?? "") !== beforeText;
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
