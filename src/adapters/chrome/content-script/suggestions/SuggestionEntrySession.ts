import { createLogger } from "@core/application/logging/Logger";
import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import type { PredictionInputAction } from "@core/domain/messageTypes";
import { SPACE_CHARS } from "@core/domain/spacingRules";
import { isNativeUndoChord } from "./keyboardShortcuts";
import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import type {
  PendingKeyFallback,
  PredictionResponse,
  SuggestionEntry,
  SuggestionEntrySessionOptions,
  SuggestionSnapshot,
} from "./types";

const LOCAL_GRAMMAR_IDLE_DELAY_MS = 220;
const SLOW_INPUT_PROCESSING_LOG_THRESHOLD_MS = 40;
const DELETE_INPUT_FALLBACK_TIMEOUT_MS = 220;
const INSERT_INPUT_FALLBACK_TIMEOUT_MS = 140;
const INSERT_INPUT_FALLBACK_RETRY_INTERVAL_MS = 120;
const INSERT_INPUT_FALLBACK_MAX_WAIT_MS = 1000;
const INTERACTION_TRACE_LIMIT = 12;
const CARET_TRACE_TEXT_LIMIT = 24;
const SPACING_OR_FILLER_PATTERN = "(?:[ \\xA0]|\\u200B|\\u200C|\\u200D|\\u2060|\\uFEFF)";
const DUPLICATE_PUNCTUATION_TAIL_REGEX = new RegExp(
  `[,;:](?:${SPACING_OR_FILLER_PATTERN})*[,;:](?:${SPACING_OR_FILLER_PATTERN})*$`,
);
const logger = createLogger("SuggestionEntrySession");

function collapseTraceWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clipTraceText(value: string, limit: number, mode: "start" | "end" = "end"): string {
  if (value.length <= limit) {
    return value;
  }
  if (mode === "start") {
    return `${value.slice(0, Math.max(0, limit - 3))}...`;
  }
  return `...${value.slice(-(limit - 3))}`;
}

