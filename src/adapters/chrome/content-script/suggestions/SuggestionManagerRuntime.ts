import { getDeepActiveElement, isInDocument } from "@core/application/dom-utils";
import { createLogger } from "@core/application/logging/Logger";
import { LANG_SEPARATOR_CHARS_REGEX, SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { InlineSuggestionPresenter } from "./InlineSuggestionPresenter";
import {
  ManualAttachUiManager,
  type ManualAttachTarget,
  resolveManualAttachIconUrl,
} from "./ManualAttachUiManager";
import { NativeAutocompleteConflictDetector } from "./NativeAutocompleteConflictDetector";
import { SuggestionElementDiscovery } from "./SuggestionElementDiscovery";
import { SuggestionEntryRegistry } from "./SuggestionEntryRegistry";
import { SuggestionGrammarCoordinator } from "./SuggestionGrammarCoordinator";
import { SuggestionKeyboardHandler } from "./SuggestionKeyboardHandler";
import { SuggestionLifecycleController } from "./SuggestionLifecycleController";
import { SuggestionMenuPresenter } from "./SuggestionMenuPresenter";
import { SuggestionPositioningService } from "./SuggestionPositioningService";
import { SuggestionPredictionCoordinator } from "./SuggestionPredictionCoordinator";
import { SuggestionMenuView } from "./SuggestionMenuView";
import { SuggestionTelemetryService } from "./SuggestionTelemetryService";
import {
  SuggestionTextEditService,
  type GrammarEditApplyContext,
} from "./SuggestionTextEditService";
import { isNativeUndoChord } from "./keyboardShortcuts";
import { ContentEditableAdapter } from "./ContentEditableAdapter";
import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import type { PredictionInputAction } from "@core/domain/messageTypes";
import type { GrammarEventType } from "@core/domain/grammar/types";
import { SPACE_CHARS } from "@core/domain/spacingRules";
import { resolveTraceAgeMs } from "../predictionTrace";
import type {
  PredictionResponse,
  SuggestionElement,
  SuggestionEntry,
  SuggestionManagerOptions,
  SuggestionSnapshot,
  SuggestionTelemetry,
} from "./types";

const DELETE_INPUT_FALLBACK_TIMEOUT_MS = 220;
const INSERT_INPUT_FALLBACK_TIMEOUT_MS = 140;
const INSERT_INPUT_FALLBACK_RETRY_INTERVAL_MS = 120;
const INSERT_INPUT_FALLBACK_MAX_WAIT_MS = 1000;
const LOCAL_GRAMMAR_IDLE_DELAY_MS = 220;
const SLOW_INPUT_PROCESSING_LOG_THRESHOLD_MS = 40;
const SPACING_OR_FILLER_PATTERN = "(?:[ \\xA0]|\\u200B|\\u200C|\\u200D|\\u2060|\\uFEFF)";
const DUPLICATE_PUNCTUATION_TAIL_REGEX = new RegExp(
  `[,;:](?:${SPACING_OR_FILLER_PATTERN})*[,;:](?:${SPACING_OR_FILLER_PATTERN})*$`,
);
const SUGGESTION_DEBOUNCE_BY_ACTION = {
  insert: 20,
  delete: 12,
  other: 20,
};
const logger = createLogger("SuggestionManagerRuntime");

interface PendingKeyFallback {
  timer: ReturnType<typeof setTimeout>;
  observer: MutationObserver | null;
  reconcileScheduled: boolean;
  inputAction: PredictionInputAction;
  expectedBeforeCursor: string | null;
  expectedFullText: string | null;
  typedKey: string | null;
  waitForTextChangeUntilMs: number | null;
}

export class SuggestionManagerRuntime {
  private readonly discovery: SuggestionElementDiscovery;
  private readonly entryRegistry = new SuggestionEntryRegistry();
  private forcedNativeConflictElements = new WeakSet<SuggestionElement>();
  private readonly lifecycleController: SuggestionLifecycleController;
  private readonly manualAttachUiManager: ManualAttachUiManager;
  private readonly positioningService = new SuggestionPositioningService();
  private readonly menuPresenter = new SuggestionMenuPresenter(this.positioningService);
  private readonly inlinePresenter = new InlineSuggestionPresenter({
    positioningService: this.positioningService,
  });
  private readonly contentEditableAdapter = new ContentEditableAdapter();
  private readonly grammarCoordinator: SuggestionGrammarCoordinator;
  private readonly predictionCoordinator: SuggestionPredictionCoordinator;
  private readonly textEditService: SuggestionTextEditService;
  private readonly keyboardHandler: SuggestionKeyboardHandler;
  private readonly telemetry: SuggestionTelemetry;
  private readonly pendingKeyFallbacks = new Map<number, PendingKeyFallback>();

  private readonly displayLangHeader: boolean;
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
          this.consumeKeyboardEvent.bind(this),
        ),
      tryUndoLastExtensionEdit: (entry, event) =>
        this.textEditService.tryUndoLastExtensionEdit(entry, event, {
          consumeKeyboardEvent: this.consumeKeyboardEvent.bind(this),
          clearSuggestions: () => this.clearSuggestions(entry),
        }),
      consumeKeyboardEvent: this.consumeKeyboardEvent.bind(this),
      clearSuggestions: this.clearSuggestions.bind(this),
      isMenuVisible: (entry) => this.menuPresenter.isVisible(entry.menu, entry.suggestions.length),
      updateSelectionHighlight: (entry) =>
        this.menuPresenter.updateHighlight(entry.list, entry.selectedIndex),
      acceptSuggestion: this.acceptSuggestion.bind(this),
      acceptSuggestionAtIndex: this.acceptSuggestionAtIndex.bind(this),
      requestInlineSuggestion: (entry) => {
        entry.pendingInlineAccept = true;
        const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
        const ctx = this.resolveEditableCursorContext(entry, snapshot);
        this.predictionCoordinator.schedule(entry, {
          force: true,
          clearSuggestions: () => this.clearSuggestions(entry),
          beforeCursorOverride: ctx.beforeCursor,
          afterCursorOverride: ctx.afterCursor,
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
        clearSuggestions: () => this.clearSuggestions(entry),
      })
    ) {
      return;
    }

    entry.suggestions = Array.isArray(context.predictions) ? context.predictions.slice() : [];
    entry.selectedIndex = 0;
    entry.menuHeader =
      this.displayLangHeader && context.lang ? `Lang: ${SUPPORTED_LANGUAGES[context.lang]}` : null;
    const currentPredictionContext = this.resolveCurrentPredictionContext(entry);
    entry.visibleSuggestionBeforeCursorText = currentPredictionContext.beforeCursor;
    entry.visibleSuggestionFullText = currentPredictionContext.fullText;

    if (this.inlineSuggestionEnabled) {
      entry.inlineSuggestion = entry.suggestions[0] ?? null;
      this.menuPresenter.hide(entry.menu, entry.list);
      this.inlinePresenter.renderForEntry({
        enabled: this.inlineSuggestionEnabled,
        entry,
        resolveMentionToken: this.predictionCoordinator.findMentionToken.bind(
          this.predictionCoordinator,
        ),
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
        showShortcutDigits: this.selectByDigit,
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
      logger.debug("Rendered suggestion popup", {
        traceId: context.traceId,
        requestId: context.requestId,
        suggestionId: context.suggestionId,
        runtimeGeneration: context.runtimeGeneration,
        predictionCount: entry.suggestions.length,
        totalLatencyMs: resolveTraceAgeMs(context.traceStartedAtMs),
        renderer: this.inlineSuggestionEnabled ? "inline" : "menu",
      });
      this.telemetry.recordSuggestionShown({
        suggestionCount: entry.suggestions.length,
        language: context.lang,
      });
    } else {
      logger.debug("Prediction response produced no visible suggestions", {
        traceId: context.traceId,
        requestId: context.requestId,
        suggestionId: context.suggestionId,
        runtimeGeneration: context.runtimeGeneration,
        totalLatencyMs: resolveTraceAgeMs(context.traceStartedAtMs),
      });
    }
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
    const candidates = this.discovery.queryCandidates(root);
    let attachedAny = false;

    for (const candidate of candidates) {
      if (this.entryRegistry.isAttached(candidate)) {
        if (
          !this.isManualAttachSupportedElement(candidate) ||
          !this.manualAttachUiManager.isSuccessPending(candidate)
        ) {
          this.removeManualAttachUi(candidate);
        }
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
        if (this.shouldShowManualAttachUi(candidate)) {
          this.manualAttachUiManager.ensureForElement(candidate);
          continue;
        }
        this.removeManualAttachUi(candidate);
        if (this.attachElement(candidate)) {
          attachedAny = true;
        }
      }
    }

    this.pruneManualAttachUi();
    return attachedAny;
  }

  public triggerActiveSuggestion(): void {
    const entry = this.getActiveEntry();
    if (!entry) {
      return;
    }
    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const ctx = this.resolveEditableCursorContext(entry, snapshot);
    this.predictionCoordinator.schedule(entry, {
      force: true,
      clearSuggestions: () => this.clearSuggestions(entry),
      beforeCursorOverride: ctx.beforeCursor,
      afterCursorOverride: ctx.afterCursor,
    });
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
    this.attachElement(elem, { forceNativeConflict: true });
    try {
      elem.focus({ preventScroll: true });
    } catch {
      elem.focus();
    }
  }

  private attachElement(
    elem: SuggestionElement,
    options: { forceNativeConflict?: boolean } = {},
  ): boolean {
    if (this.entryRegistry.isAttached(elem) || !this.isStructurallyEligibleElement(elem)) {
      return false;
    }

    if (options.forceNativeConflict) {
      this.forcedNativeConflictElements.add(elem);
    } else if (this.preferNativeAutocomplete && this.hasNativeAutocompleteConflict(elem)) {
      return false;
    }

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
      visibleSuggestionBeforeCursorText: null,
      visibleSuggestionFullText: null,
      inlineSuggestion: null,
      pendingInlineAccept: false,
      missingTrailingSpace: false,
      expectedCursorPos: 0,
      expectedCursorPosIsBlockLocal: false,
      pendingExtensionEdit: null,
      manualAutoFixSuppression: null,
      isComposing: false,
      lastKeydownKey: null,
      lastInputAction: null,
      lastBeforeCursorText: null,
      hasMultipleBlockDescendants: false,
      pendingRequestTimer: null,
      pendingIdleTimer: null,
      pendingGrammarPaste: false,
      handlers: {
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
    elem.tributeMenu = menu;
    elem.suggestionMenu = menu;

    this.entryRegistry.register(entry);
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
    this.clearPendingIdle(entry);
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
    this.clearPendingKeyFallback(entry.id);
    this.clearPendingIdle(entry);
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

  private onElementFocus(id: number): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry || !this.inlineSuggestionEnabled) {
      return;
    }
    this.inlinePresenter.renderForEntry({
      enabled: this.inlineSuggestionEnabled,
      entry,
      resolveMentionToken: this.predictionCoordinator.findMentionToken.bind(
        this.predictionCoordinator,
      ),
    });
  }

  private onElementClick(id: number): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    entry.pendingExtensionEdit = null;
    entry.pendingGrammarPaste = false;
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
    entry.pendingExtensionEdit = null;
    entry.isComposing = false;
    entry.pendingGrammarPaste = false;
    this.clearPendingIdle(entry);
    this.dismissEntry(entry);
  }

  private onElementInput(id: number, event: Event): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    if (this.shouldDeferContentEditableInputToFallback(id, entry)) {
      return;
    }
    this.clearPendingKeyFallback(id);
    this.processEntryAfterEdit(entry, {
      event,
      inputActionOverride: null,
      predictionMode: "schedule",
      typedKey: entry.lastKeydownKey,
      scheduleIdle: true,
    });
  }

  private onElementPaste(id: number): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    entry.pendingGrammarPaste = true;
  }

  private onElementCompositionStart(id: number): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    entry.isComposing = true;
    this.clearPendingIdle(entry);
    this.predictionCoordinator.cancelPending(entry);
    this.clearSuggestions(entry);
  }

  private onElementCompositionEnd(id: number): void {
    this.activeEntryId = id;
    const entry = this.entryRegistry.getById(id);
    if (!entry) {
      return;
    }
    entry.isComposing = false;
    this.scheduleIdleGrammar(entry);
  }

  private resolveBeforeCursorForPrediction(
    entry: SuggestionEntry,
    {
      inputAction,
      hasMultipleBlockDescendants,
      typedKey,
      snapshot,
    }: {
      inputAction?: PredictionInputAction;
      hasMultipleBlockDescendants?: boolean;
      typedKey?: string | null;
      snapshot?: SuggestionSnapshot;
    } = {},
  ): string {
    return this.resolveEditableCursorContext(
      entry,
      snapshot ?? TextTargetAdapter.snapshot(entry.elem as TextTarget),
      { inputAction, hasMultipleBlockDescendants, typedKey },
    ).beforeCursor;
  }

  private shouldPreservePendingExtensionEdit(
    pendingEdit: NonNullable<SuggestionEntry["pendingExtensionEdit"]>,
    snapshot: SuggestionSnapshot,
    entry: SuggestionEntry,
  ): boolean {
    if (
      pendingEdit.blockScoped &&
      !TextTargetAdapter.isTextValue(entry.elem) &&
      (entry.elem as HTMLElement).isContentEditable
    ) {
      const blockContext = this.contentEditableAdapter.getBlockContext(entry.elem as HTMLElement);
      if (!blockContext || !TextTargetAdapter.hasCollapsedSelection(entry.elem as TextTarget)) {
        return false;
      }
      const blockFullText = `${blockContext.beforeCursor}${blockContext.afterCursor}`;
      return (
        blockFullText === (pendingEdit.postEditBlockText ?? "") &&
        blockContext.beforeCursor.length >= pendingEdit.replaceStart &&
        blockContext.beforeCursor.length <= pendingEdit.cursorAfter
      );
    }

    if (
      !TextTargetAdapter.isTextValue(entry.elem) &&
      pendingEdit.source === "grammar" &&
      TextTargetAdapter.hasCollapsedSelection(entry.elem as TextTarget)
    ) {
      const actualFingerprint = TextTargetAdapter.createPostEditFingerprint(
        entry.elem as TextTarget,
        snapshot,
      );
      if (
        actualFingerprint.fullText === pendingEdit.postEditFingerprint.fullText &&
        actualFingerprint.selectionCollapsed ===
          pendingEdit.postEditFingerprint.selectionCollapsed &&
        snapshot.cursorOffset >= pendingEdit.replaceStart &&
        snapshot.cursorOffset <= pendingEdit.cursorAfter
      ) {
        return true;
      }
    }

    return TextTargetAdapter.matchesPostEditFingerprint(
      entry.elem as TextTarget,
      pendingEdit.postEditFingerprint,
      snapshot,
    );
  }

  private resetEntryPredictionStateAfterSuppressedInput(entry: SuggestionEntry): void {
    entry.requestId += 1;
    entry.lastInputAction = null;
    entry.lastKeydownKey = null;
    entry.pendingGrammarPaste = false;
    entry.lastBeforeCursorText = null;
    entry.visibleSuggestionBeforeCursorText = null;
    entry.visibleSuggestionFullText = null;
    this.clearSuggestions(entry);
  }

  private shouldSkipPredictionForUnstableInputState(
    entry: SuggestionEntry,
    event?: Event,
  ): boolean {
    return this.resolveUnstableInputSkipReason(entry, event) !== null;
  }

  private resolveUnstableInputSkipReason(
    entry: SuggestionEntry,
    event?: Event,
  ): "entry_composing" | "event_composing" | "selection_not_collapsed" | null {
    if (entry.isComposing) {
      return "entry_composing";
    }
    const eventIsComposing = (event as InputEvent | undefined)?.isComposing;
    if (eventIsComposing === true) {
      return "event_composing";
    }
    return TextTargetAdapter.hasCollapsedSelection(entry.elem as TextTarget)
      ? null
      : "selection_not_collapsed";
  }

  private shouldAllowContentEditableFallbackPredictionWithNonCollapsedSelection(
    entry: SuggestionEntry,
    {
      hasMultipleBlockDescendants,
      inputAction,
      predictionMode,
      typedKey,
    }: {
      hasMultipleBlockDescendants?: boolean;
      inputAction?: PredictionInputAction | null;
      predictionMode: "schedule" | "reconcile";
      typedKey?: string | null;
    },
  ): boolean {
    if (
      TextTargetAdapter.isTextValue(entry.elem) ||
      predictionMode !== "reconcile" ||
      inputAction === "delete" ||
      typeof typedKey !== "string" ||
      typedKey.length !== 1 ||
      typedKey.trim().length === 0
    ) {
      return false;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const targetNode = entry.elem as Node;
    const range = selection.getRangeAt(0);
    const startInside =
      range.startContainer === targetNode || targetNode.contains(range.startContainer);
    const endInside = range.endContainer === targetNode || targetNode.contains(range.endContainer);
    if (!startInside || !endInside) {
      return false;
    }

    const context = this.resolveEditableCursorContext(entry, null, {
      hasMultipleBlockDescendants,
      inputAction: inputAction ?? undefined,
      typedKey,
    });
    const trailingChar = context.beforeCursor.charAt(context.beforeCursor.length - 1);
    return trailingChar === typedKey || trailingChar === typedKey.toLocaleUpperCase();
  }

  private logSkippedPredictionForUnstableInputState(
    entry: SuggestionEntry,
    reason: "entry_composing" | "event_composing" | "selection_not_collapsed",
    {
      predictionMode,
      typedKey,
    }: {
      predictionMode: "schedule" | "reconcile";
      typedKey?: string | null;
    },
  ): void {
    const selection = window.getSelection();
    logger.debug("Skipping prediction for unstable input state", {
      suggestionId: entry.id,
      reason,
      predictionMode,
      typedKey,
      selectionRangeCount: selection?.rangeCount ?? 0,
      selectionCollapsed: selection?.isCollapsed ?? true,
    });
  }

  private shouldForceImmediatePunctuationRequest(
    beforeCursor: string,
    inputAction: PredictionInputAction,
  ): boolean {
    if (inputAction !== "insert") {
      return false;
    }
    return DUPLICATE_PUNCTUATION_TAIL_REGEX.test(beforeCursor);
  }

  private shouldDeferContentEditableInputToFallback(id: number, entry: SuggestionEntry): boolean {
    if (TextTargetAdapter.isTextValue(entry.elem)) {
      return false;
    }
    const pending = this.pendingKeyFallbacks.get(id);
    if (
      !pending ||
      pending.inputAction !== "insert" ||
      pending.expectedBeforeCursor === null ||
      pending.expectedFullText === null
    ) {
      return false;
    }

    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const currentFullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    if (currentFullText === pending.expectedFullText) {
      // Text hasn't changed yet. Some editors (e.g. Reddit/Lexical) fire the
      // input event before the DOM reconciliation produces the actual text
      // mutation.  When the fallback is still inside its mutation-wait window,
      // defer so the MutationObserver can pick up the real change later.
      return pending.waitForTextChangeUntilMs !== null;
    }

    const currentBeforeCursor = this.resolveBeforeCursorForPrediction(entry, { snapshot });
    return currentBeforeCursor === pending.expectedBeforeCursor;
  }

  private processEntryAfterEdit(
    entry: SuggestionEntry,
    {
      event,
      hasMultipleBlockDescendants,
      inputActionOverride,
      predictionMode,
      snapshotOverride,
      typedKey,
      scheduleIdle,
    }: {
      event?: Event;
      hasMultipleBlockDescendants?: boolean;
      inputActionOverride?: PredictionInputAction | null;
      predictionMode: "schedule" | "reconcile";
      snapshotOverride?: SuggestionSnapshot | null;
      typedKey?: string | null;
      scheduleIdle: boolean;
    },
  ): void {
    const processingStartedAt =
      typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
    const unstableInputSkipReason = this.resolveUnstableInputSkipReason(entry, event);
    const allowPredictionWithNonCollapsedSelection =
      unstableInputSkipReason === "selection_not_collapsed" &&
      this.shouldAllowContentEditableFallbackPredictionWithNonCollapsedSelection(entry, {
        hasMultipleBlockDescendants,
        inputAction: inputActionOverride,
        predictionMode,
        typedKey,
      });
    if (unstableInputSkipReason && !allowPredictionWithNonCollapsedSelection) {
      this.logSkippedPredictionForUnstableInputState(entry, unstableInputSkipReason, {
        predictionMode,
        typedKey,
      });
      this.clearPendingIdle(entry);
      this.resetEntryPredictionStateAfterSuppressedInput(entry);
      return;
    }
    if (allowPredictionWithNonCollapsedSelection) {
      logger.debug(
        "Proceeding with contenteditable fallback prediction despite non-collapsed selection",
        {
          suggestionId: entry.id,
          predictionMode,
          typedKey,
        },
      );
    }

    const isTextValueTarget = TextTargetAdapter.isTextValue(entry.elem);
    let snapshotDurationMs = 0;
    let snapshot: SuggestionSnapshot | null =
      snapshotOverride ??
      (isTextValueTarget ||
      this.grammarCoordinator.hasEnabledRules() ||
      entry.manualAutoFixSuppression !== null ||
      entry.pendingExtensionEdit !== null
        ? (() => {
            const snapshotStartedAt =
              typeof globalThis.performance?.now === "function"
                ? globalThis.performance.now()
                : Date.now();
            const resolvedSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
            const snapshotFinishedAt =
              typeof globalThis.performance?.now === "function"
                ? globalThis.performance.now()
                : Date.now();
            snapshotDurationMs = snapshotFinishedAt - snapshotStartedAt;
            return resolvedSnapshot;
          })()
        : null);

    if (snapshot) {
      this.textEditService.syncManualAutoFixSuppression(entry, snapshot);
      if (
        entry.pendingExtensionEdit &&
        !this.shouldPreservePendingExtensionEdit(entry.pendingExtensionEdit, snapshot, entry)
      ) {
        entry.pendingExtensionEdit = null;
      }
    }
    const resolvedHasMultipleBlockDescendants =
      hasMultipleBlockDescendants ?? this.resolveHasMultipleBlockDescendants(entry);

    const provisionalContextStartedAt =
      typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
    const provisionalContext = this.resolveEditableCursorContext(entry, snapshot, {
      hasMultipleBlockDescendants: resolvedHasMultipleBlockDescendants,
      typedKey,
    });
    const provisionalContextDurationMs =
      (typeof globalThis.performance?.now === "function"
        ? globalThis.performance.now()
        : Date.now()) - provisionalContextStartedAt;
    const provisionalBeforeCursor = provisionalContext.beforeCursor;
    const inputAction =
      inputActionOverride ??
      this.resolveInputAction(entry, event ?? new Event("input"), provisionalBeforeCursor);
    const predictionContextStartedAt =
      typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
    const cursorContext = this.resolveEditableCursorContext(entry, snapshot, {
      hasMultipleBlockDescendants: resolvedHasMultipleBlockDescendants,
      inputAction,
      typedKey,
    });
    const predictionContextDurationMs =
      (typeof globalThis.performance?.now === "function"
        ? globalThis.performance.now()
        : Date.now()) - predictionContextStartedAt;
    const grammarEdit =
      !allowPredictionWithNonCollapsedSelection && cursorContext.safeForGrammar
        ? this.grammarCoordinator.run({
            beforeCursor: cursorContext.beforeCursor,
            afterCursor: cursorContext.afterCursor,
            inputAction,
            triggers: this.resolveLocalGrammarTriggers(entry, event, cursorContext.beforeCursor),
          })
        : null;

    if (grammarEdit) {
      const grammarReplacement =
        typeof grammarEdit.replacement === "string" ? grammarEdit.replacement : "";
      const grammarDeleteBackwards = Number.isFinite(grammarEdit.deleteBackwards)
        ? Math.max(0, grammarEdit.deleteBackwards)
        : 0;
      const applyResult = this.textEditService.applyGrammarEdit(entry, grammarEdit, {
        snapshot: cursorContext.snapshot,
        contentEditableContext: cursorContext.applyContext,
      });
      if (applyResult.applied) {
        this.clearSuggestions(entry);
        if (applyResult.didDispatchInput) {
          if (
            !TextTargetAdapter.isTextValue(entry.elem) &&
            predictionMode === "reconcile" &&
            this.dispatchAdjustedGrammarPrediction(entry, {
              beforeCursor: cursorContext.beforeCursor,
              afterCursor: cursorContext.afterCursor,
              grammarReplacement,
              grammarDeleteBackwards,
              inputAction,
              predictionMode,
              scheduleIdle,
              isTextValue: false,
            })
          ) {
            logger.debug(
              "Dispatched adjusted grammar prediction after contenteditable beforeinput handling",
              {
                suggestionId: entry.id,
                inputAction,
                predictionMode,
                replacementLength: grammarReplacement.length,
                deleteBackwards: grammarDeleteBackwards,
              },
            );
            return;
          }
          this.clearPendingIdle(entry);
          entry.lastInputAction = inputAction;
          entry.lastKeydownKey = null;
          entry.pendingGrammarPaste = false;
          return;
        }

        if (
          !TextTargetAdapter.isTextValue(entry.elem) &&
          this.dispatchAdjustedGrammarPrediction(entry, {
            beforeCursor: cursorContext.beforeCursor,
            afterCursor: cursorContext.afterCursor,
            grammarReplacement,
            grammarDeleteBackwards,
            inputAction,
            predictionMode,
            scheduleIdle,
            isTextValue: false,
          })
        ) {
          return;
        }

        snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
        if (this.shouldSkipPredictionForUnstableInputState(entry)) {
          this.clearPendingIdle(entry);
          this.resetEntryPredictionStateAfterSuppressedInput(entry);
          return;
        }
        this.textEditService.syncManualAutoFixSuppression(entry, snapshot);
        if (
          entry.pendingExtensionEdit &&
          !this.shouldPreservePendingExtensionEdit(entry.pendingExtensionEdit, snapshot, entry)
        ) {
          entry.pendingExtensionEdit = null;
        }
      } else {
        // The grammar edit could not be applied to the DOM (e.g. the host
        // editor prevented the beforeinput).  Apply the intended text
        // transformation so the prediction request reflects the expected
        // result (the host will likely reconcile the change asynchronously).
        const isTextValue = TextTargetAdapter.isTextValue(entry.elem);
        const adjustedContext = isTextValue
          ? {
              beforeCursor: cursorContext.snapshot.beforeCursor,
              afterCursor: cursorContext.snapshot.afterCursor,
            }
          : {
              beforeCursor: cursorContext.beforeCursor,
              afterCursor: cursorContext.afterCursor,
            };
        if (
          this.dispatchAdjustedGrammarPrediction(entry, {
            beforeCursor: adjustedContext.beforeCursor,
            afterCursor: adjustedContext.afterCursor,
            grammarReplacement,
            grammarDeleteBackwards,
            inputAction,
            predictionMode,
            scheduleIdle,
            isTextValue,
          })
        ) {
          return;
        }
      }
    }

    const predictionContext = this.resolveEditableCursorContext(entry, snapshot, {
      hasMultipleBlockDescendants: resolvedHasMultipleBlockDescendants,
      inputAction,
      typedKey,
    });
    const predictionBeforeCursor = predictionContext.beforeCursor;
    const predictionAfterCursor = predictionContext.afterCursor;
    if (!isTextValueTarget && predictionMode === "reconcile") {
      logger.debug("Resolved contenteditable reconcile context", {
        suggestionId: entry.id,
        inputAction,
        typedKey,
        beforeCursorLength: predictionBeforeCursor.length,
        afterCursorLength: predictionAfterCursor.length,
        usedSnapshot: snapshot !== null,
        tokenLength:
          this.predictionCoordinator.findMentionToken(predictionBeforeCursor).token.length,
      });
    }
    entry.lastInputAction = inputAction;
    entry.lastKeydownKey = null;
    entry.lastBeforeCursorText = predictionBeforeCursor;
    entry.pendingGrammarPaste = false;

    const tokenInfo = this.predictionCoordinator.findMentionToken(predictionBeforeCursor);
    entry.latestMentionText = tokenInfo.token;
    entry.latestMentionStart = TextTargetAdapter.isTextValue(entry.elem) ? tokenInfo.start : -1;

    if (this.inlineSuggestionEnabled) {
      this.inlinePresenter.renderForEntry({
        enabled: this.inlineSuggestionEnabled,
        entry,
        resolveMentionToken: this.predictionCoordinator.findMentionToken.bind(
          this.predictionCoordinator,
        ),
      });
    }

    const forceImmediateRequest = this.shouldForceImmediatePunctuationRequest(
      predictionBeforeCursor,
      inputAction,
    );
    if (predictionMode === "reconcile") {
      this.predictionCoordinator.reconcile(entry, {
        clearSuggestions: () => this.clearSuggestions(entry),
        inputAction,
        beforeCursorOverride: predictionBeforeCursor,
        afterCursorOverride: predictionAfterCursor,
      });
    } else {
      this.predictionCoordinator.schedule(entry, {
        force: forceImmediateRequest,
        clearSuggestions: () => this.clearSuggestions(entry),
        inputAction,
        beforeCursorOverride: predictionBeforeCursor,
        afterCursorOverride: predictionAfterCursor,
      });
    }

    if (scheduleIdle) {
      this.scheduleIdleGrammar(entry);
    }

    const processingFinishedAt =
      typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
    const totalProcessingDurationMs = processingFinishedAt - processingStartedAt;
    if (!isTextValueTarget && totalProcessingDurationMs >= SLOW_INPUT_PROCESSING_LOG_THRESHOLD_MS) {
      logger.debug("Slow contenteditable input processing", {
        suggestionId: entry.id,
        inputAction,
        totalProcessingDurationMs: Math.round(totalProcessingDurationMs),
        snapshotDurationMs: Math.round(snapshotDurationMs),
        provisionalContextDurationMs: Math.round(provisionalContextDurationMs),
        predictionContextDurationMs: Math.round(predictionContextDurationMs),
        usedSnapshot: snapshot !== null,
        hasMultipleBlockDescendants: resolvedHasMultipleBlockDescendants,
        beforeCursorLength: cursorContext.beforeCursor.length,
        afterCursorLength: cursorContext.afterCursor.length,
        safeForGrammar: cursorContext.safeForGrammar,
      });
    }
  }

  private dispatchAdjustedGrammarPrediction(
    entry: SuggestionEntry,
    {
      beforeCursor,
      afterCursor,
      grammarReplacement,
      grammarDeleteBackwards,
      inputAction,
      predictionMode,
      scheduleIdle,
      isTextValue,
    }: {
      beforeCursor: string;
      afterCursor: string;
      grammarReplacement: string;
      grammarDeleteBackwards: number;
      inputAction: PredictionInputAction;
      predictionMode: "schedule" | "reconcile";
      scheduleIdle: boolean;
      isTextValue: boolean;
    },
  ): boolean {
    if (!(grammarReplacement.length > 0 || grammarDeleteBackwards > 0)) {
      return false;
    }

    const adjustedBeforeCursor =
      beforeCursor.slice(0, Math.max(0, beforeCursor.length - grammarDeleteBackwards)) +
      grammarReplacement;
    entry.lastInputAction = inputAction;
    entry.lastKeydownKey = null;
    entry.lastBeforeCursorText = adjustedBeforeCursor;
    entry.pendingGrammarPaste = false;

    const tokenInfo = this.predictionCoordinator.findMentionToken(adjustedBeforeCursor);
    entry.latestMentionText = tokenInfo.token;
    entry.latestMentionStart = isTextValue ? tokenInfo.start : -1;

    if (predictionMode === "reconcile") {
      this.predictionCoordinator.reconcile(entry, {
        clearSuggestions: () => this.clearSuggestions(entry),
        inputAction,
        beforeCursorOverride: adjustedBeforeCursor,
        afterCursorOverride: afterCursor,
      });
    } else {
      this.predictionCoordinator.schedule(entry, {
        force: false,
        clearSuggestions: () => this.clearSuggestions(entry),
        inputAction,
        beforeCursorOverride: adjustedBeforeCursor,
        afterCursorOverride: afterCursor,
      });
    }

    if (scheduleIdle) {
      this.scheduleIdleGrammar(entry);
    }

    return true;
  }

  private resolveEditableCursorContext(
    entry: SuggestionEntry,
    snapshot: SuggestionSnapshot | null,
    {
      hasMultipleBlockDescendants,
      inputAction,
      typedKey,
    }: {
      hasMultipleBlockDescendants?: boolean;
      inputAction?: PredictionInputAction;
      typedKey?: string | null;
    } = {},
  ): {
    beforeCursor: string;
    afterCursor: string;
    snapshot: SuggestionSnapshot;
    applyContext: GrammarEditApplyContext["contentEditableContext"];
    safeForGrammar: boolean;
  } {
    if (TextTargetAdapter.isTextValue(entry.elem)) {
      const resolvedSnapshot = snapshot ?? TextTargetAdapter.snapshot(entry.elem as TextTarget);
      return {
        beforeCursor: resolvedSnapshot.beforeCursor,
        afterCursor: resolvedSnapshot.afterCursor,
        snapshot: resolvedSnapshot,
        applyContext: null,
        safeForGrammar: true,
      };
    }
    let blockContext = this.contentEditableAdapter.getBlockContext(entry.elem);
    if (!blockContext) {
      blockContext = this.contentEditableAdapter.getBlockContextBySelection(entry.elem);
    }
    if (!blockContext) {
      // Never use full snapshot for prediction: Range.toString() often has no newlines between
      // blocks, so we would send concatenated "Wa"+"S". Use empty block context instead.
      return {
        beforeCursor: "",
        afterCursor: "",
        snapshot:
          snapshot ??
          ({
            beforeCursor: "",
            afterCursor: "",
            cursorOffset: 0,
          } satisfies SuggestionSnapshot),
        applyContext: {
          beforeCursor: snapshot?.beforeCursor ?? "",
          afterCursor: snapshot?.afterCursor ?? "",
          useFullTextOffsets: true,
        },
        safeForGrammar: false,
      };
    }
    const beforeBlockBoundary = this.contentEditableAdapter.isCollapsedSelectionBeforeBlockBoundary(
      entry.elem,
    );
    const resolvedHasMultipleBlockDescendants =
      hasMultipleBlockDescendants ?? this.resolveHasMultipleBlockDescendants(entry);
    const useFullTextOffsets =
      blockContext.beforeCursor.length === 0 &&
      blockContext.afterCursor.length === 0 &&
      beforeBlockBoundary;
    if (useFullTextOffsets) {
      const previousBlockFallback = resolvedHasMultipleBlockDescendants
        ? this.contentEditableAdapter.getPreviousBlockTextBySelection(entry.elem)
        : null;
      // Use only the previous block's trailing line for prediction when Enter
      // lands in a brand-new empty block. Keep applyContext rooted in the full
      // snapshot for DOM/apply logic so we never edit outside the active block.
      return {
        beforeCursor: previousBlockFallback ?? "",
        afterCursor: "",
        snapshot:
          snapshot ??
          ({
            beforeCursor: "",
            afterCursor: "",
            cursorOffset: 0,
          } satisfies SuggestionSnapshot),
        applyContext: {
          beforeCursor: snapshot?.beforeCursor ?? "",
          afterCursor: snapshot?.afterCursor ?? "",
          useFullTextOffsets: true,
        },
        safeForGrammar: false,
      };
    }
    const rawAfterCursor = blockContext.afterCursor;
    const resolvedAfterCursor = beforeBlockBoundary ? "" : rawAfterCursor;
    const resolvedSnapshot =
      snapshot ??
      ({
        beforeCursor: blockContext.beforeCursor,
        afterCursor: resolvedAfterCursor,
        cursorOffset: blockContext.beforeCursor.length,
      } satisfies SuggestionSnapshot);

    const resolvedLeadingChar = rawAfterCursor.charAt(0);
    const snapshotLeadingChar = resolvedSnapshot.afterCursor.charAt(0);
    // Exact match: the typed key matches the DOM character as-is (normal case).
    // Case-insensitive match: only when the typed key is lowercase but the host
    // capitalized it (e.g. sentence-start auto-capitalization).  This avoids
    // over-broadening when the user intentionally typed uppercase.
    const typedKeyIsLower =
      typeof typedKey === "string" &&
      typedKey.length === 1 &&
      typedKey !== typedKey.toLocaleUpperCase() &&
      typedKey === typedKey.toLocaleLowerCase();
    const exactKeyMatch = resolvedLeadingChar === typedKey && snapshotLeadingChar === typedKey;
    const capitalizedKeyMatch =
      typedKeyIsLower &&
      resolvedLeadingChar === typedKey.toLocaleUpperCase() &&
      snapshotLeadingChar === typedKey.toLocaleUpperCase();
    const shouldSeedTypedKey =
      inputAction !== "delete" &&
      blockContext.beforeCursor.length === 0 &&
      typeof typedKey === "string" &&
      typedKey.length === 1 &&
      typedKey.trim().length > 0 &&
      resolvedLeadingChar.length === 1 &&
      snapshotLeadingChar.length === 1 &&
      (exactKeyMatch || capitalizedKeyMatch);
    if (shouldSeedTypedKey) {
      return {
        beforeCursor: resolvedLeadingChar,
        afterCursor: rawAfterCursor.slice(resolvedLeadingChar.length),
        snapshot: {
          beforeCursor: `${resolvedSnapshot.beforeCursor}${resolvedLeadingChar}`,
          afterCursor: resolvedSnapshot.afterCursor.slice(snapshotLeadingChar.length),
          cursorOffset: resolvedSnapshot.cursorOffset + resolvedLeadingChar.length,
        },
        applyContext: {
          beforeCursor: resolvedLeadingChar,
          afterCursor: rawAfterCursor.slice(resolvedLeadingChar.length),
          useFullTextOffsets: false,
        },
        safeForGrammar: true,
      };
    }

    const typedKeyLooksMergedIntoPreviousBlock =
      inputAction !== "delete" &&
      resolvedHasMultipleBlockDescendants &&
      beforeBlockBoundary &&
      typeof typedKey === "string" &&
      typedKey.length === 1 &&
      blockContext.beforeCursor === resolvedSnapshot.beforeCursor &&
      (resolvedSnapshot.beforeCursor.endsWith(typedKey) ||
        resolvedSnapshot.beforeCursor.endsWith(typedKey.toLocaleUpperCase()));
    if (typedKeyLooksMergedIntoPreviousBlock) {
      const trailingChar = resolvedSnapshot.beforeCursor.charAt(
        resolvedSnapshot.beforeCursor.length - 1,
      );
      return {
        beforeCursor: trailingChar,
        afterCursor: "",
        snapshot: resolvedSnapshot,
        applyContext: {
          beforeCursor: trailingChar,
          afterCursor: "",
          useFullTextOffsets: false,
        },
        safeForGrammar: false,
      };
    }

    const pendingEdit = entry.pendingExtensionEdit;
    const shouldSeedPendingGrammarEdit =
      inputAction !== "delete" &&
      typeof typedKey !== "string" &&
      pendingEdit?.source === "grammar" &&
      blockContext.beforeCursor.length === 0 &&
      pendingEdit.replaceStart === resolvedSnapshot.beforeCursor.length &&
      pendingEdit.replacementText.length > 0 &&
      resolvedAfterCursor.startsWith(pendingEdit.replacementText) &&
      resolvedSnapshot.afterCursor.startsWith(pendingEdit.replacementText);
    const shouldSeedPendingGrammarEditFromMergedSnapshot =
      inputAction !== "delete" &&
      pendingEdit?.source === "grammar" &&
      pendingEdit.replacementText.length > 0 &&
      beforeBlockBoundary &&
      blockContext.beforeCursor === resolvedSnapshot.beforeCursor &&
      resolvedSnapshot.beforeCursor.endsWith(pendingEdit.replacementText);
    if (shouldSeedPendingGrammarEdit || shouldSeedPendingGrammarEditFromMergedSnapshot) {
      return {
        beforeCursor: pendingEdit.replacementText,
        afterCursor: rawAfterCursor.startsWith(pendingEdit.replacementText)
          ? rawAfterCursor.slice(pendingEdit.replacementText.length)
          : resolvedAfterCursor,
        snapshot: {
          beforeCursor: `${resolvedSnapshot.beforeCursor}${pendingEdit.replacementText}`,
          afterCursor: resolvedSnapshot.afterCursor.slice(pendingEdit.replacementText.length),
          cursorOffset: resolvedSnapshot.cursorOffset + pendingEdit.replacementText.length,
        },
        applyContext: {
          beforeCursor: pendingEdit.replacementText,
          afterCursor: rawAfterCursor.slice(pendingEdit.replacementText.length),
          useFullTextOffsets: false,
        },
        safeForGrammar: true,
      };
    }

    return {
      beforeCursor: blockContext.beforeCursor,
      afterCursor: resolvedAfterCursor,
      snapshot: resolvedSnapshot,
      applyContext: {
        beforeCursor: blockContext.beforeCursor,
        afterCursor: resolvedAfterCursor,
        useFullTextOffsets: false,
      },
      safeForGrammar: true,
    };
  }

  private resolveLocalGrammarTriggers(
    entry: SuggestionEntry,
    event: Event | undefined,
    beforeCursor: string,
  ): GrammarEventType[] {
    if (!this.grammarCoordinator.hasEnabledRules()) {
      return [];
    }

    const triggers: GrammarEventType[] = [];
    const inputType =
      typeof (event as InputEvent | undefined)?.inputType === "string"
        ? (event as InputEvent).inputType
        : "";
    if (entry.pendingGrammarPaste || inputType === "insertFromPaste" || event?.type === "paste") {
      triggers.push("paste");
    }

    const lastChar = beforeCursor.charAt(beforeCursor.length - 1);
    triggers.push(
      beforeCursor.length > 0 && SPACE_CHARS.includes(lastChar) ? "wordBoundary" : "insertChar",
    );
    return triggers;
  }

  private scheduleIdleGrammar(entry: SuggestionEntry): void {
    if (!this.grammarCoordinator.hasEnabledRules()) {
      return;
    }
    this.clearPendingIdle(entry);
    entry.pendingIdleTimer = setTimeout(() => {
      entry.pendingIdleTimer = null;
      this.runIdleGrammar(entry.id);
    }, LOCAL_GRAMMAR_IDLE_DELAY_MS);
  }

  private clearPendingIdle(entry: SuggestionEntry): void {
    if (entry.pendingIdleTimer === null) {
      return;
    }
    clearTimeout(entry.pendingIdleTimer);
    entry.pendingIdleTimer = null;
  }

  private runIdleGrammar(id: number): void {
    const entry = this.entryRegistry.getById(id);
    if (
      !entry ||
      !this.isEntryFocused(entry) ||
      this.shouldSkipPredictionForUnstableInputState(entry)
    ) {
      return;
    }

    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const grammarContext = this.resolveEditableCursorContext(entry, snapshot);
    const grammarEdit = grammarContext.safeForGrammar
      ? this.grammarCoordinator.run({
          beforeCursor: grammarContext.beforeCursor,
          afterCursor: grammarContext.afterCursor,
          inputAction: entry.lastInputAction ?? "other",
          triggers: ["idle"],
        })
      : null;
    if (!grammarEdit) {
      return;
    }

    const applyResult = this.textEditService.applyGrammarEdit(entry, grammarEdit, {
      snapshot: grammarContext.snapshot,
      contentEditableContext: grammarContext.applyContext,
    });
    if (!applyResult.applied) {
      return;
    }
    this.clearSuggestions(entry);
    if (applyResult.didDispatchInput) {
      return;
    }

    const updatedSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const predictionContext = this.resolveEditableCursorContext(entry, updatedSnapshot);
    const beforeCursor = predictionContext.beforeCursor;
    const afterCursor = predictionContext.afterCursor;
    this.predictionCoordinator.schedule(entry, {
      force: true,
      clearSuggestions: () => this.clearSuggestions(entry),
      inputAction: entry.lastInputAction ?? "other",
      beforeCursorOverride: beforeCursor,
      afterCursorOverride: afterCursor,
    });
  }

  private clearSuggestions(entry: SuggestionEntry): void {
    entry.suggestions = [];
    entry.selectedIndex = 0;
    entry.visibleSuggestionBeforeCursorText = null;
    entry.visibleSuggestionFullText = null;
    entry.inlineSuggestion = null;
    entry.pendingInlineAccept = false;
    this.menuPresenter.hide(entry.menu, entry.list);
    this.inlinePresenter.clearAll();
  }

  private reconcileEntrySelection(entry: SuggestionEntry): void {
    if (!this.hasVisibleSuggestionState(entry)) {
      return;
    }
    if (!this.isEntryFocused(entry)) {
      return;
    }
    if (TextTargetAdapter.isTextValue(entry.elem)) {
      if (!TextTargetAdapter.hasCollapsedSelection(entry.elem as TextTarget)) {
        this.dismissEntry(entry, true);
        return;
      }
    }
    if (!this.shouldCheckCaretContextOnSelectionChange(entry)) {
      return;
    }
    if (entry.visibleSuggestionBeforeCursorText === null) {
      return;
    }

    if (!TextTargetAdapter.isTextValue(entry.elem)) {
      // For contenteditable, compare block-local beforeCursor.  When the
      // caret moves to a different line (e.g. Enter), the block-local
      // context changes entirely and the popup must be dismissed.
      // Normal edits (typing, backspace) within the same line also change
      // beforeCursor, but the visible suggestion text will still be a
      // prefix — so only dismiss when neither is a prefix of the other.
      const blockContext = this.contentEditableAdapter.getBlockContext(entry.elem);
      const currentBeforeCursor = blockContext?.beforeCursor ?? "";
      const visibleBefore = entry.visibleSuggestionBeforeCursorText;
      const stillRelated =
        currentBeforeCursor === visibleBefore ||
        currentBeforeCursor.startsWith(visibleBefore) ||
        visibleBefore.startsWith(currentBeforeCursor);
      if (!stillRelated) {
        this.dismissEntry(entry, true);
      }
      return;
    }

    if (entry.visibleSuggestionFullText === null) {
      return;
    }
    const currentPredictionContext = this.resolveCurrentPredictionContext(entry);
    if (currentPredictionContext.fullText !== entry.visibleSuggestionFullText) {
      return;
    }
    if (currentPredictionContext.beforeCursor === entry.visibleSuggestionBeforeCursorText) {
      return;
    }
    this.dismissEntry(entry, true);
  }

  private resolveCurrentPredictionContext(entry: SuggestionEntry): {
    beforeCursor: string;
    fullText: string;
  } {
    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const ctx = this.resolveEditableCursorContext(entry, snapshot);
    return {
      beforeCursor: ctx.beforeCursor,
      fullText: `${snapshot.beforeCursor}${snapshot.afterCursor}`,
    };
  }

  private shouldCheckCaretContextOnSelectionChange(entry: SuggestionEntry): boolean {
    return entry.lastKeydownKey === null;
  }

  private hasVisibleSuggestionState(entry: SuggestionEntry): boolean {
    return (
      this.menuPresenter.isVisible(entry.menu, entry.suggestions.length) ||
      entry.inlineSuggestion !== null
    );
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

    if (this.shouldInvalidatePendingExtensionEditOnKeydown(keyboardEvent)) {
      entry.pendingExtensionEdit = null;
    }

    if (this.shouldDismissSuggestionsOnKeydown(keyboardEvent)) {
      this.dismissEntry(entry, true);
      return;
    }

    // Enter on a contenteditable always moves the caret to a new block, making
    // the current predictions invalid. Dismiss the popup immediately so it does
    // not linger until the fallback reconcile timer fires. The insert-fallback
    // below still runs so that predictions for the new line are scheduled.
    if (keyboardEvent.key === "Enter" && !TextTargetAdapter.isTextValue(entry.elem)) {
      this.dismissEntry(entry, true);
    }

    if (keyboardEvent.key === "Backspace" || keyboardEvent.key === "Delete") {
      // Some rich editors defer/suppress input on delete keys. Reconcile when
      // DOM mutation arrives first; keep a timeout as a safety net.
      this.scheduleKeyFallbackReconcile(
        id,
        entry,
        "delete",
        DELETE_INPUT_FALLBACK_TIMEOUT_MS,
        true,
      );
      return;
    }

    if (this.shouldScheduleInsertFallback(keyboardEvent, entry.elem)) {
      // Some editors update content on keydown/beforeinput but do not emit input
      // at the editable root for normal insertions.
      this.scheduleKeyFallbackReconcile(
        id,
        entry,
        "insert",
        INSERT_INPUT_FALLBACK_TIMEOUT_MS,
        !TextTargetAdapter.isTextValue(entry.elem),
        keyboardEvent.key,
      );
    }
  }

  private shouldInvalidatePendingExtensionEditOnKeydown(event: KeyboardEvent): boolean {
    if (isNativeUndoChord(event)) {
      return false;
    }
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ].includes(event.key)
    ) {
      return true;
    }
    return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a";
  }

  private shouldDismissSuggestionsOnKeydown(event: KeyboardEvent): boolean {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      return true;
    }
    return ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key);
  }

  private scheduleKeyFallbackReconcile(
    id: number,
    entry: SuggestionEntry,
    inputAction: PredictionInputAction,
    timeoutMs: number,
    observeMutations: boolean,
    typedKey: string | null = null,
  ): void {
    this.clearPendingKeyFallback(id);
    const shouldWaitForTextChange = inputAction === "insert" && observeMutations;
    const currentSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const currentBeforeCursor = this.resolveBeforeCursorForPrediction(entry, {
      snapshot: currentSnapshot,
    });
    logger.debug("Scheduling key fallback reconcile", {
      suggestionId: entry.id,
      inputAction,
      typedKey,
      timeoutMs,
      observeMutations,
      shouldWaitForTextChange,
      expectedBeforeCursorLength: currentBeforeCursor.length,
      expectedFullTextLength: `${currentSnapshot.beforeCursor}${currentSnapshot.afterCursor}`
        .length,
    });
    const fallback: PendingKeyFallback = {
      timer: setTimeout(() => {
        this.runKeyFallbackReconcile(id);
      }, timeoutMs),
      observer: null,
      reconcileScheduled: false,
      inputAction,
      expectedBeforeCursor: shouldWaitForTextChange ? currentBeforeCursor : null,
      expectedFullText: shouldWaitForTextChange
        ? `${currentSnapshot.beforeCursor}${currentSnapshot.afterCursor}`
        : null,
      typedKey,
      waitForTextChangeUntilMs: shouldWaitForTextChange
        ? Date.now() + INSERT_INPUT_FALLBACK_MAX_WAIT_MS
        : null,
    };

    if (observeMutations) {
      const mutationObserverCtor = (
        globalThis as typeof globalThis & {
          MutationObserver?: typeof MutationObserver;
        }
      ).MutationObserver;
      if (typeof mutationObserverCtor === "function") {
        fallback.observer = new mutationObserverCtor(() => {
          const pending = this.pendingKeyFallbacks.get(id);
          if (!pending || pending.reconcileScheduled) {
            return;
          }
          pending.reconcileScheduled = true;
          void Promise.resolve().then(() => {
            this.runKeyFallbackReconcile(id);
          });
        });
        fallback.observer.observe(entry.elem, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
    }

    this.pendingKeyFallbacks.set(id, fallback);
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
    if (!this.isEntryFocused(current)) {
      this.clearPendingKeyFallback(id);
      this.dismissEntry(current, true);
      return;
    }
    const hasMultipleBlockDescendants = this.resolveHasMultipleBlockDescendants(current);
    logger.debug("Running key fallback reconcile", {
      suggestionId: current.id,
      inputAction: pending.inputAction,
      typedKey: pending.typedKey,
      hasMultipleBlockDescendants,
      waitingForTextChange: pending.waitForTextChangeUntilMs !== null,
    });
    if (this.shouldWaitForInsertTextChange(id, current, pending, hasMultipleBlockDescendants)) {
      return;
    }
    this.clearPendingKeyFallback(id);
    const reconcileSnapshot = TextTargetAdapter.snapshot(current.elem as TextTarget);
    logger.debug("Proceeding with key fallback reconcile", {
      suggestionId: current.id,
      inputAction: pending.inputAction,
      typedKey: pending.typedKey,
      beforeCursorLength: this.resolveBeforeCursorForPrediction(current, {
        inputAction: pending.inputAction,
        hasMultipleBlockDescendants,
        typedKey: pending.typedKey,
        snapshot: reconcileSnapshot,
      }).length,
      snapshotCursorOffset: reconcileSnapshot.cursorOffset,
    });
    if (
      this.tryDispatchResolvedContentEditableFallbackReconcile(
        current,
        pending,
        reconcileSnapshot,
        hasMultipleBlockDescendants,
      )
    ) {
      return;
    }
    this.processEntryAfterEdit(current, {
      inputActionOverride: pending.inputAction,
      hasMultipleBlockDescendants,
      predictionMode: "reconcile",
      snapshotOverride: reconcileSnapshot,
      typedKey: pending.typedKey,
      scheduleIdle: true,
    });
  }

  private tryDispatchResolvedContentEditableFallbackReconcile(
    entry: SuggestionEntry,
    pending: PendingKeyFallback,
    snapshot: SuggestionSnapshot,
    hasMultipleBlockDescendants: boolean,
  ): boolean {
    const isEligible =
      pending.inputAction === "insert" &&
      !TextTargetAdapter.isTextValue(entry.elem) &&
      typeof pending.typedKey === "string" &&
      pending.typedKey.length === 1;
    if (!isEligible) {
      logger.debug("Skipping resolved fallback reconcile fast-path", {
        suggestionId: entry.id,
        inputAction: pending.inputAction,
        isTextValueTarget: TextTargetAdapter.isTextValue(entry.elem),
        typedKey: pending.typedKey,
      });
      return false;
    }

    const predictionBeforeCursor = this.resolveBeforeCursorForPrediction(entry, {
      hasMultipleBlockDescendants,
      inputAction: "insert",
      typedKey: pending.typedKey,
      snapshot,
    });
    const trailingChar = predictionBeforeCursor.charAt(predictionBeforeCursor.length - 1);
    const typedKeyMatched =
      trailingChar === pending.typedKey || trailingChar === pending.typedKey.toLocaleUpperCase();
    if (!typedKeyMatched) {
      logger.debug("Resolved key fallback reconcile did not match typed key at caret", {
        suggestionId: entry.id,
        typedKey: pending.typedKey,
        beforeCursorLength: predictionBeforeCursor.length,
        trailingChar,
      });
      return false;
    }

    logger.debug("Resolved contenteditable reconcile context", {
      suggestionId: entry.id,
      typedKey: pending.typedKey,
      beforeCursorLength: predictionBeforeCursor.length,
      snapshotCursorOffset: snapshot.cursorOffset,
      hasMultipleBlockDescendants,
    });

    let predictionContext: ReturnType<
      SuggestionManagerRuntime["resolveEditableCursorContext"]
    > | null = null;
    try {
      predictionContext = this.resolveEditableCursorContext(entry, snapshot, {
        hasMultipleBlockDescendants,
        inputAction: "insert",
        typedKey: pending.typedKey,
      });
    } catch (error) {
      logger.warn("Resolved fallback reconcile context failed; using direct token fast-path", {
        suggestionId: entry.id,
        typedKey: pending.typedKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!predictionContext) {
      entry.lastInputAction = "insert";
      entry.lastKeydownKey = null;
      entry.lastBeforeCursorText = predictionBeforeCursor;
      entry.pendingGrammarPaste = false;

      const tokenInfo = this.predictionCoordinator.findMentionToken(predictionBeforeCursor);
      entry.latestMentionText = tokenInfo.token;
      entry.latestMentionStart = -1;

      logger.debug("Dispatching direct fallback reconcile prediction", {
        suggestionId: entry.id,
        typedKey: pending.typedKey,
        beforeCursorLength: predictionBeforeCursor.length,
        tokenLength: tokenInfo.token.length,
      });
      this.predictionCoordinator.reconcile(entry, {
        clearSuggestions: () => this.clearSuggestions(entry),
        inputAction: "insert",
        beforeCursorOverride: predictionBeforeCursor,
        afterCursorOverride: "",
      });
      this.scheduleIdleGrammar(entry);
      return true;
    }

    const grammarEdit = predictionContext.safeForGrammar
      ? this.grammarCoordinator.run({
          beforeCursor: predictionContext.beforeCursor,
          afterCursor: predictionContext.afterCursor,
          inputAction: "insert",
          triggers: this.resolveLocalGrammarTriggers(
            entry,
            undefined,
            predictionContext.beforeCursor,
          ),
        })
      : null;
    const grammarReplacement =
      grammarEdit && typeof grammarEdit.replacement === "string"
        ? grammarEdit.replacement
        : grammarEdit &&
            typeof (grammarEdit as { replacementText?: string }).replacementText === "string"
          ? (grammarEdit as { replacementText?: string }).replacementText || ""
          : "";
    const grammarDeleteBackwards =
      grammarEdit && Number.isFinite(grammarEdit.deleteBackwards)
        ? Math.max(0, grammarEdit.deleteBackwards)
        : 0;

    if (grammarEdit) {
      const applyResult = this.textEditService.applyGrammarEdit(entry, grammarEdit, {
        snapshot: predictionContext.snapshot,
        contentEditableContext: predictionContext.applyContext,
      });
      if (
        this.dispatchAdjustedGrammarPrediction(entry, {
          beforeCursor: predictionContext.beforeCursor,
          afterCursor: predictionContext.afterCursor,
          grammarReplacement,
          grammarDeleteBackwards,
          inputAction: "insert",
          predictionMode: "reconcile",
          scheduleIdle: true,
          isTextValue: false,
        })
      ) {
        logger.debug("Dispatched resolved fallback reconcile grammar prediction", {
          suggestionId: entry.id,
          typedKey: pending.typedKey,
          appliedGrammarEdit: applyResult.applied,
          didDispatchInput: applyResult.didDispatchInput,
          replacementLength: grammarReplacement.length,
          deleteBackwards: grammarDeleteBackwards,
        });
        return true;
      }
      if (applyResult.applied && applyResult.didDispatchInput) {
        logger.debug("Resolved fallback reconcile is waiting for host input after grammar apply", {
          suggestionId: entry.id,
          typedKey: pending.typedKey,
        });
        return true;
      }
    }

    entry.lastInputAction = "insert";
    entry.lastKeydownKey = null;
    entry.lastBeforeCursorText = predictionBeforeCursor;
    entry.pendingGrammarPaste = false;

    const tokenInfo = this.predictionCoordinator.findMentionToken(predictionBeforeCursor);
    entry.latestMentionText = tokenInfo.token;
    entry.latestMentionStart = -1;

    logger.debug("Dispatching resolved fallback reconcile prediction", {
      suggestionId: entry.id,
      typedKey: pending.typedKey,
      beforeCursorLength: predictionBeforeCursor.length,
      afterCursorLength: predictionContext.afterCursor.length,
      tokenLength: tokenInfo.token.length,
    });
    this.predictionCoordinator.reconcile(entry, {
      clearSuggestions: () => this.clearSuggestions(entry),
      inputAction: "insert",
      beforeCursorOverride: predictionBeforeCursor,
      afterCursorOverride: predictionContext.afterCursor,
    });
    this.scheduleIdleGrammar(entry);
    return true;
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

  private shouldWaitForInsertTextChange(
    id: number,
    entry: SuggestionEntry,
    pending: PendingKeyFallback,
    hasMultipleBlockDescendants: boolean,
  ): boolean {
    if (
      pending.inputAction !== "insert" ||
      pending.expectedBeforeCursor === null ||
      pending.waitForTextChangeUntilMs === null
    ) {
      return false;
    }

    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const currentFullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const textChanged =
      pending.expectedFullText !== null && currentFullText !== pending.expectedFullText;
    const shouldReconcileEnterAtEmptyBoundary =
      pending.typedKey === "Enter" &&
      hasMultipleBlockDescendants &&
      this.contentEditableAdapter.isCollapsedSelectionBeforeBlockBoundary(entry.elem);
    if (textChanged) {
      const currentBeforeCursor = this.resolveBeforeCursorForPrediction(entry, {
        inputAction: pending.inputAction,
        hasMultipleBlockDescendants,
        typedKey: pending.typedKey,
        snapshot,
      });
      const caretContextAdvanced = currentBeforeCursor !== pending.expectedBeforeCursor;
      if (!caretContextAdvanced && !shouldReconcileEnterAtEmptyBoundary) {
        const remainingMs = pending.waitForTextChangeUntilMs - Date.now();
        if (remainingMs > 0) {
          logger.debug("Insert fallback waiting for caret context after text change", {
            suggestionId: entry.id,
            typedKey: pending.typedKey,
            previousBeforeCursorLength: pending.expectedBeforeCursor.length,
            currentBeforeCursorLength: currentBeforeCursor.length,
            remainingMs: Math.round(remainingMs),
          });
          pending.reconcileScheduled = false;
          clearTimeout(pending.timer);
          pending.timer = setTimeout(
            () => this.runKeyFallbackReconcile(id),
            Math.max(1, Math.min(INSERT_INPUT_FALLBACK_RETRY_INTERVAL_MS, remainingMs)),
          );
          return true;
        }
      }
      logger.debug("Insert fallback detected text change", {
        suggestionId: entry.id,
        typedKey: pending.typedKey,
        previousFullTextLength: pending.expectedFullText?.length ?? 0,
        currentFullTextLength: currentFullText.length,
        currentBeforeCursorLength: currentBeforeCursor.length,
      });
      return false;
    }
    if (shouldReconcileEnterAtEmptyBoundary) {
      logger.debug("Insert fallback reconciling at empty boundary", {
        suggestionId: entry.id,
        typedKey: pending.typedKey,
      });
      return false;
    }

    const remainingMs = pending.waitForTextChangeUntilMs - Date.now();
    if (remainingMs <= 0) {
      // No observable text mutation happened during the wait window.
      // Drop fallback for synthetic seeded before-cursor values (first-char
      // contenteditable bootstrap path) and for swallowed inserts.
      // Reconcile when the typed key already appears at the cursor snapshot,
      // which covers editors that mutate before observers start.
      const isSeededBeforeCursor =
        typeof pending.typedKey === "string" &&
        pending.typedKey.length === 1 &&
        pending.expectedBeforeCursor === pending.typedKey;
      if (isSeededBeforeCursor) {
        logger.debug("Insert fallback expired for seeded before-cursor", {
          suggestionId: entry.id,
          typedKey: pending.typedKey,
        });
        this.clearPendingKeyFallback(id);
        return true;
      }

      const typedKey = pending.typedKey;
      const expectedBefore = pending.expectedBeforeCursor;
      const lastChar = expectedBefore.charAt(expectedBefore.length - 1);
      const isWhitespaceInsert = typedKey === " " && (lastChar === " " || lastChar === "\xA0");
      const isLikelyAlreadyInserted =
        (typeof typedKey === "string" &&
          typedKey.length === 1 &&
          expectedBefore.endsWith(typedKey)) ||
        isWhitespaceInsert;
      if (!isLikelyAlreadyInserted) {
        logger.debug("Insert fallback expired without visible insertion", {
          suggestionId: entry.id,
          typedKey: pending.typedKey,
          expectedBeforeCursorLength: expectedBefore.length,
        });
        this.clearPendingKeyFallback(id);
        return true;
      }
      logger.debug("Insert fallback waiting past timeout because text looks inserted", {
        suggestionId: entry.id,
        typedKey: pending.typedKey,
        expectedBeforeCursorLength: expectedBefore.length,
      });
      return false;
    }

    logger.debug("Insert fallback waiting for text change", {
      suggestionId: entry.id,
      typedKey: pending.typedKey,
      remainingMs: Math.round(remainingMs),
      currentFullTextLength: currentFullText.length,
    });
    pending.reconcileScheduled = false;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(
      () => this.runKeyFallbackReconcile(id),
      Math.max(1, Math.min(INSERT_INPUT_FALLBACK_RETRY_INTERVAL_MS, remainingMs)),
    );
    return true;
  }

  private shouldScheduleInsertFallback(event: KeyboardEvent, elem: SuggestionElement): boolean {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return false;
    }
    if (event.key === "Dead" || event.key === "Process" || event.key === "Unidentified") {
      return false;
    }
    if (event.key === "Enter") {
      return !TextTargetAdapter.isInput(elem);
    }
    return event.key.length === 1;
  }

  private resolveHasMultipleBlockDescendants(entry: SuggestionEntry): boolean {
    if (TextTargetAdapter.isTextValue(entry.elem)) {
      return false;
    }
    if (entry.hasMultipleBlockDescendants) {
      return true;
    }
    const hasMultipleBlockDescendants = this.contentEditableAdapter.hasMultipleBlockDescendants(
      entry.elem,
    );
    if (hasMultipleBlockDescendants) {
      entry.hasMultipleBlockDescendants = true;
    }
    return hasMultipleBlockDescendants;
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
    this.finishAcceptedSuggestion(
      entry,
      accepted.triggerText,
      accepted.insertedText,
      accepted.cursorAfter,
      accepted.cursorAfterIsBlockLocal,
    );
  }

  private finishAcceptedSuggestion(
    entry: SuggestionEntry,
    triggerText: string,
    insertedText: string,
    cursorAfter: number,
    cursorAfterIsBlockLocal: boolean,
  ): void {
    this.clearSuggestions(entry);

    const shouldExpectTrailingSpace =
      this.insertSpaceAfterAutocomplete && !/[ \xA0]$/.test(insertedText);
    entry.missingTrailingSpace = shouldExpectTrailingSpace;
    entry.expectedCursorPos = shouldExpectTrailingSpace ? cursorAfter : 0;
    entry.expectedCursorPosIsBlockLocal = shouldExpectTrailingSpace && cursorAfterIsBlockLocal;

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
}
