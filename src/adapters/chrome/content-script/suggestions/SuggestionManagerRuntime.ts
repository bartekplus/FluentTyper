import { isInDocument } from "@core/application/dom-utils";
import { LANG_SEPARATOR_CHARS_REGEX, SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { InlineSuggestionPresenter } from "./InlineSuggestionPresenter";
import { SuggestionElementDiscovery } from "./SuggestionElementDiscovery";
import { SuggestionEntryRegistry } from "./SuggestionEntryRegistry";
import { SuggestionKeyboardHandler } from "./SuggestionKeyboardHandler";
import { SuggestionLifecycleController } from "./SuggestionLifecycleController";
import { SuggestionMenuPresenter } from "./SuggestionMenuPresenter";
import { SuggestionPositioningService } from "./SuggestionPositioningService";
import { SuggestionPredictionCoordinator } from "./SuggestionPredictionCoordinator";
import { SuggestionMenuView } from "./SuggestionMenuView";
import { SuggestionTelemetryService } from "./SuggestionTelemetryService";
import { SuggestionTextEditService } from "./SuggestionTextEditService";
import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import type { PredictionInputAction } from "@core/domain/messageTypes";
import type {
  PredictionResponse,
  SuggestionElement,
  SuggestionEntry,
  SuggestionManagerOptions,
  SuggestionSnapshot,
  SuggestionTelemetry,
} from "./types";

export class SuggestionManagerRuntime {
  private readonly discovery: SuggestionElementDiscovery;
  private readonly entryRegistry = new SuggestionEntryRegistry();
  private readonly lifecycleController: SuggestionLifecycleController;
  private readonly positioningService = new SuggestionPositioningService();
  private readonly menuPresenter = new SuggestionMenuPresenter(this.positioningService);
  private readonly inlinePresenter = new InlineSuggestionPresenter({
    positioningService: this.positioningService,
  });
  private readonly predictionCoordinator: SuggestionPredictionCoordinator;
  private readonly textEditService: SuggestionTextEditService;
  private readonly keyboardHandler: SuggestionKeyboardHandler;
  private readonly telemetry: SuggestionTelemetry;
  private readonly pendingDeleteFallbackTimers = new Map<number, ReturnType<typeof setTimeout>>();

  private readonly displayLangHeader: boolean;
  private readonly inlineSuggestionEnabled: boolean;

  private lang: string;
  private separatorRegex: RegExp;

  private activeEntryId: number | null = null;

  constructor(options: SuggestionManagerOptions) {
    this.discovery = new SuggestionElementDiscovery({
      selectors: options.selectors,
      isStructurallyEligibleElement: this.isStructurallyEligibleElement.bind(this),
    });
    this.lifecycleController = new SuggestionLifecycleController({
      getEntries: () => this.entryRegistry.values(),
      dismissEntry: (entry) => this.dismissEntry(entry),
    });

    this.displayLangHeader = options.displayLangHeader;
    this.inlineSuggestionEnabled = options.inline_suggestion;

    this.lang = options.lang;
    this.separatorRegex = LANG_SEPARATOR_CHARS_REGEX[this.lang] || /\s+/;
    this.predictionCoordinator = new SuggestionPredictionCoordinator({
      debounceMs: 120,
      getPrediction: options.getPrediction,
      lang: this.lang,
      minWordLengthToPredict: options.minWordLengthToPredict,
      separatorRegex: this.separatorRegex,
      grammarRulesEnabled: Array.isArray(options.enabledGrammarRules)
        ? options.enabledGrammarRules.length > 0
        : false,
    });
    this.telemetry = options.telemetry ?? new SuggestionTelemetryService();
    this.textEditService = new SuggestionTextEditService({
      findMentionToken: this.findMentionToken.bind(this),
      isSeparator: this.isSeparator.bind(this),
    });
    this.keyboardHandler = new SuggestionKeyboardHandler({
      autocompleteOnSpace: options.autocomplete,
      autocompleteOnEnter: options.autocompleteOnEnter,
      autocompleteOnTab: options.autocompleteOnTab,
      selectByDigit: options.selectByDigit,
      revertOnBackspace: options.revertOnBackspace,
      inlineSuggestionEnabled: this.inlineSuggestionEnabled,
      handleMissingSpaceAfterAccept: (entry, event) =>
        this.textEditService.handleMissingSpaceAfterAccept(
          entry,
          event,
          this.consumeKeyboardEvent.bind(this),
        ),
      tryRevertLastReplacement: (entry, event) =>
        this.textEditService.tryRevertLastReplacement(entry, event, {
          consumeKeyboardEvent: this.consumeKeyboardEvent.bind(this),
          clearSuggestions: () => this.clearSuggestions(entry),
        }),
      tryRevertLastAutoFix: (entry, event) =>
        this.textEditService.tryRevertLastAutoFix(entry, event, {
          consumeKeyboardEvent: this.consumeKeyboardEvent.bind(this),
          clearSuggestions: () => this.clearSuggestions(entry),
        }),
      tryDeleteTrailingPunctuationSpace: (entry, event) =>
        this.textEditService.tryDeleteTrailingPunctuationSpace(
          entry,
          event,
          this.consumeKeyboardEvent.bind(this),
        ),
      consumeKeyboardEvent: this.consumeKeyboardEvent.bind(this),
      clearSuggestions: this.clearSuggestions.bind(this),
      isMenuVisible: (entry) => this.menuPresenter.isVisible(entry.menu, entry.suggestions.length),
      updateSelectionHighlight: (entry) =>
        this.menuPresenter.updateHighlight(entry.list, entry.selectedIndex),
      acceptSuggestion: this.acceptSuggestion.bind(this),
      acceptSuggestionAtIndex: this.acceptSuggestionAtIndex.bind(this),
      requestInlineSuggestion: (entry) => {
        entry.pendingInlineAccept = true;
        this.predictionCoordinator.schedule(entry, {
          force: true,
          clearSuggestions: () => this.clearSuggestions(entry),
        });
      },
    });
  }

  public fulfillPrediction(context: PredictionResponse): void {
    const entry = this.entryRegistry.getById(context.suggestionId);
    if (!entry) {
      return;
    }

    if (
      !this.predictionCoordinator.shouldProcessResponse(entry, context, {
        isEntryFocused: this.isEntryFocused(entry),
        applyTextEdit: () => {
          if (context.textEdit) {
            this.textEditService.applyTextEdit(entry, context.textEdit);
          }
        },
        clearSuggestions: () => this.clearSuggestions(entry),
      })
    ) {
      return;
    }

    entry.suggestions = Array.isArray(context.predictions) ? context.predictions.slice() : [];
    entry.selectedIndex = 0;
    entry.menuHeader =
      this.displayLangHeader && context.lang ? `Lang: ${SUPPORTED_LANGUAGES[context.lang]}` : null;

    if (this.inlineSuggestionEnabled) {
      entry.inlineSuggestion = entry.suggestions[0] ?? null;
      this.menuPresenter.hide(entry.menu, entry.list);
      this.inlinePresenter.renderForEntry({
        enabled: this.inlineSuggestionEnabled,
        entry,
        resolveMentionToken: this.findMentionToken.bind(this),
      });
    } else {
      entry.inlineSuggestion = null;
      this.inlinePresenter.clearAll();
      this.menuPresenter.render({
        menu: entry.menu,
        list: entry.list,
        target: entry.elem,
        suggestions: entry.suggestions,
        selectedIndex: entry.selectedIndex,
        menuHeader: entry.menuHeader,
        mentionText: entry.latestMentionText,
      });
    }

    if (entry.pendingInlineAccept) {
      entry.pendingInlineAccept = false;
      const suggested = entry.inlineSuggestion ?? entry.suggestions[0] ?? null;
      if (suggested) {
        this.acceptSuggestion(entry, suggested);
      }
    }

    if (entry.suggestions.length > 0) {
      this.telemetry.recordSuggestionShown({
        suggestionCount: entry.suggestions.length,
        language: context.lang,
      });
    }
  }

  public detachAllHelpers(): void {
    for (const id of [...this.entryRegistry.ids()]) {
      this.detachHelper(id);
    }
    this.entryRegistry.clear();
    this.activeEntryId = null;
  }

  public removeHelpersNotInDocument(): void {
    for (const [id, entry] of this.entryRegistry.entriesById()) {
      // Keep helpers attached for temporarily hidden elements, but detach when element
      // becomes structurally/security-ineligible (e.g. password fields).
      if (!isInDocument(entry.elem) || !this.isStructurallyEligibleElement(entry.elem)) {
        this.detachHelper(id);
      }
    }
  }

  public queryAndAttachHelper(root?: Element): void {
    const candidates = this.discovery.queryCandidates(root);

    for (const candidate of candidates) {
      if (this.entryRegistry.isAttached(candidate)) {
        continue;
      }

      let shouldSkip = false;
      for (const [existingId, existing] of this.entryRegistry.entriesById()) {
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
    this.predictionCoordinator.schedule(entry, {
      force: true,
      clearSuggestions: () => this.clearSuggestions(entry),
    });
  }

  public updateLangConfig(lang: string): void {
    this.lang = lang;
    this.separatorRegex = LANG_SEPARATOR_CHARS_REGEX[lang] || /\s+/;
    this.predictionCoordinator.updateLang(this.lang, this.separatorRegex);
    this.triggerActiveSuggestion();
  }

  private isStructurallyEligibleElement(elem: HTMLElement): elem is SuggestionElement {
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

  private attachHelper(elem: SuggestionElement): void {
    const id = this.entryRegistry.allocateId();

    const menu = SuggestionMenuView.ensureMenu(document.body);
    const list = menu.querySelector("ul") as HTMLUListElement;

    const entry: SuggestionEntry = {
      id,
      elem,
      menu,
      list,
      requestId: 0,
      suggestions: [],
      selectedIndex: 0,
      menuHeader: null,
      latestMentionText: "",
      latestMentionStart: 0,
      inlineSuggestion: null,
      pendingInlineAccept: false,
      missingTrailingSpace: false,
      expectedCursorPos: 0,
      lastReplacement: null,
      lastAutoFixReplacement: null,
      lastKeydownKey: null,
      lastInputAction: null,
      lastBeforeCursorText: null,
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
    entry.handlers.click = this.onElementClick.bind(this, id);
    entry.handlers.menuMouseDown = (event) => {
      event.preventDefault();
    };
    entry.handlers.menuClick = this.onMenuClick.bind(this, id);

    elem.setAttribute("data-tribute", "true");
    elem.setAttribute("data-suggestion", "true");
    elem.tributeMenu = menu;
    elem.suggestionMenu = menu;

    this.entryRegistry.register(entry);
    this.lifecycleController.attachEntryListeners(entry);
  }

  private detachHelper(id: number): void {
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }

    this.cancelPendingDeleteFallback(id);
    this.lifecycleController.detachEntryListeners(entry);
    entry.menu.remove();
    this.predictionCoordinator.cancelPending(entry);

    delete entry.elem.tributeMenu;
    delete entry.elem.suggestionMenu;
    entry.elem.removeAttribute("data-tribute");
    entry.elem.removeAttribute("data-suggestion");

    this.entryRegistry.unregister(id);

    if (this.activeEntryId === id) {
      this.activeEntryId = null;
    }

    this.inlinePresenter.clearAll();
  }

  private dismissEntry(entry: SuggestionEntry, keepActive = false): void {
    this.cancelPendingDeleteFallback(entry.id);
    this.clearSuggestions(entry);
    this.predictionCoordinator.cancelPending(entry);
    entry.requestId += 1;
    if (!keepActive && this.activeEntryId === entry.id) {
      this.activeEntryId = null;
    }
  }

  private isEntryFocused(entry: SuggestionEntry): boolean {
    if (this.activeEntryId === entry.id) {
      return true;
    }
    const active = document.activeElement;
    if (!active) {
      return false;
    }
    return active === entry.elem || entry.elem.contains(active);
  }

  private getActiveEntry(): SuggestionEntry | null {
    if (this.activeEntryId !== null) {
      const known = this.entryRegistry.getById(this.activeEntryId);
      if (known && document.activeElement === known.elem) {
        return known;
      }
    }

    const active = document.activeElement;
    if (!active) {
      return null;
    }
    const entry = this.entryRegistry.getByElement(active) ?? null;
    if (entry) {
      this.activeEntryId = entry.id;
    }
    return entry;
  }

  private onElementFocus(id: number): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry || !this.inlineSuggestionEnabled) {
      return;
    }
    this.inlinePresenter.renderForEntry({
      enabled: this.inlineSuggestionEnabled,
      entry,
      resolveMentionToken: this.findMentionToken.bind(this),
    });
  }

  private onElementClick(id: number): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    // Clicking in target often changes caret context; hide stale UI and invalidate pending responses.
    this.dismissEntry(entry, true);
  }

  private onElementBlur(id: number): void {
    if (this.activeEntryId === id) {
      this.activeEntryId = null;
    }
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    this.dismissEntry(entry);
  }

  private onElementInput(id: number, event: Event): void {
    this.cancelPendingDeleteFallback(id);
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    const snapshot: SuggestionSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    if (
      entry.lastAutoFixReplacement &&
      !this.shouldPreserveAutoFixSnapshot(entry.lastAutoFixReplacement, snapshot)
    ) {
      entry.lastAutoFixReplacement = null;
    }
    const inputAction = this.resolveInputAction(entry, event, snapshot.beforeCursor);
    entry.lastInputAction = inputAction;
    entry.lastKeydownKey = null;
    entry.lastBeforeCursorText = snapshot.beforeCursor;
    const tokenInfo = this.findMentionToken(snapshot.beforeCursor);
    entry.latestMentionText = tokenInfo.token;
    entry.latestMentionStart = tokenInfo.start;
    if (this.inlineSuggestionEnabled) {
      this.inlinePresenter.renderForEntry({
        enabled: this.inlineSuggestionEnabled,
        entry,
        resolveMentionToken: this.findMentionToken.bind(this),
      });
    }
    this.predictionCoordinator.schedule(entry, {
      force: false,
      clearSuggestions: () => this.clearSuggestions(entry),
      inputAction,
    });
  }

  private shouldPreserveAutoFixSnapshot(
    autoFix: NonNullable<SuggestionEntry["lastAutoFixReplacement"]>,
    snapshot: SuggestionSnapshot,
  ): boolean {
    const fullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const replaceEnd = autoFix.replaceStart + autoFix.replacementText.length;
    if (snapshot.cursorOffset !== autoFix.cursorAfter) {
      return false;
    }
    if (autoFix.replaceStart < 0 || replaceEnd > fullText.length) {
      return false;
    }
    return fullText.slice(autoFix.replaceStart, replaceEnd) === autoFix.replacementText;
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

  private clearSuggestions(entry: SuggestionEntry): void {
    entry.suggestions = [];
    entry.selectedIndex = 0;
    entry.inlineSuggestion = null;
    entry.pendingInlineAccept = false;
    this.menuPresenter.hide(entry.menu, entry.list);
    this.inlinePresenter.clearAll();
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

    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }

    this.acceptSuggestionAtIndex(entry, index);
  }

  private onElementKeyDown(id: number, event: Event): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    const keyboardEvent = event as KeyboardEvent;
    entry.lastKeydownKey = keyboardEvent.key;

    this.keyboardHandler.handle(entry, keyboardEvent);

    if (keyboardEvent.defaultPrevented) {
      return;
    }

    if (keyboardEvent.key === "Backspace" || keyboardEvent.key === "Delete") {
      // Some rich editors defer/suppress input on delete keys. Delay stale-UI
      // cleanup until the next tick and cancel it when input arrives.
      this.cancelPendingDeleteFallback(id);
      const timer = setTimeout(() => {
        this.pendingDeleteFallbackTimers.delete(id);
        const current = this.entryRegistry.getById(id);
        if (!current) {
          return;
        }
        this.dismissEntry(current, true);
      }, 0);
      this.pendingDeleteFallbackTimers.set(id, timer);
    }
  }

  private cancelPendingDeleteFallback(id: number): void {
    const timer = this.pendingDeleteFallbackTimers.get(id);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.pendingDeleteFallbackTimers.delete(id);
  }

  private resolveInputAction(
    entry: SuggestionEntry,
    event: Event,
    currentBeforeCursor: string,
  ): PredictionInputAction {
    const inputEvent = event as Event & { inputType?: unknown };
    const inputType = typeof inputEvent.inputType === "string" ? inputEvent.inputType : "";
    if (inputType.startsWith("delete")) {
      return "delete";
    }
    if (inputType.startsWith("insert")) {
      return "insert";
    }

    if (entry.lastKeydownKey === "Backspace" || entry.lastKeydownKey === "Delete") {
      return "delete";
    }

    const previousBeforeCursor = entry.lastBeforeCursorText;
    if (typeof previousBeforeCursor === "string") {
      if (currentBeforeCursor.length < previousBeforeCursor.length) {
        return "delete";
      }
      if (currentBeforeCursor.length > previousBeforeCursor.length) {
        return "insert";
      }
    }

    return "other";
  }

  private acceptSuggestionAtIndex(entry: SuggestionEntry, index: number): void {
    const suggestion = entry.suggestions[index];
    if (!suggestion) {
      return;
    }

    this.acceptSuggestion(entry, suggestion);
  }

  private acceptSuggestion(entry: SuggestionEntry, suggestion: string): void {
    const accepted = this.textEditService.acceptSuggestion(entry, suggestion);
    if (!accepted) {
      return;
    }
    this.finishAcceptedSuggestion(entry, accepted.triggerText, accepted.insertedText);
  }

  private finishAcceptedSuggestion(
    entry: SuggestionEntry,
    triggerText: string,
    insertedText: string,
  ): void {
    this.clearSuggestions(entry);

    entry.missingTrailingSpace = true;
    entry.expectedCursorPos = TextTargetAdapter.snapshot(entry.elem as TextTarget).cursorOffset;

    this.telemetry.recordSuggestionAccepted({
      triggerText,
      insertedText,
      language: this.lang,
    });
  }

  private consumeKeyboardEvent(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  private isInputElement(elem: Element): elem is HTMLInputElement {
    return elem.tagName === "INPUT";
  }

  private isTextAreaElement(elem: Element): elem is HTMLTextAreaElement {
    return elem.tagName === "TEXTAREA";
  }
}