function buildCaretTrace(
  beforeCursor: string,
  afterCursor: string,
): {
  beforePreview: string;
  afterPreview: string;
  aroundCaret: string;
  tokenBeforeCaret: string;
  tokenAfterCaret: string;
} {
  const beforePreview = clipTraceText(
    collapseTraceWhitespace(beforeCursor.slice(-CARET_TRACE_TEXT_LIMIT * 2)),
    CARET_TRACE_TEXT_LIMIT,
  );
  const afterPreview = clipTraceText(
    collapseTraceWhitespace(afterCursor.slice(0, CARET_TRACE_TEXT_LIMIT * 2)),
    CARET_TRACE_TEXT_LIMIT,
    "start",
  );
  const tokenBeforeCaret =
    beforeCursor.match(/[^\s.,!?;:()[\]{}"'`<>/\\|@#$%^&*_+=~-]+$/u)?.[0] ?? "";
  const tokenAfterCaret =
    afterCursor.match(/^[^\s.,!?;:()[\]{}"'`<>/\\|@#$%^&*_+=~-]+/u)?.[0] ?? "";
  return {
    beforePreview,
    afterPreview,
    aroundCaret: `${beforePreview}|${afterPreview}`,
    tokenBeforeCaret: clipTraceText(tokenBeforeCaret, CARET_TRACE_TEXT_LIMIT),
    tokenAfterCaret: clipTraceText(tokenAfterCaret, CARET_TRACE_TEXT_LIMIT, "start"),
  };
}

export class SuggestionEntrySession {
  private readonly entry: SuggestionEntry;
  private readonly editableContextResolver: SuggestionEntrySessionOptions["editableContextResolver"];
  private readonly clearPendingFallback: NonNullable<
    SuggestionEntrySessionOptions["clearPendingFallback"]
  >;
  private readonly hideMenu: () => void;
  private readonly clearInlinePresenter: () => void;
  private readonly isFocused: () => boolean;
  private readonly displayLangHeader: boolean;
  private readonly inlineSuggestionEnabled: boolean;
  private readonly predictionCoordinator: SuggestionEntrySessionOptions["predictionCoordinator"];
  private readonly grammarCoordinator: SuggestionEntrySessionOptions["grammarCoordinator"];
  private readonly textEditService: SuggestionEntrySessionOptions["textEditService"];
  private readonly contentEditableAdapter: SuggestionEntrySessionOptions["contentEditableAdapter"];
  private readonly getPendingFallback: NonNullable<
    SuggestionEntrySessionOptions["getPendingFallback"]
  >;
  private readonly renderMenu: SuggestionEntrySessionOptions["renderMenu"];
  private readonly renderInline: () => void;
  private readonly recordSuggestionShown: SuggestionEntrySessionOptions["recordSuggestionShown"];
  private readonly recordSuggestionAccepted: SuggestionEntrySessionOptions["recordSuggestionAccepted"];
  private readonly getLang: () => string;
  private readonly insertSpaceAfterAutocomplete: boolean;
  private readonly logRenderedSuggestionPopup: SuggestionEntrySessionOptions["logRenderedSuggestionPopup"];
  private readonly logNoVisibleSuggestions: (context: PredictionResponse) => void;

  constructor(options: SuggestionEntrySessionOptions) {
    this.entry = options.entry;
    this.editableContextResolver = options.editableContextResolver;
    this.clearPendingFallback = options.clearPendingFallback ?? (() => undefined);
    this.hideMenu = options.hideMenu;
    this.clearInlinePresenter = options.clearInlinePresenter;
    this.isFocused = options.isFocused;
    this.displayLangHeader = options.displayLangHeader;
    this.inlineSuggestionEnabled = options.inlineSuggestionEnabled;
    this.predictionCoordinator = options.predictionCoordinator;
    this.grammarCoordinator = options.grammarCoordinator;
    this.textEditService = options.textEditService;
    this.contentEditableAdapter = options.contentEditableAdapter;
    this.getPendingFallback = options.getPendingFallback ?? (() => undefined);
    this.renderMenu = options.renderMenu;
    this.renderInline = options.renderInline;
    this.recordSuggestionShown = options.recordSuggestionShown;
    this.recordSuggestionAccepted = options.recordSuggestionAccepted;
    this.getLang = options.getLang;
    this.insertSpaceAfterAutocomplete = options.insertSpaceAfterAutocomplete;
    this.logRenderedSuggestionPopup = options.logRenderedSuggestionPopup;
    this.logNoVisibleSuggestions = options.logNoVisibleSuggestions;
  }

  public requestPrediction(): void {
    const snapshot = TextTargetAdapter.snapshot(this.entry.elem as TextTarget);
    const context = this.resolveEditableCursorContext(this.entry, snapshot);
    this.predictionCoordinator.schedule(this.entry, {
      force: true,
      clearSuggestions: () => this.clearSuggestions(),
      beforeCursorOverride: context.beforeCursor,
      afterCursorOverride: context.afterCursor,
    });
  }

  public requestInlineSuggestion(): void {
    if (this.entry.suppressNextSuggestionInputPrediction) {
      return;
    }
    this.entry.pendingInlineAccept = true;
    this.requestPrediction();
  }

  public handleFocus(): void {
    if (!this.inlineSuggestionEnabled) {
      return;
    }
    this.renderInline();
  }

  public handlePaste(): void {
    this.pushInteractionTrace("paste");
    this.entry.pendingGrammarPaste = true;
  }

  public handleKeyDown(
    keyboardEvent: KeyboardEvent,
    controls: {
      dispatchKeyboard: () => void;
      dismissEntry: (keepActive?: boolean) => void;
      clearPendingFallback: () => void;
      storePendingFallback: (pending: PendingKeyFallback) => void;
      runReconcile: () => void;
    },
  ): void {
    this.entry.lastKeydownKey = keyboardEvent.key;
    this.pushInteractionTrace(this.describeKeyboardInteraction(keyboardEvent));
    if (!TextTargetAdapter.isTextValue(this.entry.elem) && keyboardEvent.key === "Tab") {
      logger.debug("Contenteditable Tab keydown", {
        suggestionId: this.entry.id,
        requestId: this.entry.requestId,
        suppressNextSuggestionInputPrediction: this.entry.suppressNextSuggestionInputPrediction,
        pendingInlineAccept: this.entry.pendingInlineAccept,
        missingTrailingSpace: this.entry.missingTrailingSpace,
        hasPendingExtensionEdit: this.entry.pendingExtensionEdit !== null,
        pendingExtensionEditSource: this.entry.pendingExtensionEdit?.source,
        pendingExtensionEditBlockScoped: this.entry.pendingExtensionEdit?.blockScoped ?? false,
      });
    }
    controls.dispatchKeyboard();

    if (keyboardEvent.defaultPrevented) {
      return;
    }

    if (this.shouldInvalidatePendingExtensionEditOnKeydown(keyboardEvent)) {
      this.clearAcceptedSuggestionTransientState();
    }

    if (this.shouldDismissSuggestionsOnKeydown(keyboardEvent)) {
      controls.dismissEntry(true);
      return;
    }

    if (keyboardEvent.key === "Enter" && !TextTargetAdapter.isTextValue(this.entry.elem)) {
      controls.dismissEntry(true);
    }

    if (keyboardEvent.key === "Backspace" || keyboardEvent.key === "Delete") {
      this.scheduleKeyFallbackReconcile(
        "delete",
        DELETE_INPUT_FALLBACK_TIMEOUT_MS,
        true,
        null,
        controls,
      );
      return;
    }

    if (this.shouldScheduleInsertFallback(keyboardEvent)) {
      this.scheduleKeyFallbackReconcile(
        "insert",
        INSERT_INPUT_FALLBACK_TIMEOUT_MS,
        !TextTargetAdapter.isTextValue(this.entry.elem),
        keyboardEvent.key,
        controls,
      );
    }
  }

  public handleInput(event: Event): void {
    this.pushInteractionTrace(this.describeInputInteraction(event));
    const context = this.editableContextResolver.resolve(this.entry.elem);
    if (!context) {
      this.handleSuppressedInput();
      return;
    }
    if (this.shouldDeferContentEditableInputToFallback(context)) {
      return;
    }

    this.clearPendingFallback();
    if (!context.selectionStable || this.entry.isComposing) {
      this.handleSuppressedInput();
      return;
    }
    if (this.entry.suppressNextSuggestionInputPrediction) {
      const snapshot = TextTargetAdapter.snapshot(this.entry.elem as TextTarget);
      logger.debug("Evaluating post-accept input suppression", {
        suggestionId: this.entry.id,
        requestId: this.entry.requestId,
        inputType: this.resolveInputType(event),
        snapshotCursorOffset: snapshot.cursorOffset,
        snapshotBeforeCursorLength: snapshot.beforeCursor.length,
        snapshotAfterCursorLength: snapshot.afterCursor.length,
        hasPendingExtensionEdit: this.entry.pendingExtensionEdit !== null,
        pendingExtensionEditSource: this.entry.pendingExtensionEdit?.source ?? null,
        recentInteractionTrail: this.entry.recentInteractionTrail.slice(),
        caretTrace: buildCaretTrace(snapshot.beforeCursor, snapshot.afterCursor),
        activeBlockTrace: this.buildActiveBlockTrace(),
      });
      if (
        this.entry.pendingExtensionEdit !== null &&
        this.shouldPreservePendingExtensionEdit(snapshot)
      ) {
        logger.debug("Suppressing post-accept input echo", {
          suggestionId: this.entry.id,
          requestId: this.entry.requestId,
          inputType: this.resolveInputType(event),
          pendingExtensionEditSource: this.entry.pendingExtensionEdit.source,
          pendingExtensionEditBlockScoped: this.entry.pendingExtensionEdit.blockScoped ?? false,
        });
        this.suppressAcceptedSuggestionInput();
        return;
      }
      logger.debug("Post-accept suppression window ended on real edit", {
        suggestionId: this.entry.id,
        requestId: this.entry.requestId,
        inputType: this.resolveInputType(event),
        hasPendingExtensionEdit: this.entry.pendingExtensionEdit !== null,
        recentInteractionTrail: this.entry.recentInteractionTrail.slice(),
        activeBlockTrace: this.buildActiveBlockTrace(),
      });
      this.entry.suppressNextSuggestionInputPrediction = false;
    }

    this.processEntryAfterEdit({
      event,
      inputActionOverride: null,
      predictionMode: "schedule",
      typedKey: this.entry.lastKeydownKey,
      scheduleIdle: true,
    });
  }

  public handleCompositionStart(): void {
    this.entry.isComposing = true;
    this.clearPendingIdleTimer();
    this.predictionCoordinator.cancelPending(this.entry);
    this.clearSuggestions();
  }

  public handleCompositionEnd(): void {
    this.entry.isComposing = false;
    this.scheduleIdleGrammar();
  }

  public clearPendingRequestTimer(): void {
    if (this.entry.pendingRequestTimer) {
      clearTimeout(this.entry.pendingRequestTimer);
      this.entry.pendingRequestTimer = null;
    }
  }

  public clearPendingIdleTimer(): void {
    if (this.entry.pendingIdleTimer) {
      clearTimeout(this.entry.pendingIdleTimer);
      this.entry.pendingIdleTimer = null;
    }
  }

  public clearSuggestions(): void {
    this.entry.suggestions = [];
    this.entry.selectedIndex = 0;
    this.entry.visibleSuggestionBeforeCursorText = null;
    this.entry.visibleSuggestionFullText = null;
    this.entry.inlineSuggestion = null;
    this.entry.pendingInlineAccept = false;
    this.hideMenu();
    this.clearInlinePresenter();
  }

  public handlePredictionResponse(context: PredictionResponse): void {
    if (
      !this.predictionCoordinator.shouldProcessResponse(this.entry, context, {
        isEntryFocused: this.isFocused(),
        clearSuggestions: () => this.clearSuggestions(),
      })
    ) {
      return;
    }

    this.entry.suggestions = Array.isArray(context.predictions) ? context.predictions.slice() : [];
    this.entry.selectedIndex = 0;
    this.entry.menuHeader =
      this.displayLangHeader && context.lang ? `Lang: ${SUPPORTED_LANGUAGES[context.lang]}` : null;
    const currentPredictionContext = this.resolveCurrentPredictionContext();
    this.entry.visibleSuggestionBeforeCursorText = currentPredictionContext.beforeCursor;
    this.entry.visibleSuggestionFullText = currentPredictionContext.fullText;

    if (this.inlineSuggestionEnabled) {
      this.entry.inlineSuggestion = this.entry.suggestions[0] ?? null;
      this.hideMenu();
      this.renderInline();
    } else {
      this.entry.inlineSuggestion = null;
      this.clearInlinePresenter();
      this.renderMenu({
        suggestions: this.entry.suggestions,
        selectedIndex: this.entry.selectedIndex,
        menuHeader: this.entry.menuHeader,
        mentionText: this.entry.latestMentionText,
      });
    }

    if (this.entry.pendingInlineAccept) {
      this.entry.pendingInlineAccept = false;
      const suggested = this.entry.inlineSuggestion ?? this.entry.suggestions[0] ?? null;
      if (suggested) {
        this.acceptSuggestion(suggested);
      }
    }

    if (this.entry.suggestions.length > 0) {
      this.logRenderedSuggestionPopup(context, {
        predictionCount: this.entry.suggestions.length,
        renderer: this.inlineSuggestionEnabled ? "inline" : "menu",
      });
      this.recordSuggestionShown({
        suggestionCount: this.entry.suggestions.length,
        language: context.lang,
      });
      return;
    }

    this.logNoVisibleSuggestions(context);
  }

  public handleKeyFallbackReconcile(
    pending: PendingKeyFallback,
    controls: {
      clearPendingFallback: () => void;
      dismissEntry: () => void;
      rescheduleFallback: (delayMs: number) => void;
    },
  ): void {
    if (!this.isFocused()) {
      controls.clearPendingFallback();
      controls.dismissEntry();
      return;
    }

    const hasMultipleBlockDescendants = this.resolveHasMultipleBlockDescendants();
    logger.debug("Running key fallback reconcile", {
      suggestionId: this.entry.id,
      inputAction: pending.inputAction,
      typedKey: pending.typedKey,
      hasMultipleBlockDescendants,
      waitingForTextChange: pending.waitForTextChangeUntilMs !== null,
    });
    if (this.shouldWaitForInsertTextChange(pending, hasMultipleBlockDescendants, controls)) {
      return;
    }

    controls.clearPendingFallback();
    const reconcileSnapshot = TextTargetAdapter.snapshot(this.entry.elem as TextTarget);
    logger.debug("Proceeding with key fallback reconcile", {
      suggestionId: this.entry.id,
      inputAction: pending.inputAction,
      typedKey: pending.typedKey,
      beforeCursorLength: this.resolveBeforeCursorForPrediction(this.entry, {
        inputAction: pending.inputAction,
        hasMultipleBlockDescendants,
        typedKey: pending.typedKey,
        snapshot: reconcileSnapshot,
      }).length,
      snapshotCursorOffset: reconcileSnapshot.cursorOffset,
    });
    if (
      this.tryDispatchResolvedContentEditableFallbackReconcile(
        pending,
        reconcileSnapshot,
        hasMultipleBlockDescendants,
      )
    ) {
      return;
    }
    this.processEntryAfterEdit({
      inputActionOverride: pending.inputAction,
      hasMultipleBlockDescendants,
      predictionMode: "reconcile",
      snapshotOverride: reconcileSnapshot,
      typedKey: pending.typedKey,
      scheduleIdle: true,
    });
  }

  public dispose(): void {
    this.predictionCoordinator.cancelPending(this.entry);
    this.clearPendingRequestTimer();
    this.clearPendingIdleTimer();
    this.clearSuggestions();
  }

  public handleClick(controls: { dismissEntry: () => void }): void {
    this.clearAcceptedSuggestionTransientState();
    this.entry.pendingGrammarPaste = false;
    controls.dismissEntry();
  }

  public handleBlur(controls: { dismissEntry: () => void }): void {
    this.clearAcceptedSuggestionTransientState();
    this.entry.isComposing = false;
    this.entry.pendingGrammarPaste = false;
    this.clearPendingIdleTimer();
    controls.dismissEntry();
  }

  public acceptSuggestionAtIndex(index: number): void {
    const suggestion = this.entry.suggestions[index];
    if (!suggestion) {
      return;
    }
    this.acceptSuggestion(suggestion);
  }

  public acceptSuggestion(suggestion: string): void {
    this.acceptSuggestionInternal(suggestion);
  }

  public reconcileSelection(controls: { dismissEntry: () => void }): void {
    if (!this.hasVisibleSuggestionState()) {
      return;
    }
    if (!this.isFocused()) {
      return;
    }
    if (TextTargetAdapter.isTextValue(this.entry.elem)) {
      if (!TextTargetAdapter.hasCollapsedSelection(this.entry.elem as TextTarget)) {
        controls.dismissEntry();
        return;
      }
    }
    if (!this.shouldCheckCaretContextOnSelectionChange()) {
      return;
    }
    if (this.entry.visibleSuggestionBeforeCursorText === null) {
      return;
    }

    if (!TextTargetAdapter.isTextValue(this.entry.elem)) {
      const blockContext = this.contentEditableAdapter.getBlockContext(this.entry.elem);
      const currentBeforeCursor = blockContext?.beforeCursor ?? "";
      const visibleBefore = this.entry.visibleSuggestionBeforeCursorText;
      const stillRelated =
        currentBeforeCursor === visibleBefore ||
        currentBeforeCursor.startsWith(visibleBefore) ||
        visibleBefore.startsWith(currentBeforeCursor);
      if (!stillRelated) {
        controls.dismissEntry();
      }
      return;
    }

    if (this.entry.visibleSuggestionFullText === null) {
      return;
    }
    const currentPredictionContext = this.resolveCurrentPredictionContext();
    if (currentPredictionContext.fullText !== this.entry.visibleSuggestionFullText) {
      return;
    }
    if (currentPredictionContext.beforeCursor === this.entry.visibleSuggestionBeforeCursorText) {
      return;
    }
    controls.dismissEntry();
  }

  private shouldWaitForInsertTextChange(
    pending: PendingKeyFallback,
    hasMultipleBlockDescendants: boolean,
    controls: {
      clearPendingFallback: () => void;
      rescheduleFallback: (delayMs: number) => void;
    },
  ): boolean {
    if (
      pending.inputAction !== "insert" ||
      pending.expectedBeforeCursor === null ||
      pending.waitForTextChangeUntilMs === null
    ) {
      return false;
    }

    const snapshot = TextTargetAdapter.snapshot(this.entry.elem as TextTarget);
    const currentFullText = `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const textChanged =
      pending.expectedFullText !== null && currentFullText !== pending.expectedFullText;
    const shouldReconcileEnterAtEmptyBoundary =
      pending.typedKey === "Enter" &&
      hasMultipleBlockDescendants &&
      this.contentEditableAdapter.isCollapsedSelectionBeforeBlockBoundary(this.entry.elem);
    if (textChanged) {
      const currentBeforeCursor = this.resolveBeforeCursorForPrediction(this.entry, {
        inputAction: pending.inputAction,
        hasMultipleBlockDescendants,
        typedKey: pending.typedKey,
        snapshot,
      });
      const caretContextAdvanced = currentBeforeCursor !== pending.expectedBeforeCursor;
      if (!caretContextAdvanced && !shouldReconcileEnterAtEmptyBoundary) {
        const remainingMs = pending.waitForTextChangeUntilMs - Date.now();
        if (remainingMs > 0) {
          pending.reconcileScheduled = false;
          controls.rescheduleFallback(
            Math.max(1, Math.min(INSERT_INPUT_FALLBACK_RETRY_INTERVAL_MS, remainingMs)),
          );
          return true;
        }
      }
      return false;
    }

    if (shouldReconcileEnterAtEmptyBoundary) {
      return false;
    }

    const remainingMs = pending.waitForTextChangeUntilMs - Date.now();
    if (remainingMs <= 0) {
      const isSeededBeforeCursor =
        typeof pending.typedKey === "string" &&
        pending.typedKey.length === 1 &&
        pending.expectedBeforeCursor === pending.typedKey;
      if (isSeededBeforeCursor) {
        controls.clearPendingFallback();
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
        controls.clearPendingFallback();
        return true;
      }

      return false;
    }

    if (remainingMs > 0) {
      pending.reconcileScheduled = false;
      controls.rescheduleFallback(
        Math.max(1, Math.min(INSERT_INPUT_FALLBACK_RETRY_INTERVAL_MS, remainingMs)),
      );
      return true;
    }

    return false;
  }

  private scheduleKeyFallbackReconcile(
    inputAction: PredictionInputAction,
    timeoutMs: number,
    observeMutations: boolean,
    typedKey: string | null,
    controls: {
      clearPendingFallback: () => void;
      storePendingFallback: (pending: PendingKeyFallback) => void;
      runReconcile: () => void;
    },
  ): void {
    controls.clearPendingFallback();
    const shouldWaitForTextChange = inputAction === "insert" && observeMutations;
    const currentSnapshot = TextTargetAdapter.snapshot(this.entry.elem as TextTarget);
    const currentBeforeCursor = this.resolveBeforeCursorForPrediction(this.entry, {
      snapshot: currentSnapshot,
    });
    const fallback: PendingKeyFallback = {
      timer: setTimeout(() => {
        controls.runReconcile();
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
        globalThis as typeof globalThis & { MutationObserver?: typeof MutationObserver }
      ).MutationObserver;
      if (typeof mutationObserverCtor === "function") {
        fallback.observer = new mutationObserverCtor(() => {
          if (fallback.reconcileScheduled) {
            return;
          }
          fallback.reconcileScheduled = true;
          void Promise.resolve().then(() => {
            controls.runReconcile();
          });
        });
        fallback.observer.observe(this.entry.elem, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
    }

    controls.storePendingFallback(fallback);
  }

  private tryDispatchResolvedContentEditableFallbackReconcile(
    pending: PendingKeyFallback,
    snapshot: SuggestionSnapshot,
    hasMultipleBlockDescendants: boolean,
  ): boolean {
    const typedKey = pending.typedKey;
    const isEligible =
      pending.inputAction === "insert" &&
      !TextTargetAdapter.isTextValue(this.entry.elem) &&
      typeof typedKey === "string" &&
      typedKey.length === 1;
    if (!isEligible) {
      return false;
    }

    const predictionBeforeCursor = this.resolveBeforeCursorForPrediction(this.entry, {
      hasMultipleBlockDescendants,
      inputAction: "insert",
      typedKey,
      snapshot,
    });
    const trailingChar = predictionBeforeCursor.charAt(predictionBeforeCursor.length - 1);
    const typedKeyMatched =
      trailingChar === typedKey || trailingChar === typedKey.toLocaleUpperCase();
    if (!typedKeyMatched) {
      return false;
    }

    const predictionContext = (() => {
      try {
        return this.resolveEditableCursorContext(this.entry, snapshot, {
          hasMultipleBlockDescendants,
          inputAction: "insert",
          typedKey: pending.typedKey,
        });
      } catch {
        return null;
      }
    })();

    if (!predictionContext) {
      this.entry.lastInputAction = "insert";
      this.entry.lastKeydownKey = null;
      this.entry.lastBeforeCursorText = predictionBeforeCursor;
      this.entry.pendingGrammarPaste = false;
      const tokenInfo = this.predictionCoordinator.findMentionToken(predictionBeforeCursor);
      this.entry.latestMentionText = tokenInfo.token;
      this.entry.latestMentionStart = -1;
      this.predictionCoordinator.reconcile(this.entry, {
        clearSuggestions: () => this.clearSuggestions(),
        inputAction: "insert",
        beforeCursorOverride: predictionBeforeCursor,
        afterCursorOverride: "",
      });
      this.scheduleIdleGrammar();
      return true;
    }

    const grammarEdit = predictionContext.safeForGrammar
      ? this.grammarCoordinator.run({
          beforeCursor: predictionContext.beforeCursor,
          afterCursor: predictionContext.afterCursor,
          inputAction: "insert",
          triggers: this.resolveLocalGrammarTriggers(undefined, predictionContext.beforeCursor),
        })
      : null;
    const grammarReplacement =
      grammarEdit && typeof grammarEdit.replacement === "string" ? grammarEdit.replacement : "";
    const grammarDeleteBackwards =
      grammarEdit && Number.isFinite(grammarEdit.deleteBackwards)
        ? Math.max(0, grammarEdit.deleteBackwards)
        : 0;

    if (grammarEdit) {
      const applyResult = this.textEditService.applyGrammarEdit(this.entry, grammarEdit, {
        snapshot: predictionContext.snapshot,
        contentEditableContext: predictionContext.applyContext,
      });
      if (
        this.dispatchAdjustedGrammarPrediction({
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
        return true;
      }
      if (applyResult.applied && applyResult.didDispatchInput) {
        return true;
      }
    }

    this.entry.lastInputAction = "insert";
    this.entry.lastKeydownKey = null;
    this.entry.lastBeforeCursorText = predictionBeforeCursor;
    this.entry.pendingGrammarPaste = false;
    const tokenInfo = this.predictionCoordinator.findMentionToken(predictionBeforeCursor);
    this.entry.latestMentionText = tokenInfo.token;
    this.entry.latestMentionStart = -1;
    this.predictionCoordinator.reconcile(this.entry, {
      clearSuggestions: () => this.clearSuggestions(),
      inputAction: "insert",
      beforeCursorOverride: predictionBeforeCursor,
      afterCursorOverride: predictionContext.afterCursor,
    });
    this.scheduleIdleGrammar();
    return true;
  }

  private resolveCurrentPredictionContext(): { beforeCursor: string; fullText: string } {
    const snapshot = TextTargetAdapter.snapshot(this.entry.elem as TextTarget);
    const context = this.resolveEditableCursorContext(this.entry, snapshot);
    return {
      beforeCursor: context.beforeCursor,
      fullText: `${snapshot.beforeCursor}${snapshot.afterCursor}`,
    };
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
      {
        inputAction,
        hasMultipleBlockDescendants,
        typedKey,
      },
    ).beforeCursor;
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
    details: { predictionMode: "schedule" | "reconcile"; typedKey?: string | null },
  ): void {
    const selection = window.getSelection();
    logger.debug("Skipping prediction for unstable input state", {
      suggestionId: entry.id,
      reason,
      predictionMode: details.predictionMode,
      typedKey: details.typedKey,
      selectionRangeCount: selection?.rangeCount ?? 0,
      selectionCollapsed: selection?.isCollapsed ?? true,
    });
  }

  private shouldForceImmediatePunctuationRequest(
    beforeCursor: string,
    inputAction: PredictionInputAction,
  ): boolean {
    return inputAction === "insert" && DUPLICATE_PUNCTUATION_TAIL_REGEX.test(beforeCursor);
  }

  private processEntryAfterEdit({
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
  }): void {
    const processingStartedAt =
      typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
    const unstableInputSkipReason = this.resolveUnstableInputSkipReason(this.entry, event);
    const allowPredictionWithNonCollapsedSelection =
      unstableInputSkipReason === "selection_not_collapsed" &&
      this.shouldAllowContentEditableFallbackPredictionWithNonCollapsedSelection(this.entry, {
        hasMultipleBlockDescendants,
        inputAction: inputActionOverride,
        predictionMode,
        typedKey,
      });
    if (unstableInputSkipReason && !allowPredictionWithNonCollapsedSelection) {
      this.logSkippedPredictionForUnstableInputState(this.entry, unstableInputSkipReason, {
        predictionMode,
        typedKey,
      });
      this.handleSuppressedInput();
      return;
    }

    const isTextValueTarget = TextTargetAdapter.isTextValue(this.entry.elem);
    let snapshotDurationMs = 0;
    let snapshot: SuggestionSnapshot | null =
      snapshotOverride ??
      (isTextValueTarget ||
      this.grammarCoordinator.hasEnabledRules() ||
      this.entry.manualAutoFixSuppression !== null ||
      this.entry.pendingExtensionEdit !== null
        ? (() => {
            const startedAt =
              typeof globalThis.performance?.now === "function"
                ? globalThis.performance.now()
                : Date.now();
            const resolved = TextTargetAdapter.snapshot(this.entry.elem as TextTarget);
            snapshotDurationMs =
              (typeof globalThis.performance?.now === "function"
                ? globalThis.performance.now()
                : Date.now()) - startedAt;
            return resolved;
          })()
        : null);

    if (snapshot) {
      this.textEditService.syncManualAutoFixSuppression(this.entry, snapshot);
      if (this.entry.pendingExtensionEdit && !this.shouldPreservePendingExtensionEdit(snapshot)) {
        this.clearPendingExtensionEdit();
      }
      this.syncAcceptedSuggestionTrailingSpaceState();
    }

    const resolvedHasMultipleBlockDescendants =
      hasMultipleBlockDescendants ?? this.resolveHasMultipleBlockDescendants();
    const provisionalStartedAt =
      typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
    const provisionalContext = this.resolveEditableCursorContext(this.entry, snapshot, {
      hasMultipleBlockDescendants: resolvedHasMultipleBlockDescendants,
      typedKey,
    });
    const provisionalContextDurationMs =
      (typeof globalThis.performance?.now === "function"
        ? globalThis.performance.now()
        : Date.now()) - provisionalStartedAt;
    const inputAction =
      inputActionOverride ??
      this.resolveInputAction(event ?? new Event("input"), provisionalContext.beforeCursor);
    const predictionStartedAt =
      typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
    const cursorContext = this.resolveEditableCursorContext(this.entry, snapshot, {
      hasMultipleBlockDescendants: resolvedHasMultipleBlockDescendants,
      inputAction,
      typedKey,
    });
    const predictionContextDurationMs =
      (typeof globalThis.performance?.now === "function"
        ? globalThis.performance.now()
        : Date.now()) - predictionStartedAt;
    const grammarEdit =
      !allowPredictionWithNonCollapsedSelection && cursorContext.safeForGrammar
        ? this.grammarCoordinator.run({
            beforeCursor: cursorContext.beforeCursor,
            afterCursor: cursorContext.afterCursor,
            inputAction,
            triggers: this.resolveLocalGrammarTriggers(event, cursorContext.beforeCursor),
          })
        : null;

    if (grammarEdit) {
      const grammarReplacement =
        typeof grammarEdit.replacement === "string" ? grammarEdit.replacement : "";
      const grammarDeleteBackwards = Number.isFinite(grammarEdit.deleteBackwards)
        ? Math.max(0, grammarEdit.deleteBackwards)
        : 0;
      const applyResult = this.textEditService.applyGrammarEdit(this.entry, grammarEdit, {
        snapshot: cursorContext.snapshot,
        contentEditableContext: cursorContext.applyContext,
      });
      if (applyResult.applied) {
        this.clearSuggestions();
        if (applyResult.didDispatchInput) {
          if (
            !TextTargetAdapter.isTextValue(this.entry.elem) &&
            predictionMode === "reconcile" &&
            this.dispatchAdjustedGrammarPrediction({
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
          this.clearPendingIdleTimer();
          this.entry.lastInputAction = inputAction;
          this.entry.lastKeydownKey = null;
          this.entry.pendingGrammarPaste = false;
          return;
        }

        snapshot = TextTargetAdapter.snapshot(this.entry.elem as TextTarget);
        if (this.shouldSkipPredictionForUnstableInputState(this.entry)) {
          this.handleSuppressedInput();
          return;
        }
        this.textEditService.syncManualAutoFixSuppression(this.entry, snapshot);
        if (this.entry.pendingExtensionEdit && !this.shouldPreservePendingExtensionEdit(snapshot)) {
          this.clearPendingExtensionEdit();
        }
        this.syncAcceptedSuggestionTrailingSpaceState();

        if (
          this.dispatchAdjustedGrammarPrediction({
            beforeCursor: cursorContext.beforeCursor,
            afterCursor: cursorContext.afterCursor,
            grammarReplacement,
            grammarDeleteBackwards,
            inputAction,
            predictionMode,
            scheduleIdle,
            isTextValue: TextTargetAdapter.isTextValue(this.entry.elem),
          })
        ) {
          return;
        }
      } else if (
        this.dispatchAdjustedGrammarPrediction({
          beforeCursor: TextTargetAdapter.isTextValue(this.entry.elem)
            ? cursorContext.snapshot.beforeCursor
            : cursorContext.beforeCursor,
          afterCursor: TextTargetAdapter.isTextValue(this.entry.elem)
            ? cursorContext.snapshot.afterCursor
            : cursorContext.afterCursor,
          grammarReplacement,
          grammarDeleteBackwards,
          inputAction,
          predictionMode,
          scheduleIdle,
          isTextValue: TextTargetAdapter.isTextValue(this.entry.elem),
        })
      ) {
        return;
      }
    }

    const predictionContext = this.resolveEditableCursorContext(this.entry, snapshot, {
      hasMultipleBlockDescendants: resolvedHasMultipleBlockDescendants,
      inputAction,
      typedKey,
    });
    const predictionBeforeCursor = predictionContext.beforeCursor;
    const predictionAfterCursor = predictionContext.afterCursor;
    this.entry.lastInputAction = inputAction;
    this.entry.lastKeydownKey = null;
    this.entry.lastBeforeCursorText = predictionBeforeCursor;
    this.entry.pendingGrammarPaste = false;

    const tokenInfo = this.predictionCoordinator.findMentionToken(predictionBeforeCursor);
    this.entry.latestMentionText = tokenInfo.token;
    this.entry.latestMentionStart = TextTargetAdapter.isTextValue(this.entry.elem)
      ? tokenInfo.start
      : -1;

    if (this.inlineSuggestionEnabled) {
      this.renderInline();
    }

    if (predictionMode === "reconcile") {
      this.predictionCoordinator.reconcile(this.entry, {
        clearSuggestions: () => this.clearSuggestions(),
        inputAction,
        beforeCursorOverride: predictionBeforeCursor,
        afterCursorOverride: predictionAfterCursor,
      });
    } else {
      this.predictionCoordinator.schedule(this.entry, {
        force: this.shouldForceImmediatePunctuationRequest(predictionBeforeCursor, inputAction),
        clearSuggestions: () => this.clearSuggestions(),
        inputAction,
        beforeCursorOverride: predictionBeforeCursor,
        afterCursorOverride: predictionAfterCursor,
      });
    }

    if (scheduleIdle) {
      this.scheduleIdleGrammar();
    }

    const totalProcessingDurationMs =
      (typeof globalThis.performance?.now === "function"
        ? globalThis.performance.now()
        : Date.now()) - processingStartedAt;
    if (!isTextValueTarget && totalProcessingDurationMs >= SLOW_INPUT_PROCESSING_LOG_THRESHOLD_MS) {
      logger.debug("Slow contenteditable input processing", {
        suggestionId: this.entry.id,
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

  private dispatchAdjustedGrammarPrediction({
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
  }): boolean {
    if (!(grammarReplacement.length > 0 || grammarDeleteBackwards > 0)) {
      return false;
    }
    const adjustedBeforeCursor =
      beforeCursor.slice(0, Math.max(0, beforeCursor.length - grammarDeleteBackwards)) +
      grammarReplacement;
    this.entry.lastInputAction = inputAction;
    this.entry.lastKeydownKey = null;
    this.entry.lastBeforeCursorText = adjustedBeforeCursor;
    this.entry.pendingGrammarPaste = false;

    const tokenInfo = this.predictionCoordinator.findMentionToken(adjustedBeforeCursor);
    this.entry.latestMentionText = tokenInfo.token;
    this.entry.latestMentionStart = isTextValue ? tokenInfo.start : -1;

    if (predictionMode === "reconcile") {
      this.predictionCoordinator.reconcile(this.entry, {
        clearSuggestions: () => this.clearSuggestions(),
        inputAction,
        beforeCursorOverride: adjustedBeforeCursor,
        afterCursorOverride: afterCursor,
      });
    } else {
      this.predictionCoordinator.schedule(this.entry, {
        force: false,
        clearSuggestions: () => this.clearSuggestions(),
        inputAction,
        beforeCursorOverride: adjustedBeforeCursor,
        afterCursorOverride: afterCursor,
      });
    }

    if (scheduleIdle) {
      this.scheduleIdleGrammar();
    }

    return true;
  }

  private acceptSuggestionInternal(suggestion: string): void {
    this.entry.suppressNextSuggestionInputPrediction = true;
    const accepted = this.textEditService.acceptSuggestion(this.entry, suggestion);
    if (!accepted) {
      this.entry.suppressNextSuggestionInputPrediction = false;
      return;
    }
    this.finishAcceptedSuggestion(
      accepted.triggerText,
      accepted.insertedText,
      accepted.cursorAfter,
      accepted.cursorAfterIsBlockLocal,
    );
  }

  private finishAcceptedSuggestion(
    triggerText: string,
    insertedText: string,
    cursorAfter: number,
    cursorAfterIsBlockLocal: boolean,
  ): void {
    this.clearPendingFallback();
    this.predictionCoordinator.cancelPending(this.entry);
    this.clearPendingRequestTimer();
    this.clearPendingIdleTimer();
    this.entry.requestId += 1;
    this.entry.lastKeydownKey = null;
    this.entry.lastBeforeCursorText = null;
    this.entry.latestMentionText = "";
    this.entry.latestMentionStart = TextTargetAdapter.isTextValue(this.entry.elem) ? 0 : -1;
    this.entry.pendingGrammarPaste = false;
    this.clearSuggestions();
    logger.debug("Accepted suggestion state armed", {
      suggestionId: this.entry.id,
      requestId: this.entry.requestId,
      cursorAfter,
      cursorAfterIsBlockLocal,
      triggerLength: triggerText.length,
      insertedLength: insertedText.length,
      hasPendingExtensionEdit: this.entry.pendingExtensionEdit !== null,
      pendingExtensionEditSource: this.entry.pendingExtensionEdit?.source ?? null,
      pendingExtensionEditBlockScoped: this.entry.pendingExtensionEdit?.blockScoped ?? false,
      recentInteractionTrail: this.entry.recentInteractionTrail.slice(),
      pendingEditCaretTrace:
        this.entry.pendingExtensionEdit !== null
          ? buildCaretTrace(
              (
                this.entry.pendingExtensionEdit.postEditBlockText ??
                this.entry.pendingExtensionEdit.postEditFingerprint.fullText
              ).slice(0, this.entry.pendingExtensionEdit.cursorAfter),
              (
                this.entry.pendingExtensionEdit.postEditBlockText ??
                this.entry.pendingExtensionEdit.postEditFingerprint.fullText
              ).slice(this.entry.pendingExtensionEdit.cursorAfter),
            )
          : null,
      activeBlockTrace: this.buildActiveBlockTrace(),
    });
    const shouldExpectTrailingSpace =
      this.insertSpaceAfterAutocomplete && !/[ \xA0]$/.test(insertedText);
    this.entry.missingTrailingSpace = shouldExpectTrailingSpace;
    this.entry.expectedCursorPos = shouldExpectTrailingSpace ? cursorAfter : 0;
    this.entry.expectedCursorPosIsBlockLocal = shouldExpectTrailingSpace && cursorAfterIsBlockLocal;
    this.entry.expectedCursorPosBlockElement =
      shouldExpectTrailingSpace && cursorAfterIsBlockLocal
        ? (this.entry.pendingExtensionEdit?.blockElement ?? null)
        : null;
    this.entry.expectedCursorPosBlockText =
      shouldExpectTrailingSpace && cursorAfterIsBlockLocal
        ? (this.entry.pendingExtensionEdit?.postEditBlockText ?? null)
        : null;
    this.recordSuggestionAccepted({
      triggerText,
      insertedText,
      language: this.getLang(),
    });
  }

  private clearPendingExtensionEdit(): void {
    this.entry.pendingExtensionEdit = null;
  }

  private clearAcceptedSuggestionTransientState(): void {
    this.clearPendingExtensionEdit();
    this.entry.missingTrailingSpace = false;
    this.entry.expectedCursorPos = 0;
    this.entry.expectedCursorPosIsBlockLocal = false;
    this.entry.expectedCursorPosBlockElement = null;
    this.entry.expectedCursorPosBlockText = null;
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

  private shouldScheduleInsertFallback(event: KeyboardEvent): boolean {
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
      return !TextTargetAdapter.isInput(this.entry.elem);
    }
    return event.key.length === 1;
  }

  private resolveHasMultipleBlockDescendants(): boolean {
    if (TextTargetAdapter.isTextValue(this.entry.elem)) {
      return false;
    }
    if (this.entry.hasMultipleBlockDescendants) {
      return true;
    }
    const hasMultipleBlockDescendants = this.contentEditableAdapter.hasMultipleBlockDescendants(
      this.entry.elem,
    );
    if (hasMultipleBlockDescendants) {
      this.entry.hasMultipleBlockDescendants = true;
    }
    return hasMultipleBlockDescendants;
  }

  private resolveInputAction(event: Event, currentBeforeCursor: string): PredictionInputAction {
    const inputEvent = event as Event & { inputType?: unknown };
    const inputType = typeof inputEvent.inputType === "string" ? inputEvent.inputType : "";
    if (inputType.startsWith("delete")) {
      return "delete";
    }
    if (inputType.startsWith("insert")) {
      return "insert";
    }
    if (this.entry.lastKeydownKey === "Backspace" || this.entry.lastKeydownKey === "Delete") {
      return "delete";
    }
    const previousBeforeCursor = this.entry.lastBeforeCursorText;
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

  private resolveLocalGrammarTriggers(
    event: Event | undefined,
    beforeCursor: string,
  ): import("@core/domain/grammar/types").GrammarEventType[] {
    if (!this.grammarCoordinator.hasEnabledRules()) {
      return [];
    }
    const triggers: import("@core/domain/grammar/types").GrammarEventType[] = [];
    const inputType =
      typeof (event as InputEvent | undefined)?.inputType === "string"
        ? (event as InputEvent).inputType
        : "";
    if (
      this.entry.pendingGrammarPaste ||
      inputType === "insertFromPaste" ||
      event?.type === "paste"
    ) {
      triggers.push("paste");
    }
    const lastChar = beforeCursor.charAt(beforeCursor.length - 1);
    triggers.push(
      beforeCursor.length > 0 && SPACE_CHARS.includes(lastChar) ? "wordBoundary" : "insertChar",
    );
    return triggers;
  }

  private shouldPreservePendingExtensionEdit(snapshot: SuggestionSnapshot): boolean {
    const pendingEdit = this.entry.pendingExtensionEdit;
    if (!pendingEdit) {
      return false;
    }
    if (
      pendingEdit.blockScoped &&
      !TextTargetAdapter.isTextValue(this.entry.elem) &&
      (this.entry.elem as HTMLElement).isContentEditable
    ) {
      const activeBlock = this.contentEditableAdapter.getActiveBlockElement(
        this.entry.elem as HTMLElement,
      );
      const blockContext = this.contentEditableAdapter.getBlockContext(
        this.entry.elem as HTMLElement,
      );
      if (
        !blockContext ||
        !TextTargetAdapter.hasCollapsedSelection(this.entry.elem as TextTarget)
      ) {
        return false;
      }
      const blockFullText = `${blockContext.beforeCursor}${blockContext.afterCursor}`;
      return (
        activeBlock !== null &&
        activeBlock === (pendingEdit.blockElement ?? null) &&
        blockFullText === (pendingEdit.postEditBlockText ?? "") &&
        blockContext.beforeCursor.length >= pendingEdit.replaceStart &&
        blockContext.beforeCursor.length <= pendingEdit.cursorAfter
      );
    }
    if (
      !TextTargetAdapter.isTextValue(this.entry.elem) &&
      pendingEdit.source === "grammar" &&
      TextTargetAdapter.hasCollapsedSelection(this.entry.elem as TextTarget)
    ) {
      const actualFingerprint = TextTargetAdapter.createPostEditFingerprint(
        this.entry.elem as TextTarget,
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
      this.entry.elem as TextTarget,
      pendingEdit.postEditFingerprint,
      snapshot,
    );
  }

  private syncAcceptedSuggestionTrailingSpaceState(): void {
    if (!this.entry.missingTrailingSpace || !this.entry.expectedCursorPosIsBlockLocal) {
      return;
    }
    if (TextTargetAdapter.isTextValue(this.entry.elem)) {
      return;
    }
    const activeBlock = this.contentEditableAdapter.getActiveBlockElement(
      this.entry.elem as HTMLElement,
    );
    const blockContext = this.contentEditableAdapter.getBlockContext(
      this.entry.elem as HTMLElement,
    );
    if (
      !activeBlock ||
      !blockContext ||
      activeBlock !== this.entry.expectedCursorPosBlockElement ||
      `${blockContext.beforeCursor}${blockContext.afterCursor}` !==
        (this.entry.expectedCursorPosBlockText ?? "") ||
      blockContext.beforeCursor.length !== this.entry.expectedCursorPos
    ) {
      this.clearAcceptedSuggestionTransientState();
    }
  }

  private shouldDeferContentEditableInputToFallback(context: {
    beforeCursor: string;
    fullText: string;
    kind: "text-value" | "contenteditable";
  }): boolean {
    if (context.kind === "text-value" || TextTargetAdapter.isTextValue(this.entry.elem)) {
      return false;
    }
    const pending = this.getPendingFallback();
    if (!pending || pending.inputAction !== "insert") {
      return false;
    }
    if (
      typeof pending.expectedBeforeCursor !== "string" ||
      typeof pending.expectedFullText !== "string"
    ) {
      return false;
    }
    if (context.fullText === pending.expectedFullText) {
      return pending.waitForTextChangeUntilMs !== null;
    }
    const currentBeforeCursor = this.resolveBeforeCursorForPrediction(this.entry);
    return currentBeforeCursor === pending.expectedBeforeCursor;
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
    applyContext: { beforeCursor: string; afterCursor: string; useFullTextOffsets: boolean } | null;
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
      return {
        beforeCursor: "",
        afterCursor: "",
        snapshot:
          snapshot ??
          ({ beforeCursor: "", afterCursor: "", cursorOffset: 0 } satisfies SuggestionSnapshot),
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
      hasMultipleBlockDescendants ?? this.resolveHasMultipleBlockDescendants();
    const useFullTextOffsets =
      blockContext.beforeCursor.length === 0 &&
      blockContext.afterCursor.length === 0 &&
      beforeBlockBoundary;
    if (useFullTextOffsets) {
      const previousBlockFallback = resolvedHasMultipleBlockDescendants
        ? this.contentEditableAdapter.getPreviousBlockTextBySelection(entry.elem)
        : null;
      return {
        beforeCursor: previousBlockFallback ?? "",
        afterCursor: "",
        snapshot:
          snapshot ??
          ({ beforeCursor: "", afterCursor: "", cursorOffset: 0 } satisfies SuggestionSnapshot),
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
          : rawAfterCursor.length > 0
            ? rawAfterCursor
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

  private scheduleIdleGrammar(): void {
    if (!this.grammarCoordinator.hasEnabledRules()) {
      return;
    }
    this.clearPendingIdleTimer();
    this.entry.pendingIdleTimer = setTimeout(() => {
      this.entry.pendingIdleTimer = null;
      this.runIdleGrammar();
    }, LOCAL_GRAMMAR_IDLE_DELAY_MS);
  }

  private runIdleGrammar(): void {
    if (!this.isFocused() || this.shouldSkipPredictionForUnstableInputState(this.entry)) {
      return;
    }
    const snapshot = TextTargetAdapter.snapshot(this.entry.elem as TextTarget);
    const grammarContext = this.resolveEditableCursorContext(this.entry, snapshot);
    const grammarEdit = grammarContext.safeForGrammar
      ? this.grammarCoordinator.run({
          beforeCursor: grammarContext.beforeCursor,
          afterCursor: grammarContext.afterCursor,
          inputAction: this.entry.lastInputAction ?? "other",
          triggers: ["idle"],
        })
      : null;
    if (!grammarEdit) {
      return;
    }
    const applyResult = this.textEditService.applyGrammarEdit(this.entry, grammarEdit, {
      snapshot: grammarContext.snapshot,
      contentEditableContext: grammarContext.applyContext,
    });
    if (!applyResult.applied) {
      return;
    }
    this.clearSuggestions();
    if (applyResult.didDispatchInput) {
      return;
    }
    const updatedSnapshot = TextTargetAdapter.snapshot(this.entry.elem as TextTarget);
    const predictionContext = this.resolveEditableCursorContext(this.entry, updatedSnapshot);
    this.predictionCoordinator.schedule(this.entry, {
      force: true,
      clearSuggestions: () => this.clearSuggestions(),
      inputAction: this.entry.lastInputAction ?? "other",
      beforeCursorOverride: predictionContext.beforeCursor,
      afterCursorOverride: predictionContext.afterCursor,
    });
  }

  private handleSuppressedInput(): void {
    this.clearPendingIdleTimer();
    this.entry.requestId += 1;
    this.entry.lastInputAction = null;
    this.entry.lastKeydownKey = null;
    this.entry.pendingGrammarPaste = false;
    this.entry.lastBeforeCursorText = null;
    this.entry.visibleSuggestionBeforeCursorText = null;
    this.entry.visibleSuggestionFullText = null;
    this.clearSuggestions();
  }

  private suppressAcceptedSuggestionInput(): void {
    this.clearPendingIdleTimer();
    this.entry.lastInputAction = null;
    this.entry.lastKeydownKey = null;
    this.entry.lastBeforeCursorText = null;
    this.entry.pendingGrammarPaste = false;
    this.entry.visibleSuggestionBeforeCursorText = null;
    this.entry.visibleSuggestionFullText = null;
    this.clearSuggestions();
  }

  private pushInteractionTrace(step: string): void {
    if (typeof step !== "string" || step.length === 0) {
      return;
    }
    this.entry.recentInteractionTrail.push(step);
    if (this.entry.recentInteractionTrail.length > INTERACTION_TRACE_LIMIT) {
      this.entry.recentInteractionTrail.splice(
        0,
        this.entry.recentInteractionTrail.length - INTERACTION_TRACE_LIMIT,
      );
    }
  }

  private describeKeyboardInteraction(event: KeyboardEvent): string {
    const modifiers = [
      event.ctrlKey ? "Ctrl" : "",
      event.metaKey ? "Meta" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
    ].filter(Boolean);
    const prefix = modifiers.length > 0 ? `${modifiers.join("+")}+` : "";
    return `keydown:${prefix}${event.key}`;
  }

  private describeInputInteraction(event: Event): string {
    const inputEvent = event as InputEvent;
    const inputType =
      typeof inputEvent.inputType === "string" && inputEvent.inputType.length > 0
        ? inputEvent.inputType
        : event.type;
    const data =
      typeof inputEvent.data === "string" && inputEvent.data.length > 0
        ? clipTraceText(collapseTraceWhitespace(inputEvent.data), 12, "start")
        : "";
    return data ? `input:${inputType}:${data}` : `input:${inputType}`;
  }

  private buildActiveBlockTrace(): Record<string, unknown> | null {
    if (TextTargetAdapter.isTextValue(this.entry.elem)) {
      return null;
    }
    const activeBlock = this.contentEditableAdapter.getActiveBlockElement(
      this.entry.elem as HTMLElement,
    );
    const blockContext = this.contentEditableAdapter.getBlockContext(
      this.entry.elem as HTMLElement,
    );
    if (!activeBlock || !blockContext) {
      return null;
    }
    const className =
      typeof activeBlock.className === "string"
        ? collapseTraceWhitespace(activeBlock.className)
        : "";
    return {
      tagName: activeBlock.tagName.toLowerCase(),
      id: activeBlock.id || null,
      className: className || null,
      textLength: (activeBlock.textContent ?? "").length,
      caretTrace: buildCaretTrace(blockContext.beforeCursor, blockContext.afterCursor),
      textPreview: clipTraceText(
        collapseTraceWhitespace(activeBlock.textContent ?? ""),
        CARET_TRACE_TEXT_LIMIT * 2,
      ),
      htmlPreview: clipTraceText(collapseTraceWhitespace(activeBlock.outerHTML), 180, "start"),
    };
  }

  private resolveInputType(event: Event): string {
    return typeof (event as InputEvent).inputType === "string"
      ? (event as InputEvent).inputType
      : "";
  }

  private shouldCheckCaretContextOnSelectionChange(): boolean {
    return this.entry.lastKeydownKey === null;
  }

  private hasVisibleSuggestionState(): boolean {
    return this.entry.suggestions.length > 0 || this.entry.inlineSuggestion !== null;
  }
}
