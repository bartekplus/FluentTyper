import { getDeepActiveElement, isInDocument } from "@core/application/dom-utils";
import { createLogger } from "@core/application/logging/Logger";
import { LANG_SEPARATOR_CHARS_REGEX } from "@core/domain/lang";
import { InlineSuggestionPresenter } from "./InlineSuggestionPresenter";
import {
  ManualAttachUiManager,
  type ManualAttachTarget,
  resolveManualAttachIconUrl,
} from "./ManualAttachUiManager";
import { NativeAutocompleteConflictDetector } from "./NativeAutocompleteConflictDetector";
import { SuggestionElementDiscovery } from "./SuggestionElementDiscovery";
import { SuggestionEntrySession } from "./SuggestionEntrySession";
import { SuggestionEntryRegistry } from "./SuggestionEntryRegistry";
import { SuggestionGrammarCoordinator } from "./SuggestionGrammarCoordinator";
import { SuggestionKeyboardHandler } from "./SuggestionKeyboardHandler";
import { SuggestionLifecycleController } from "./SuggestionLifecycleController";
import { SuggestionMenuPresenter } from "./SuggestionMenuPresenter";
import { SuggestionPositioningService } from "./SuggestionPositioningService";
import { SuggestionPredictionCoordinator } from "./SuggestionPredictionCoordinator";
import { SuggestionMenuView } from "./SuggestionMenuView";
import { SuggestionTelemetryService } from "./SuggestionTelemetryService";
import { resolveSuggestionOverlayRoot } from "./SuggestionOverlayRoot";
import { EditableContextResolver } from "./EditableContextResolver";
import { SuggestionTextEditService } from "./SuggestionTextEditService";
import { ContentEditableAdapter } from "./ContentEditableAdapter";
import { TextTargetAdapter } from "./TextTargetAdapter";
import {
  EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR,
  EARLY_TAB_ACCEPT_ENABLED_ATTR,
  EARLY_TAB_ACCEPT_ENTRY_ID_ATTR,
  EARLY_TAB_ACCEPT_VISIBLE_ATTR,
} from "./EarlyTabAcceptBridgeProtocol";
import { resolveTraceAgeMs } from "../predictionTrace";
import type {
  PendingKeyFallback,
  PredictionResponse,
  SuggestionElement,
  SuggestionEntry,
  SuggestionManagerOptions,
  SuggestionTelemetry,
} from "./types";

const SUGGESTION_DEBOUNCE_BY_ACTION = {
  insert: 20,
  delete: 12,
  other: 20,
};
const logger = createLogger("SuggestionManagerRuntime");

export interface EarlyTabAcceptResult {
  accepted: boolean;
  reason:
    | "entry_not_found"
    | "session_not_found"
    | "accepted_inline"
    | "accepted_menu"
    | "accept_failed"
    | "no_visible_suggestion_state";
  entryId: string;
  suggestionCount: number;
  menuVisible: boolean;
  hasInlineSuggestion: boolean;
}

export class SuggestionManagerRuntime {
  private readonly discovery: SuggestionElementDiscovery;
  private readonly entryRegistry = new SuggestionEntryRegistry();
  private readonly sessionRegistry = new Map<number, SuggestionEntrySession>();
  private forcedNativeConflictElements = new WeakSet<SuggestionElement>();
  private readonly lifecycleController: SuggestionLifecycleController;
  private readonly manualAttachUiManager: ManualAttachUiManager;
  private readonly positioningService = new SuggestionPositioningService();
  private readonly menuPresenter = new SuggestionMenuPresenter(this.positioningService);
  private readonly inlinePresenter = new InlineSuggestionPresenter({
    positioningService: this.positioningService,
  });
  private readonly editableContextResolver = new EditableContextResolver();
  private readonly contentEditableAdapter = new ContentEditableAdapter();
  private readonly grammarCoordinator: SuggestionGrammarCoordinator;
  private readonly predictionCoordinator: SuggestionPredictionCoordinator;
  private readonly textEditService: SuggestionTextEditService;
  private readonly keyboardHandler: SuggestionKeyboardHandler;
  private readonly telemetry: SuggestionTelemetry;
  private readonly pendingKeyFallbacks = new Map<number, PendingKeyFallback>();

