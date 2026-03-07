import { isInDocument } from "@core/application/dom-utils";
import { LANG_SEPARATOR_CHARS_REGEX, SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { InlineSuggestionPresenter } from "./InlineSuggestionPresenter";
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
const SPACING_OR_FILLER_PATTERN = "(?:[ \\xA0]|\\u200B|\\u200C|\\u200D|\\u2060|\\uFEFF)";
const DUPLICATE_PUNCTUATION_TAIL_REGEX = new RegExp(
  `[,;:](?:${SPACING_OR_FILLER_PATTERN})*[,;:](?:${SPACING_OR_FILLER_PATTERN})*$`,
);
const SUGGESTION_DEBOUNCE_BY_ACTION = {
  insert: 120,
  delete: 60,
  other: 120,
};

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
  private readonly lifecycleController: SuggestionLifecycleController;
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
      reconcileEntrySelection: (entry) => this.reconcileEntrySelection(entry),
    });

    this.displayLangHeader = options.displayLangHeader;
    this.inlineSuggestionEnabled = options.inline_suggestion;
    this.insertSpaceAfterAutocomplete = options.insertSpaceAfterAutocomplete;

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
    this.lang = lang;
    this.separatorRegex = LANG_SEPARATOR_CHARS_REGEX[lang] || /\s+/;
    this.grammarCoordinator.updateLanguage(this.lang);
    this.predictionCoordinator.updateLang(this.lang, this.separatorRegex);
    this.triggerActiveSuggestion();
  }

  private isStructurallyEligibleElement(elem: HTMLElement): elem is SuggestionElement {
    if (TextTargetAdapter.isTextArea(elem)) {
      return true;
    }

    if (TextTargetAdapter.isInput(elem)) {
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
      visibleSuggestionBeforeCursorText: null,
      visibleSuggestionFullText: null,
      inlineSuggestion: null,
      pendingInlineAccept: false,
      missingTrailingSpace: false,
      expectedCursorPos: 0,
      pendingExtensionEdit: null,
      manualAutoFixSuppression: null,
      isComposing: false,
      lastKeydownKey: null,
      lastInputAction: null,
      lastBeforeCursorText: null,
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
      typedKey,
      snapshot,
    }: {
      inputAction?: PredictionInputAction;
      typedKey?: string | null;
      snapshot?: SuggestionSnapshot;
    } = {},
  ): string {
    return this.resolveEditableCursorContext(
      entry,
      snapshot ?? TextTargetAdapter.snapshot(entry.elem as TextTarget),
      { inputAction, typedKey },
    ).beforeCursor;
  }

  private shouldPreservePendingExtensionEdit(
    pendingEdit: NonNullable<SuggestionEntry["pendingExtensionEdit"]>,
    snapshot: SuggestionSnapshot,
    entry: SuggestionEntry,
  ): boolean {
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
    if (entry.isComposing) {
      return true;
    }
    const eventIsComposing = (event as InputEvent | undefined)?.isComposing;
    if (eventIsComposing === true) {
      return true;
    }
    return !TextTargetAdapter.hasCollapsedSelection(entry.elem as TextTarget);
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
      inputActionOverride,
      predictionMode,
      typedKey,
      scheduleIdle,
    }: {
      event?: Event;
      inputActionOverride?: PredictionInputAction | null;
      predictionMode: "schedule" | "reconcile";
      typedKey?: string | null;
      scheduleIdle: boolean;
    },
  ): void {
    if (this.shouldSkipPredictionForUnstableInputState(entry, event)) {
      this.clearPendingIdle(entry);
      this.resetEntryPredictionStateAfterSuppressedInput(entry);
      return;
    }

    let snapshot: SuggestionSnapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    this.textEditService.syncManualAutoFixSuppression(entry, snapshot);
    if (
      entry.pendingExtensionEdit &&
      !this.shouldPreservePendingExtensionEdit(entry.pendingExtensionEdit, snapshot, entry)
    ) {
      entry.pendingExtensionEdit = null;
    }

    const provisionalContext = this.resolveEditableCursorContext(entry, snapshot, { typedKey });
    const provisionalBeforeCursor = provisionalContext.beforeCursor;
    const inputAction =
      inputActionOverride ??
      this.resolveInputAction(entry, event ?? new Event("input"), provisionalBeforeCursor);
    const cursorContext = this.resolveEditableCursorContext(entry, snapshot, {
      inputAction,
      typedKey,
    });
    const grammarEdit = cursorContext.safeForGrammar
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
          this.clearPendingIdle(entry);
          entry.lastInputAction = inputAction;
          entry.lastKeydownKey = null;
          entry.pendingGrammarPaste = false;
          return;
        }

        if (
          !TextTargetAdapter.isTextValue(entry.elem) &&
          (grammarReplacement.length > 0 || grammarDeleteBackwards > 0)
        ) {
          const adjustedBeforeCursor =
            cursorContext.beforeCursor.slice(
              0,
              Math.max(0, cursorContext.beforeCursor.length - grammarDeleteBackwards),
            ) + grammarReplacement;
          const adjustedAfterCursor = cursorContext.afterCursor;

          entry.lastInputAction = inputAction;
          entry.lastKeydownKey = null;
          entry.lastBeforeCursorText = adjustedBeforeCursor;
          entry.pendingGrammarPaste = false;

          const tokenInfo = this.predictionCoordinator.findMentionToken(adjustedBeforeCursor);
          entry.latestMentionText = tokenInfo.token;
          entry.latestMentionStart = -1;

          if (predictionMode === "reconcile") {
            this.predictionCoordinator.reconcile(entry, {
              clearSuggestions: () => this.clearSuggestions(entry),
              inputAction,
              beforeCursorOverride: adjustedBeforeCursor,
              afterCursorOverride: adjustedAfterCursor,
            });
          } else {
            this.predictionCoordinator.schedule(entry, {
              force: false,
              clearSuggestions: () => this.clearSuggestions(entry),
              inputAction,
              beforeCursorOverride: adjustedBeforeCursor,
              afterCursorOverride: adjustedAfterCursor,
            });
          }

          if (scheduleIdle) {
            this.scheduleIdleGrammar(entry);
          }
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
        if (grammarReplacement.length > 0 || grammarDeleteBackwards > 0) {
          const ctx = TextTargetAdapter.isTextValue(entry.elem)
            ? {
                beforeCursor: cursorContext.snapshot.beforeCursor,
                afterCursor: cursorContext.snapshot.afterCursor,
              }
            : {
                beforeCursor: cursorContext.beforeCursor,
                afterCursor: cursorContext.afterCursor,
              };
          const adjustedBeforeCursor =
            ctx.beforeCursor.slice(
              0,
              Math.max(0, ctx.beforeCursor.length - grammarDeleteBackwards),
            ) + grammarReplacement;
          const adjustedAfterCursor = ctx.afterCursor;

          entry.lastInputAction = inputAction;
          entry.lastKeydownKey = null;
          entry.lastBeforeCursorText = adjustedBeforeCursor;
          entry.pendingGrammarPaste = false;

          const tokenInfo = this.predictionCoordinator.findMentionToken(adjustedBeforeCursor);
          entry.latestMentionText = tokenInfo.token;
          entry.latestMentionStart = TextTargetAdapter.isTextValue(entry.elem)
            ? tokenInfo.start
            : -1;

          if (predictionMode === "reconcile") {
            this.predictionCoordinator.reconcile(entry, {
              clearSuggestions: () => this.clearSuggestions(entry),
              inputAction,
              beforeCursorOverride: adjustedBeforeCursor,
              afterCursorOverride: adjustedAfterCursor,
            });
          } else {
            this.predictionCoordinator.schedule(entry, {
              force: false,
              clearSuggestions: () => this.clearSuggestions(entry),
              inputAction,
              beforeCursorOverride: adjustedBeforeCursor,
              afterCursorOverride: adjustedAfterCursor,
            });
          }
          if (scheduleIdle) {
            this.scheduleIdleGrammar(entry);
          }
          return;
        }
      }
    }

    const predictionContext = this.resolveEditableCursorContext(entry, snapshot, {
      inputAction,
      typedKey,
    });
    const predictionBeforeCursor = predictionContext.beforeCursor;
    const predictionAfterCursor = predictionContext.afterCursor;
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
  }

  private resolveEditableCursorContext(
    entry: SuggestionEntry,
    snapshot: SuggestionSnapshot,
    {
      inputAction,
      typedKey,
    }: {
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
      return {
        beforeCursor: snapshot.beforeCursor,
        afterCursor: snapshot.afterCursor,
        snapshot,
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
        snapshot,
        applyContext: {
          beforeCursor: snapshot.beforeCursor,
          afterCursor: snapshot.afterCursor,
          useFullTextOffsets: true,
        },
        safeForGrammar: false,
      };
    }
    const beforeBlockBoundary = this.contentEditableAdapter.isCollapsedSelectionBeforeBlockBoundary(
      entry.elem,
    );
    const useFullTextOffsets =
      blockContext.beforeCursor.length === 0 &&
      blockContext.afterCursor.length === 0 &&
      beforeBlockBoundary;
    if (useFullTextOffsets) {
      // Use block context (empty) for prediction so we never send full root text.
      // Keep applyContext with full text for grammar/apply logic only.
      return {
        beforeCursor: blockContext.beforeCursor,
        afterCursor: blockContext.afterCursor,
        snapshot,
        applyContext: {
          beforeCursor: snapshot.beforeCursor,
          afterCursor: snapshot.afterCursor,
          useFullTextOffsets: true,
        },
        safeForGrammar: false,
      };
    }
    const rawAfterCursor = blockContext.afterCursor;
    const resolvedAfterCursor = beforeBlockBoundary ? "" : rawAfterCursor;

    const resolvedLeadingChar = rawAfterCursor.charAt(0);
    const snapshotLeadingChar = snapshot.afterCursor.charAt(0);
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
          beforeCursor: `${snapshot.beforeCursor}${resolvedLeadingChar}`,
          afterCursor: snapshot.afterCursor.slice(snapshotLeadingChar.length),
          cursorOffset: snapshot.cursorOffset + resolvedLeadingChar.length,
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
      beforeBlockBoundary &&
      typeof typedKey === "string" &&
      typedKey.length === 1 &&
      blockContext.beforeCursor === snapshot.beforeCursor &&
      (snapshot.beforeCursor.endsWith(typedKey) ||
        snapshot.beforeCursor.endsWith(typedKey.toLocaleUpperCase()));
    if (typedKeyLooksMergedIntoPreviousBlock) {
      const trailingChar = snapshot.beforeCursor.charAt(snapshot.beforeCursor.length - 1);
      return {
        beforeCursor: trailingChar,
        afterCursor: "",
        snapshot,
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
      pendingEdit.replaceStart === snapshot.beforeCursor.length &&
      pendingEdit.replacementText.length > 0 &&
      resolvedAfterCursor.startsWith(pendingEdit.replacementText) &&
      snapshot.afterCursor.startsWith(pendingEdit.replacementText);
    const shouldSeedPendingGrammarEditFromMergedSnapshot =
      inputAction !== "delete" &&
      pendingEdit?.source === "grammar" &&
      pendingEdit.replacementText.length > 0 &&
      beforeBlockBoundary &&
      blockContext.beforeCursor === snapshot.beforeCursor &&
      snapshot.beforeCursor.endsWith(pendingEdit.replacementText);
    if (shouldSeedPendingGrammarEdit || shouldSeedPendingGrammarEditFromMergedSnapshot) {
      return {
        beforeCursor: pendingEdit.replacementText,
        afterCursor: rawAfterCursor.startsWith(pendingEdit.replacementText)
          ? rawAfterCursor.slice(pendingEdit.replacementText.length)
          : resolvedAfterCursor,
        snapshot: {
          beforeCursor: `${snapshot.beforeCursor}${pendingEdit.replacementText}`,
          afterCursor: snapshot.afterCursor.slice(pendingEdit.replacementText.length),
          cursorOffset: snapshot.cursorOffset + pendingEdit.replacementText.length,
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
      snapshot,
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
        ? ((event as InputEvent).inputType as string)
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
          Promise.resolve().then(() => {
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
    if (this.shouldWaitForInsertTextChange(id, current, pending)) {
      return;
    }
    this.clearPendingKeyFallback(id);
    this.processEntryAfterEdit(current, {
      inputActionOverride: pending.inputAction,
      predictionMode: "reconcile",
      typedKey: pending.typedKey,
      scheduleIdle: true,
    });
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
    if (textChanged) {
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
        this.clearPendingKeyFallback(id);
        return true;
      }
      return false;
    }

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

    const shouldExpectTrailingSpace =
      this.insertSpaceAfterAutocomplete && !/[ \xA0]$/.test(insertedText);
    entry.missingTrailingSpace = shouldExpectTrailingSpace;
    entry.expectedCursorPos = shouldExpectTrailingSpace
      ? TextTargetAdapter.snapshot(entry.elem as TextTarget).cursorOffset
      : 0;

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