  private readonly displayLangHeader: boolean;
  private readonly autocompleteOnTab: boolean;
  private readonly inlineSuggestionEnabled: boolean;
  private readonly insertSpaceAfterAutocomplete: boolean;
  private readonly preferNativeAutocomplete: boolean;
  private readonly selectByDigit: boolean;
  private readonly nativeAutocompleteConflictDetector = new NativeAutocompleteConflictDetector();

  private lang: string;
  private separatorRegex: RegExp;

  private activeEntryId: number | null = null;

  constructor(options: SuggestionManagerOptions) {
    this.discovery = new SuggestionElementDiscovery({
      selectors: options.selectors,
      isCandidateElement: this.isStructurallyEligibleElement.bind(this),
      onShadowRootDiscovered: options.onShadowRootDiscovered,
    });
    this.lifecycleController = new SuggestionLifecycleController({
      getEntries: () => this.entryRegistry.values(),
      dismissEntry: (entry) => this.dismissEntry(entry),
      reconcileEntrySelection: (entry) => this.reconcileEntrySelection(entry),
    });

    this.displayLangHeader = options.displayLangHeader;
    this.autocompleteOnTab = options.autocompleteOnTab;
    this.inlineSuggestionEnabled = options.inline_suggestion;
    this.insertSpaceAfterAutocomplete = options.insertSpaceAfterAutocomplete;
    this.preferNativeAutocomplete = options.preferNativeAutocomplete;
    this.selectByDigit = options.selectByDigit;
    this.manualAttachUiManager = new ManualAttachUiManager({
      iconUrl: resolveManualAttachIconUrl(),
      onActivate: this.handleManualAttachActivate.bind(this),
    });

    this.lang = options.lang;
    this.separatorRegex = LANG_SEPARATOR_CHARS_REGEX[this.lang] || /\s+/;
    this.grammarCoordinator = new SuggestionGrammarCoordinator({
      enabledGrammarRules: options.enabledGrammarRules,
      insertSpaceAfterAutocomplete: options.insertSpaceAfterAutocomplete,
      lang: this.lang,
      userDictionaryList: options.userDictionaryList,
    });
    this.predictionCoordinator = new SuggestionPredictionCoordinator({
      debounceByAction: SUGGESTION_DEBOUNCE_BY_ACTION,
      getPrediction: options.getPrediction,
      lang: this.lang,
      minWordLengthToPredict: options.minWordLengthToPredict,
      separatorRegex: this.separatorRegex,
    });
    this.telemetry = options.telemetry ?? new SuggestionTelemetryService();
    this.textEditService = new SuggestionTextEditService({
      findMentionToken: this.predictionCoordinator.findMentionToken.bind(
        this.predictionCoordinator,
      ),
      isSeparator: this.predictionCoordinator.isSeparator.bind(this.predictionCoordinator),
      contentEditableAdapter: this.contentEditableAdapter,
    });
    this.keyboardHandler = new SuggestionKeyboardHandler({
      autocompleteOnSpace: options.autocomplete,
      autocompleteOnEnter: options.autocompleteOnEnter,
      autocompleteOnTab: options.autocompleteOnTab,
      selectByDigit: options.selectByDigit,
      inlineSuggestionEnabled: this.inlineSuggestionEnabled,
      handleMissingSpaceAfterAccept: (entry, event) =>
        this.textEditService.handleMissingSpaceAfterAccept(
          entry,
          event,
          this.consumeCancelableEvent.bind(this),
        ),
      tryUndoLastExtensionEdit: (entry, event) =>
        this.textEditService.tryUndoLastExtensionEdit(entry, event, {
          consumeKeyboardEvent: this.consumeCancelableEvent.bind(this),
          clearSuggestions: () => this.clearSuggestions(entry),
        }),
      consumeKeyboardEvent: this.consumeCancelableEvent.bind(this),
      clearSuggestions: this.clearSuggestions.bind(this),
      isMenuVisible: (entry) => this.menuPresenter.isVisible(entry.menu, entry.suggestions.length),
      updateSelectionHighlight: (entry) =>
        this.menuPresenter.updateHighlight(entry.list, entry.selectedIndex),
      acceptSuggestion: (entry, suggestion) =>
        this.sessionRegistry.get(entry.id)?.acceptSuggestion(suggestion),
      acceptSuggestionAtIndex: (entry, index) =>
        this.sessionRegistry.get(entry.id)?.acceptSuggestionAtIndex(index),
      requestInlineSuggestion: (entry) =>
        this.sessionRegistry.get(entry.id)?.requestInlineSuggestion(),
    });
  }

  public fulfillPrediction(context: PredictionResponse): void {
    this.sessionRegistry.get(context.suggestionId)?.handlePredictionResponse(context);
  }

  public detachAllHelpers(): void {
    for (const id of [...this.entryRegistry.ids()]) {
      this.detachHelper(id);
    }
    this.manualAttachUiManager.removeAll();
    this.forcedNativeConflictElements = new WeakSet<SuggestionElement>();
    this.entryRegistry.clear();
    this.activeEntryId = null;
  }

  public removeHelpersNotInDocument(): void {
    for (const [id, entry] of this.entryRegistry.entriesById()) {
      // Keep helpers attached for temporarily hidden elements, but detach when element
      // becomes structurally/security-ineligible (e.g. password fields).
      if (!isInDocument(entry.elem) || !this.isStructurallyEligibleElement(entry.elem)) {
        this.forcedNativeConflictElements.delete(entry.elem);
        this.detachHelper(id);
        continue;
      }
      if (this.shouldDemoteAttachedElement(entry.elem)) {
        this.detachHelper(id);
        this.syncManualAttachUi(entry.elem);
      }
    }
    this.pruneManualAttachUi();
  }

  public queryAndAttachHelper(root?: Element): boolean {
    let attachedAny = false;

    for (const candidate of this.discovery.queryCandidates(root)) {
      attachedAny = this.attachSession(candidate) || attachedAny;
    }

    this.pruneManualAttachUi();
    return attachedAny;
  }

  public triggerActiveSuggestion(): void {
    const entry = this.getActiveEntry();
    if (!entry) {
      return;
    }
    this.sessionRegistry.get(entry.id)?.requestPrediction();
  }

  public handleEarlyTabAcceptRequest(entryId: string): EarlyTabAcceptResult {
    const entry = this.resolveEntryForBridgeEntryId(entryId);
    if (!entry) {
      return {
        accepted: false,
        reason: "entry_not_found",
        entryId,
        suggestionCount: 0,
        menuVisible: false,
        hasInlineSuggestion: false,
      };
    }

    const session = this.sessionRegistry.get(entry.id);
    if (!session) {
      return {
        accepted: false,
        reason: "session_not_found",
        entryId,
        suggestionCount: entry.suggestions.length,
        menuVisible: this.menuPresenter.isVisible(entry.menu, entry.suggestions.length),
        hasInlineSuggestion: entry.inlineSuggestion !== null,
      };
    }

    this.activeEntryId = entry.id;

    if (this.inlineSuggestionEnabled && entry.inlineSuggestion) {
      const accepted = session.acceptSuggestion(entry.inlineSuggestion);
      return {
        accepted,
        reason: accepted ? "accepted_inline" : "accept_failed",
        entryId,
        suggestionCount: entry.suggestions.length,
        menuVisible: this.menuPresenter.isVisible(entry.menu, entry.suggestions.length),
        hasInlineSuggestion: true,
      };
    }

    if (
      this.autocompleteOnTab &&
      this.menuPresenter.isVisible(entry.menu, entry.suggestions.length) &&
      entry.suggestions.length > 0
    ) {
      const accepted = session.acceptSuggestionAtIndex(entry.selectedIndex);
      return {
        accepted,
        reason: accepted ? "accepted_menu" : "accept_failed",
        entryId,
        suggestionCount: entry.suggestions.length,
        menuVisible: true,
        hasInlineSuggestion: entry.inlineSuggestion !== null,
      };
    }

    return {
      accepted: false,
      reason: "no_visible_suggestion_state",
      entryId,
      suggestionCount: entry.suggestions.length,
      menuVisible: this.menuPresenter.isVisible(entry.menu, entry.suggestions.length),
      hasInlineSuggestion: entry.inlineSuggestion !== null,
    };
  }

  public updateLangConfig(lang: string): void {
    if (this.lang === lang) {
      return;
    }
    this.lang = lang;
    this.separatorRegex = LANG_SEPARATOR_CHARS_REGEX[lang] || /\s+/;
    this.grammarCoordinator.updateLanguage(this.lang);
    this.predictionCoordinator.updateLang(this.lang, this.separatorRegex);
    this.triggerActiveSuggestion();
  }

  private isStructurallyEligibleElement(elem: HTMLElement): elem is SuggestionElement {
    if (TextTargetAdapter.isTextArea(elem)) {
      const ta = elem;
      return !ta.disabled && !ta.readOnly;
    }

    if (TextTargetAdapter.isInput(elem)) {
      const input = elem;
      if (input.disabled || input.readOnly) {
        return false;
      }
      const inputType = (input.type || "text").toLowerCase();
      if (!["text", "search", "", "email", "url"].includes(inputType)) {
        return false;
      }
      const blocked = `${input.name} ${input.id}`.toLowerCase();
      return !blocked.includes("password") && !blocked.includes("username");
    }

    return elem.isContentEditable;
  }

  private isManualAttachSupportedElement(elem: SuggestionElement): elem is ManualAttachTarget {
    return (
      TextTargetAdapter.isInput(elem) ||
      TextTargetAdapter.isTextArea(elem) ||
      elem.isContentEditable
    );
  }

  private isVisiblyInteractiveElement(elem: HTMLElement): boolean {
    const style = window.getComputedStyle(elem);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  private hasNativeAutocompleteConflict(elem: SuggestionElement): boolean {
    return this.nativeAutocompleteConflictDetector.isNativeAutocompletePreferred(elem);
  }

  private shouldDemoteAttachedElement(elem: SuggestionElement): boolean {
    return (
      this.preferNativeAutocomplete &&
      !this.forcedNativeConflictElements.has(elem) &&
      this.hasNativeAutocompleteConflict(elem)
    );
  }

  private shouldShowManualAttachUi(elem: SuggestionElement): elem is ManualAttachTarget {
    return (
      this.preferNativeAutocomplete &&
      !this.entryRegistry.isAttached(elem) &&
      !this.forcedNativeConflictElements.has(elem) &&
      this.isManualAttachSupportedElement(elem) &&
      this.hasNativeAutocompleteConflict(elem)
    );
  }

  private removeManualAttachUi(elem: SuggestionElement): void {
    if (this.isManualAttachSupportedElement(elem)) {
      this.manualAttachUiManager.removeForElement(elem);
    }
  }

  private pruneManualAttachUi(): void {
    for (const element of [...this.manualAttachUiManager.targets()]) {
      if (
        !isInDocument(element) ||
        !this.isStructurallyEligibleElement(element) ||
        !this.isVisiblyInteractiveElement(element)
      ) {
        this.forcedNativeConflictElements.delete(element);
        this.manualAttachUiManager.removeForElement(element);
        continue;
      }
      if (this.entryRegistry.isAttached(element)) {
        if (!this.manualAttachUiManager.isSuccessPending(element)) {
          this.manualAttachUiManager.removeForElement(element);
        }
        continue;
      }
      if (this.shouldShowManualAttachUi(element)) {
        this.manualAttachUiManager.ensureForElement(element);
        continue;
      }
      if (!this.shouldShowManualAttachUi(element)) {
        this.manualAttachUiManager.removeForElement(element);
      }
    }
  }

  private syncManualAttachUi(elem: SuggestionElement): void {
    if (this.entryRegistry.isAttached(elem)) {
      this.removeManualAttachUi(elem);
      return;
    }
    if (this.shouldShowManualAttachUi(elem)) {
      this.manualAttachUiManager.ensureForElement(elem);
      return;
    }
    this.removeManualAttachUi(elem);
  }

  private handleManualAttachActivate(elem: ManualAttachTarget): void {
    if (!isInDocument(elem) || !this.isStructurallyEligibleElement(elem)) {
      this.manualAttachUiManager.removeForElement(elem);
      return;
    }
    this.attachSession(elem, { forceNativeConflict: true });
    try {
      elem.focus({ preventScroll: true });
    } catch {
      elem.focus();
    }
  }

  private attachSession(
    elem: SuggestionElement,
    options: { forceNativeConflict?: boolean } = {},
  ): boolean {
    if (this.entryRegistry.isAttached(elem)) {
      if (
        !this.isManualAttachSupportedElement(elem) ||
        !this.manualAttachUiManager.isSuccessPending(elem)
      ) {
        this.removeManualAttachUi(elem);
      }
      return false;
    }

    let shouldSkip = false;
    for (const [existingId, existing] of this.entryRegistry.entriesById()) {
      if (elem.contains(existing.elem)) {
        this.detachHelper(existingId);
        continue;
      }
      if (existing.elem.contains(elem)) {
        shouldSkip = true;
        break;
      }
    }

    if (shouldSkip || !this.isStructurallyEligibleElement(elem)) {
      return false;
    }

    if (options.forceNativeConflict) {
      this.forcedNativeConflictElements.add(elem);
    } else if (this.shouldShowManualAttachUi(elem)) {
      this.manualAttachUiManager.ensureForElement(elem);
      return false;
    } else if (this.preferNativeAutocomplete && this.hasNativeAutocompleteConflict(elem)) {
      return false;
    }

    this.removeManualAttachUi(elem);

    const id = this.entryRegistry.allocateId();

    const { menu, list } = SuggestionMenuView.ensureMenu(
      resolveSuggestionOverlayRoot(elem.ownerDocument ?? document),
    );

    const entry: SuggestionEntry = {
      id,
      elem,
      inputEventTarget: !TextTargetAdapter.isTextValue(elem)
        ? TextTargetAdapter.findBackingTextValueTarget(elem)
        : null,
      menu,
      list,
      requestId: 0,
      suggestions: [],
      selectedIndex: 0,
      menuHeader: null,
      latestMentionText: "",
      latestMentionStart: 0,
      visibleSuggestionBeforeCursorText: null,
      visibleSuggestionFullText: null,
      inlineSuggestion: null,
      pendingInlineAccept: false,
      missingTrailingSpace: false,
      expectedCursorPos: 0,
      expectedCursorPosIsBlockLocal: false,
      expectedCursorPosBlockElement: null,
      expectedCursorPosBlockText: null,
      pendingExtensionEdit: null,
      suppressNextSuggestionInputPrediction: false,
      manualAutoFixSuppression: null,
      isComposing: false,
      lastKeydownKey: null,
      lastInputAction: null,
      lastBeforeCursorText: null,
      hasMultipleBlockDescendants: false,
      pendingRequestTimer: null,
      pendingIdleTimer: null,
      pendingGrammarPaste: false,
      recentInteractionTrail: [],
      handlers: {
        beforeinput: () => undefined,
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

    entry.handlers.beforeinput = this.onElementBeforeInput.bind(this, id);
    entry.handlers.input = this.onElementInput.bind(this, id);
    entry.handlers.keydown = this.onElementKeyDown.bind(this, id);
    entry.handlers.paste = this.onElementPaste.bind(this, id);
    entry.handlers.focus = this.onElementFocus.bind(this, id);
    entry.handlers.blur = this.onElementBlur.bind(this, id);
    entry.handlers.click = this.onElementClick.bind(this, id);
    entry.handlers.compositionStart = this.onElementCompositionStart.bind(this, id);
    entry.handlers.compositionEnd = this.onElementCompositionEnd.bind(this, id);
    entry.handlers.menuMouseDown = (event) => {
      event.preventDefault();
    };
    entry.handlers.menuClick = this.onMenuClick.bind(this, id);

    elem.setAttribute("data-tribute", "true");
    elem.setAttribute("data-suggestion", "true");
    elem.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, String(id));
    elem.setAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR, String(this.autocompleteOnTab));
    elem.setAttribute(
      EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR,
      String(this.shouldUseEarlyTabBridge(elem)),
    );
    elem.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "false");
    menu.id = SuggestionMenuView.resolveHostId(id);
    elem.tributeMenu = menu;
    elem.suggestionMenu = menu;

    const session = this.buildEntrySession(entry);

    this.entryRegistry.register(entry);
    this.sessionRegistry.set(id, session);
    this.lifecycleController.attachEntryListeners(entry);
    if (
      !options.forceNativeConflict ||
      !this.isManualAttachSupportedElement(elem) ||
      !this.manualAttachUiManager.isSuccessPending(elem)
    ) {
      this.removeManualAttachUi(elem);
    }
    return true;
  }

  private detachHelper(id: number): void {
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }

    this.clearPendingKeyFallback(id);
    this.sessionRegistry.get(id)?.dispose();
    this.lifecycleController.detachEntryListeners(entry);
    entry.menu.remove();

    delete entry.elem.tributeMenu;
    delete entry.elem.suggestionMenu;
    entry.elem.removeAttribute("data-tribute");
    entry.elem.removeAttribute("data-suggestion");
    entry.elem.removeAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR);
    entry.elem.removeAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR);
    entry.elem.removeAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR);
    entry.elem.removeAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR);

    this.entryRegistry.unregister(id);
    this.sessionRegistry.delete(id);

    if (this.activeEntryId === id) {
      this.activeEntryId = null;
    }

    this.inlinePresenter.clearAll();
  }

  private dismissEntry(entry: SuggestionEntry, keepActive = false): void {
    this.clearPendingKeyFallback(entry.id);
    this.sessionRegistry.get(entry.id)?.dispose();
    entry.requestId += 1;
    if (!keepActive && this.activeEntryId === entry.id) {
      this.activeEntryId = null;
    }
  }

  private isEntryFocused(entry: SuggestionEntry): boolean {
    if (this.activeEntryId === entry.id) {
      return true;
    }
    const active = getDeepActiveElement(document);
    if (!active) {
      return false;
    }
    return active === entry.elem || entry.elem.contains(active);
  }

  private getActiveEntry(): SuggestionEntry | null {
    if (this.activeEntryId !== null) {
      const known = this.entryRegistry.getById(this.activeEntryId);
      if (known && getDeepActiveElement(document) === known.elem) {
        return known;
      }
    }

    const active = getDeepActiveElement(document);
    if (!active) {
      return null;
    }
    const entry = this.entryRegistry.getByElement(active) ?? null;
    if (entry) {
      this.activeEntryId = entry.id;
    }
    return entry;
  }

  private resolveEntryForBridgeEntryId(entryId: string): SuggestionEntry | null {
    const numericId = Number(entryId);
    if (!Number.isInteger(numericId)) {
      return null;
    }

    return this.entryRegistry.getById(numericId) ?? null;
  }

  private onElementFocus(id: number): void {
    this.activeEntryId = id;
    this.sessionRegistry.get(id)?.handleFocus();
  }

  private onElementClick(id: number): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    this.sessionRegistry.get(id)?.handleClick({
      dismissEntry: () => this.dismissEntry(entry, true),
    });
  }

  private onElementBlur(id: number): void {
    if (this.activeEntryId === id) {
      this.activeEntryId = null;
    }
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    this.sessionRegistry.get(id)?.handleBlur({
      dismissEntry: () => this.dismissEntry(entry),
    });
  }

  private onElementInput(id: number, event: Event): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    this.sessionRegistry.get(id)?.handleInput(event);
  }

  private onElementBeforeInput(id: number, event: Event): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    const inputEvent = event as InputEvent;
    const handled = this.textEditService.tryUndoLastExtensionEditOnBeforeInput(entry, inputEvent, {
      consumeInputEvent: this.consumeCancelableEvent.bind(this),
      clearSuggestions: () => this.clearSuggestions(entry),
    });
    if (handled) {
      this.clearPendingKeyFallback(id);
    }
  }

  private onElementPaste(id: number): void {
    this.activeEntryId = id;
    this.sessionRegistry.get(id)?.handlePaste();
  }

  private onElementCompositionStart(id: number): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    this.sessionRegistry.get(id)?.handleCompositionStart();
  }

  private onElementCompositionEnd(id: number): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    this.sessionRegistry.get(id)?.handleCompositionEnd();
  }

  private clearSuggestions(entry: SuggestionEntry): void {
    this.sessionRegistry.get(entry.id)?.clearSuggestions();
  }

  private buildEntrySession(entry: SuggestionEntry): SuggestionEntrySession {
    return new SuggestionEntrySession({
      entry,
      editableContextResolver: this.editableContextResolver,
      clearPendingFallback: () => this.clearPendingKeyFallback(entry.id),
      hideMenu: () => this.menuPresenter.hide(entry.menu, entry.list, entry.elem),
      clearInlinePresenter: () => this.inlinePresenter.clearAll(),
      isFocused: () => this.isEntryFocused(entry),
      displayLangHeader: this.displayLangHeader,
      inlineSuggestionEnabled: this.inlineSuggestionEnabled,
      predictionCoordinator: this.predictionCoordinator,
      grammarCoordinator: this.grammarCoordinator,
      textEditService: this.textEditService,
      contentEditableAdapter: this.contentEditableAdapter,
      getPendingFallback: () => this.pendingKeyFallbacks.get(entry.id),
      renderMenu: ({ suggestions, selectedIndex, menuHeader, mentionText }) =>
        this.menuPresenter.render({
          menuId: entry.id,
          menu: entry.menu,
          list: entry.list,
          target: entry.elem,
          suggestions,
          selectedIndex,
          showShortcutDigits: this.selectByDigit,
          menuHeader,
          mentionText,
        }),
      renderInline: () =>
        this.inlinePresenter.renderForEntry({
          enabled: this.inlineSuggestionEnabled,
          entry,
          resolveMentionToken: this.predictionCoordinator.findMentionToken.bind(
            this.predictionCoordinator,
          ),
        }),
      recordSuggestionShown: (context) => this.telemetry.recordSuggestionShown(context),
      recordSuggestionAccepted: (context) => this.telemetry.recordSuggestionAccepted(context),
      getLang: () => this.lang,
      insertSpaceAfterAutocomplete: this.insertSpaceAfterAutocomplete,
      logRenderedSuggestionPopup: (context, details) => {
        logger.debug("Rendered suggestion popup", {
          traceId: context.traceId,
          requestId: context.requestId,
          suggestionId: context.suggestionId,
          runtimeGeneration: context.runtimeGeneration,
          predictionCount: details.predictionCount,
          totalLatencyMs: resolveTraceAgeMs(context.traceStartedAtMs),
          renderer: details.renderer,
        });
      },
      logNoVisibleSuggestions: (context) => {
        logger.debug("Prediction response produced no visible suggestions", {
          traceId: context.traceId,
          requestId: context.requestId,
          suggestionId: context.suggestionId,
          runtimeGeneration: context.runtimeGeneration,
          totalLatencyMs: resolveTraceAgeMs(context.traceStartedAtMs),
        });
      },
    });
  }

  private reconcileEntrySelection(entry: SuggestionEntry): void {
    this.sessionRegistry.get(entry.id)?.reconcileSelection({
      dismissEntry: () => this.dismissEntry(entry, true),
    });
  }

  private onMenuClick(id: number, event: Event): void {
    this.activeEntryId = id;
    const item = (
      typeof event.composedPath === "function" ? event.composedPath() : [event.target]
    ).find((node) => node instanceof HTMLElement && node.matches("li[data-index]")) as
      | HTMLElement
      | undefined;
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

    this.sessionRegistry.get(id)?.acceptSuggestionAtIndex(index);
  }

  private onElementKeyDown(id: number, event: Event): void {
    const keyboardEvent = event as KeyboardEvent & { __ftDocumentTabCaptureHandled?: boolean };
    if (keyboardEvent.__ftDocumentTabCaptureHandled) {
      return;
    }

    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    this.sessionRegistry.get(id)?.handleKeyDown(keyboardEvent, {
      dispatchKeyboard: () => this.keyboardHandler.handle(entry, keyboardEvent),
      dismissEntry: (keepActive = true) => this.dismissEntry(entry, keepActive),
      clearPendingFallback: () => this.clearPendingKeyFallback(id),
      storePendingFallback: (pending) => this.pendingKeyFallbacks.set(id, pending),
      runReconcile: () => this.runKeyFallbackReconcile(id),
    });
  }

  private runKeyFallbackReconcile(id: number): void {
    const pending = this.pendingKeyFallbacks.get(id);
    if (!pending) {
      return;
    }

    const current = this.entryRegistry.getById(id);
    if (!current) {
      this.clearPendingKeyFallback(id);
      return;
    }
    this.sessionRegistry.get(id)?.handleKeyFallbackReconcile(pending, {
      clearPendingFallback: () => this.clearPendingKeyFallback(id),
      dismissEntry: () => this.dismissEntry(current, true),
      rescheduleFallback: (delayMs: number) =>
        this.rescheduleKeyFallbackReconcile(id, pending, delayMs),
    });
  }

  private rescheduleKeyFallbackReconcile(
    id: number,
    pending: PendingKeyFallback,
    delayMs: number,
  ): void {
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.runKeyFallbackReconcile(id);
    }, delayMs);
  }

  private clearPendingKeyFallback(id: number): void {
    const pending = this.pendingKeyFallbacks.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    pending.observer?.disconnect();
    this.pendingKeyFallbacks.delete(id);
  }

  private shouldUseEarlyTabBridge(elem: SuggestionElement): boolean {
    return elem.tagName !== "INPUT" && elem.tagName !== "TEXTAREA";
  }

  private consumeCancelableEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }
}
