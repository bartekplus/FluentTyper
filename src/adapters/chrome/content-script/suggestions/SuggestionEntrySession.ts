import { editorCapabilities } from "./EditorCapabilities";
import { resolveCodeContext } from "./CodeContextResolver";
import { isCredentialField } from "./FieldEligibility";
import { isSearchField } from "./NativeAutocompleteConflictDetector";
import { suggestionLanguageLabel } from "@core/domain/suggestionPopup/markup";
import { createLogger } from "@core/application/logging/Logger";
import type { GrammarEdit, GrammarEventType } from "@core/domain/grammar/types";
import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import type { PredictionInputAction } from "@core/domain/messageTypes";
import { SPACE_CHARS, SPACING_OR_FILLER_CHARS } from "@core/domain/spacingRules";
import {
  inputTypeOf,
  resolveEditableCursorContext as resolveEditableCursorContextHelper,
  resolvePredictionInputAction,
} from "./SuggestionEntryPredictionContext";
import {
  clearAcceptedSuggestionTransientState as clearAcceptedSuggestionTransientEntryState,
  resolveAcceptedSuggestionSpaceState,
  resolveLiveBlockScopedEdit,
  shouldDismissSuggestionsOnKeydown,
  shouldInvalidatePendingExtensionEditOnKeydown,
  shouldReleaseAcceptedSuggestionSuppressionOnKeydown,
  syncAcceptedSuggestionTrailingSpaceState,
} from "./SuggestionAcceptedState";
import { rangeInsideTarget, TextTargetAdapter } from "./TextTargetAdapter";
import {
  nextLiveGrammarProposal,
  sameLiveProposal,
  type SeenLiveProposals,
} from "@core/domain/grammar/review/liveProposalSelection";
import { measurementEditingContext } from "./MeasurementEditingContext";
import { normalizeGrammarEdit } from "./SuggestionTextEditService";
import {
  buildCaretTrace,
  buildElementSnapshot,
  clipTraceText,
  collapseTraceWhitespace,
} from "./traceUtils";
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
const SPACING_OR_FILLER_PATTERN = `(?:${SPACING_OR_FILLER_CHARS.join("|")})`;
const DUPLICATE_PUNCTUATION_TAIL_REGEX = new RegExp(
  `[,;:](?:${SPACING_OR_FILLER_PATTERN})*[,;:](?:${SPACING_OR_FILLER_PATTERN})*$`,
);
const logger = createLogger("SuggestionEntrySession");

/**
 * Plain Enter and Shift+Enter both commit the line — one submits or inserts a
 * newline, the other inserts a soft break — so both are word boundaries.
 * Ctrl/Cmd/Alt+Enter is an application chord that may not touch the text at
 * all, and capitalizing behind a chord that did nothing would be a surprise.
 */
function shouldRunEnterWordBoundaryGrammar(event: KeyboardEvent, entryComposing: boolean): boolean {
  return (
    event.key === "Enter" &&
    !event.isComposing &&
    !entryComposing &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

type ResolvedSessionOptions = SuggestionEntrySessionOptions &
  Required<
    Pick<
      SuggestionEntrySessionOptions,
      | "canInteract"
      | "onPauseChange"
      | "clearPendingFallback"
      | "getPendingFallback"
      | "recordPersonalizationAccepted"
    >
  >;

export class SuggestionEntrySession {
  private readonly entry: SuggestionEntry;
  private readonly options: ResolvedSessionOptions;
  private paused = false;
  private interactionGeneration = 0;
  private protectedBeforeCursor: string | null = null;
  private lastAcceptedSuggestion: string | null = null;
  private deferredInput: Event | null = null;
  // Snippet expansions among the current suggestions: never learned as words.
  private snippetSuggestions = new Set<string>();
  private snippetShortcuts: Array<string | null> | undefined;
  // Grammar proposals already shown, dismissed or in the text before typing; never offered again.
  private seenGrammarProposals: SeenLiveProposals | null = null;
  // Proposal reads answer in order, so the first one (what the field held) lands first.
  private grammarProposalQueue: Promise<void> = Promise.resolve();
  // Bumped by every edit: an answer for text that has changed since is not shown.
  private grammarProposalToken = 0;
  // The text before the caret the shown proposal was found in.
  private grammarProposalText: string | null = null;

  constructor(options: SuggestionEntrySessionOptions) {
    this.entry = options.entry;
    this.options = {
      ...options,
      canInteract: options.canInteract ?? (() => true),
      onPauseChange: options.onPauseChange ?? (() => undefined),
      clearPendingFallback: options.clearPendingFallback ?? (() => undefined),
      getPendingFallback: options.getPendingFallback ?? (() => undefined),
      recordPersonalizationAccepted: options.recordPersonalizationAccepted ?? (() => ""),
    };
  }

  private predictionContext: ReturnType<typeof resolveCodeContext> | null = null;

  /** A temporary website interaction never tears down the typing session. */
  public refreshInteraction(): boolean {
    const context = isCredentialField(this.entry.elem)
      ? "protected"
      : resolveCodeContext(this.entry.elem);
    const contextChanged =
      this.predictionContext !== null &&
      context !== "unknown" &&
      this.predictionContext !== "unknown" &&
      context !== this.predictionContext;
    if (contextChanged) {
      this.interactionGeneration += 1;
      this.grammarProposalToken += 1;
      this.entry.requestId += 1;
      this.options.predictionCoordinator.cancelPending(this.entry);
      this.clearSuggestions();
    }
    if (context !== "unknown") this.predictionContext = context;
    const paused = !this.options.canInteract();
    if (paused !== this.paused) {
      this.interactionGeneration += 1;
      this.protectedBeforeCursor = !editorCapabilities(this.entry.elem).inspectProse
        ? null
        : TextTargetAdapter.snapshot(this.entry.elem).beforeCursor;
      this.paused = paused;
      this.options.onPauseChange(paused);
      this.entry.requestId += 1;
      this.grammarProposalToken += 1;
      this.options.predictionCoordinator.cancelPending(this.entry);
      this.clearPendingIdleTimer();
      this.options.clearPendingFallback();
      this.clearSuggestions();
      this.clearAcceptedSuggestionTransientState();
      this.entry.suppressNextSuggestionInputPrediction = false;
      this.entry.pendingGrammarPaste = false;
      this.seenGrammarProposals = null;
    }
    if (paused) {
      // Track a baseline only; input received while yielding must never be replayed.
      this.entry.lastBeforeCursorText = !editorCapabilities(this.entry.elem).inspectProse
        ? null
        : TextTargetAdapter.snapshot(this.entry.elem).beforeCursor;
      this.entry.lastKeydownKey = null;
    }
    return !paused && !this.entry.isComposing;
  }

  public allowsAutomaticEdit(edit: GrammarEdit): boolean {
    if (!this.refreshInteraction()) return false;
    if (this.protectedBeforeCursor === null) return true;
    const beforeCursor = TextTargetAdapter.snapshot(this.entry.elem).beforeCursor;
    if (!beforeCursor.startsWith(this.protectedBeforeCursor)) {
      // A caret move/replacement starts a new baseline; never replay the site's text.
      this.protectedBeforeCursor = beforeCursor;
      return false;
    }
    // ponytail: after yielding, forward deletes stay off; track edited ranges if this proves restrictive.
    return (
      edit.deleteBackwards <= beforeCursor.length - this.protectedBeforeCursor.length &&
      !(edit.deleteForwards ?? 0)
    );
  }

  public requestPrediction(): void {
    if (!this.refreshInteraction()) return;
    const snapshot = TextTargetAdapter.snapshot(this.entry.elem);
    const context = this.resolveEditableCursorContext(this.entry, snapshot);
    this.options.predictionCoordinator.schedule(this.entry, {
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
    if (!this.refreshInteraction()) return;
    // What is already written when the field is entered is not "just typed".
    if (this.seenGrammarProposals === null) this.readGrammarProposals(false);
    if (!this.options.inlineSuggestionEnabled) {
      return;
    }
    // A focus re-render doesn't change what Tab may do with the current suggestions.
    const rejected = this.entry.inlineRenderRejected;
    this.options.renderInline();
    this.entry.inlineRenderRejected = rejected;
  }

  public handlePaste(): void {
    if (!this.refreshInteraction()) return;
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

    if (
      shouldReleaseAcceptedSuggestionSuppressionOnKeydown({
        event: keyboardEvent,
        suppressNextSuggestionInputPrediction: this.entry.suppressNextSuggestionInputPrediction,
        missingTrailingSpace: this.entry.missingTrailingSpace,
        awaitingHostInputEcho: this.entry.pendingExtensionEdit?.awaitingHostInputEcho === true,
      })
    ) {
      this.clearAcceptedSuggestionTransientState();
      this.entry.suppressNextSuggestionInputPrediction = false;
    }

    if (shouldInvalidatePendingExtensionEditOnKeydown(keyboardEvent)) {
      this.clearAcceptedSuggestionTransientState();
    }

    if (shouldDismissSuggestionsOnKeydown(keyboardEvent)) {
      controls.dismissEntry(true);
      return;
    }

    if (shouldRunEnterWordBoundaryGrammar(keyboardEvent, this.entry.isComposing)) {
      this.runEnterWordBoundaryGrammar();
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

  public handleInput(event: Event, deferHostInput = true): void {
    // Quill reconciles native DOM input in a MutationObserver microtask. A
    // nested native edit during its input event can duplicate the typed key.
    if (deferHostInput && this.entry.elem.matches(".ql-editor")) {
      if (!this.deferredInput)
        queueMicrotask(() => {
          const pending = this.deferredInput;
          this.deferredInput = null;
          if (pending && this.entry.elem.isConnected && this.options.isFocused())
            this.handleInput(pending, false);
        });
      this.deferredInput = event;
      return;
    }
    if (!this.refreshInteraction()) {
      if (this.entry.isComposing) this.handleSuppressedInput();
      return;
    }
    this.pushInteractionTrace(this.describeInputInteraction(event));
    this.dropGrammarProposal();
    const context = this.options.editableContextResolver.resolve(this.entry.elem);
    if (!context) {
      this.handleSuppressedInput();
      return;
    }
    if (this.shouldDeferContentEditableInputToFallback(context)) {
      return;
    }

    this.options.clearPendingFallback();
    if (!context.selectionStable || this.entry.isComposing) {
      this.handleSuppressedInput();
      return;
    }
    if (this.entry.suppressNextSuggestionInputPrediction) {
      const snapshot = TextTargetAdapter.snapshot(this.entry.elem);
      const preservesPendingExtensionEdit = this.shouldPreservePendingExtensionEdit(snapshot);
      logger.debug("Evaluating post-accept input suppression", {
        suggestionId: this.entry.id,
        requestId: this.entry.requestId,
        inputType: inputTypeOf(event),
        snapshotCursorOffset: snapshot.cursorOffset,
        snapshotBeforeCursorLength: snapshot.beforeCursor.length,
        snapshotAfterCursorLength: snapshot.afterCursor.length,
        hasPendingExtensionEdit: this.entry.pendingExtensionEdit !== null,
        pendingExtensionEditSource: this.entry.pendingExtensionEdit?.source ?? null,
        recentInteractionTrail: this.entry.recentInteractionTrail.slice(),
        caretTrace: buildCaretTrace(
          snapshot.beforeCursor,
          snapshot.afterCursor,
          CARET_TRACE_TEXT_LIMIT,
        ),
        activeBlockTrace: this.buildActiveBlockTrace(),
      });
      const shouldSuppressAwaitedHostEcho =
        this.entry.pendingExtensionEdit?.awaitingHostInputEcho === true &&
        preservesPendingExtensionEdit;
      if (this.entry.pendingExtensionEdit !== null && preservesPendingExtensionEdit) {
        if (shouldSuppressAwaitedHostEcho) {
          this.entry.pendingExtensionEdit.awaitingHostInputEcho = false;
        }
        logger.debug("Suppressing post-accept input echo", {
          suggestionId: this.entry.id,
          requestId: this.entry.requestId,
          inputType: inputTypeOf(event),
          pendingExtensionEditSource: this.entry.pendingExtensionEdit.source,
          pendingExtensionEditBlockScoped: this.entry.pendingExtensionEdit.blockScoped ?? false,
          pendingExtensionEditAwaitingHostInputEcho: shouldSuppressAwaitedHostEcho,
        });
        this.suppressAcceptedSuggestionInput();
        return;
      }
      logger.debug("Post-accept suppression window ended on real edit", {
        suggestionId: this.entry.id,
        requestId: this.entry.requestId,
        inputType: inputTypeOf(event),
        hasPendingExtensionEdit: this.entry.pendingExtensionEdit !== null,
        recentInteractionTrail: this.entry.recentInteractionTrail.slice(),
        activeBlockTrace: this.buildActiveBlockTrace(),
      });
      if (this.entry.pendingExtensionEdit) {
        this.entry.pendingExtensionEdit.awaitingHostInputEcho = false;
      }
      this.entry.suppressNextSuggestionInputPrediction = false;
    }

    if (this.seenGrammarProposals === null) this.readGrammarProposals(false);
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
    this.entry.requestId += 1;
    this.grammarProposalToken += 1;
    this.clearPendingIdleTimer();
    this.options.predictionCoordinator.cancelPending(this.entry);
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
    this.entry.grammarProposal = null;
    this.entry.grammarProposalSelected = false;
    this.snippetSuggestions.clear();
    this.snippetShortcuts = undefined;
    this.entry.selectedIndex = 0;
    this.entry.visibleSuggestionBeforeCursorText = null;
    this.entry.visibleSuggestionFullText = null;
    this.entry.inlineSuggestion = null;
    this.entry.inlineSuggestionToken = null;
    this.entry.pendingInlineAccept = false;
    this.entry.inlineRenderRejected = false;
    this.options.hideMenu();
    this.options.clearInlinePresenter();
  }

  public handlePredictionResponse(context: PredictionResponse): void {
    if (!this.refreshInteraction()) return;
    if (
      !this.options.predictionCoordinator.shouldProcessResponse(this.entry, context, {
        isEntryFocused: this.options.isFocused(),
        clearSuggestions: () => this.clearSuggestions(),
      })
    ) {
      return;
    }

    this.entry.suggestions = Array.isArray(context.predictions) ? context.predictions.slice() : [];
    this.snippetShortcuts = context.snippetShortcuts;
    this.snippetSuggestions = new Set(
      this.entry.suggestions.filter((_, index) => context.snippetShortcuts?.[index]),
    );
    this.entry.selectedIndex = 0;
    this.entry.menuHeader =
      this.options.showSuggestionFooter && context.lang && SUPPORTED_LANGUAGES[context.lang]
        ? suggestionLanguageLabel(SUPPORTED_LANGUAGES[context.lang])
        : null;
    const currentPredictionContext = this.resolveCurrentPredictionContext();
    this.entry.visibleSuggestionBeforeCursorText = currentPredictionContext.beforeCursor;
    this.entry.visibleSuggestionFullText = currentPredictionContext.fullText;
    // Stamp the token the response was predicted for: latestMentionText may
    // already reflect newer typing whose request is still debounced.
    this.entry.inlineSuggestionToken =
      typeof context.text === "string"
        ? this.options.predictionCoordinator.findMentionToken(context.text).token
        : this.entry.latestMentionText;

    this.entry.inlineRenderRejected = false;
    if (this.options.inlineSuggestionEnabled) {
      this.entry.inlineSuggestion = this.entry.suggestions[0] ?? null;
      this.renderMenuRows();
      this.options.renderInline();
    } else {
      this.entry.inlineSuggestion = null;
      this.options.clearInlinePresenter();
      this.renderMenuRows();
    }

    if (this.entry.pendingInlineAccept) {
      this.entry.pendingInlineAccept = false;
      // Only accept what the presenter showed; Tab must not insert unseen text.
      const suggested = this.entry.inlineSuggestion;
      if (suggested) {
        this.acceptSuggestion(suggested);
      }
    }

    if (this.entry.suggestions.length > 0) {
      this.options.logRenderedSuggestionPopup(context, {
        predictionCount: this.entry.suggestions.length,
        renderer: this.options.inlineSuggestionEnabled ? "inline" : "menu",
      });
      this.options.recordSuggestionShown({
        suggestionCount: this.entry.suggestions.length,
        language: context.lang,
      });
      return;
    }

    this.options.logNoVisibleSuggestions(context);
  }

  /** The menu's rows: the suggestions (unless they show inline) and any grammar proposal. */
  private renderMenuRows(): void {
    if (!this.refreshInteraction()) return;
    if (this.options.inlineSuggestionEnabled && !this.entry.grammarProposal) {
      this.options.hideMenu();
      return;
    }
    this.options.renderMenu({
      suggestions: this.options.inlineSuggestionEnabled ? [] : this.entry.suggestions,
      snippetShortcuts: this.snippetShortcuts,
      selectedIndex: this.entry.selectedIndex,
      menuHeader: this.entry.menuHeader,
      mentionText: this.entry.latestMentionText,
    });
  }

  /**
   * The caret context where a proposal may be made, or null: proposals off, a
   * sensitive, locked or code field, or no plain caret.
   */
  private grammarProposalContext(): ReturnType<
    SuggestionEntrySession["resolveEditableCursorContext"]
  > | null {
    if (
      !this.refreshInteraction() ||
      isSearchField(this.entry.elem) ||
      !this.options.findGrammarProposals ||
      this.resolveUnstableInputSkipReason(this.entry) !== null ||
      measurementEditingContext(this.entry.elem) !== "prose"
    ) {
      return null;
    }
    const context = this.resolveEditableCursorContext(
      this.entry,
      TextTargetAdapter.snapshot(this.entry.elem),
    );
    return context.safeForGrammar ? context : null;
  }

  /**
   * Asks for the Review findings in the text before the caret (detection runs in
   * the background). The first answer only records what the field already
   * contains; later ones, with `offer`, show the newest finding not seen before
   * as the menu's last row, if the text is still the one asked about.
   */
  private readGrammarProposals(offer: boolean): void {
    const context = this.grammarProposalContext();
    if (!context) {
      return;
    }
    const { beforeCursor } = context;
    const find = this.options.findGrammarProposals!;
    const token = this.grammarProposalToken;
    const generation = this.interactionGeneration;
    this.grammarProposalQueue = this.grammarProposalQueue
      .then(() =>
        this.refreshInteraction() && generation === this.interactionGeneration
          ? find(beforeCursor)
          : [],
      )
      .then((proposals) => {
        if (!this.refreshInteraction() || generation !== this.interactionGeneration) return;
        if (this.seenGrammarProposals === null) {
          this.seenGrammarProposals = { text: beforeCursor, spans: proposals };
          return;
        }
        if (
          !offer ||
          token !== this.grammarProposalToken ||
          !this.options.isFocused() ||
          this.grammarProposalContext()?.beforeCursor !== beforeCursor
        ) {
          return;
        }
        const proposal = nextLiveGrammarProposal(
          proposals,
          beforeCursor,
          this.seenGrammarProposals,
        );
        if (!proposal) {
          return;
        }
        this.entry.grammarProposal = proposal;
        this.entry.grammarProposalSelected = false;
        this.grammarProposalText = beforeCursor;
        this.renderMenuRows();
      })
      // No answer (the background is unavailable): no proposal, as if none was found.
      .catch(() => undefined);
  }

  /** Typing on ignores the proposal; it is not offered again. */
  private dropGrammarProposal(): void {
    this.grammarProposalToken += 1;
    if (!this.entry.grammarProposal) {
      return;
    }
    this.entry.grammarProposal = null;
    this.entry.grammarProposalSelected = false;
    this.renderMenuRows();
  }

  /**
   * Applies the shown proposal after finding it again, with the same fix, in the
   * text as it is now; a changed or vanished span is never written. True when
   * the text is still the one it was found in: re-detection then answers
   * asynchronously, and the edit is made only if it finds the same fix and the
   * text has still not changed.
   */
  public acceptGrammarProposal(): boolean {
    const proposal = this.entry.grammarProposal;
    const foundIn = this.grammarProposalText;
    this.clearSuggestions();
    const context = proposal ? this.grammarProposalContext() : null;
    if (!proposal || !context || context.beforeCursor !== foundIn) {
      return false;
    }
    const token = this.grammarProposalToken;
    void this.options.findGrammarProposals!(foundIn)
      .then((proposals) => {
        const current = proposals.find((candidate) => sameLiveProposal(candidate, proposal));
        const now =
          current && token === this.grammarProposalToken && this.options.isFocused()
            ? this.grammarProposalContext()
            : null;
        if (!current || !now || now.beforeCursor !== foundIn) {
          return;
        }
        const { beforeCursor, snapshot, applyContext } = now;
        this.options.textEditService.applyGrammarEdit(
          this.entry,
          {
            replacement: current.replacement + beforeCursor.slice(current.end),
            deleteBackwards: beforeCursor.length - current.start,
            deleteForwards: 0,
            strict: true,
          },
          { snapshot, contentEditableContext: applyContext },
        );
      })
      .catch(() => undefined);
    return true;
  }

  public handleKeyFallbackReconcile(
    pending: PendingKeyFallback,
    controls: {
      clearPendingFallback: () => void;
      dismissEntry: () => void;
      rescheduleFallback: (delayMs: number) => void;
    },
  ): void {
    this.dropGrammarProposal();
    if (!this.options.isFocused()) {
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
    const reconcileSnapshot = TextTargetAdapter.snapshot(this.entry.elem);
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
    this.deferredInput = null;
    this.options.predictionCoordinator.cancelPending(this.entry);
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
    const dismiss = () => {
      this.clearAcceptedSuggestionTransientState();
      this.entry.isComposing = false;
      this.entry.pendingGrammarPaste = false;
      this.clearPendingIdleTimer();
      controls.dismissEntry();
    };
    if (this.options.inlineSuggestionEnabled && this.entry.inlineSuggestion !== null) {
      // Hide the inline ghost and clear the cached suggestion immediately
      // so the mirror overlay does not linger visibly while the deferred
      // dismiss settles, and so handleFocus() does not briefly re-render
      // the stale suggestion if the user clicks back into the editor.
      // If this turns out to be a transient blur (e.g. Google Translate
      // DOM rebuild), a fresh prediction will be requested on next input.
      this.entry.inlineSuggestion = null;
      this.options.clearInlinePresenter();

      // Defer the full dismiss: sites like Google Translate replace the
      // textarea DOM element during heavy DOM rebuilds, causing a
      // transient blur on the old element even though focus moves to the
      // replacement element immediately.  By deferring to a microtask we
      // give the browser time to settle focus on the new element before
      // checking whether the entry is still focused.
      void Promise.resolve().then(() => {
        if (!this.options.isFocused()) {
          dismiss();
        }
      });
      return;
    }
    dismiss();
  }

  public acceptSuggestionAtIndex(index: number): boolean {
    const suggestion = this.entry.suggestions[index];
    if (!suggestion) {
      return false;
    }
    return this.acceptSuggestion(suggestion);
  }

  public reconcileSelection(controls: { dismissEntry: () => void }): void {
    if (!this.hasVisibleSuggestionState()) {
      return;
    }
    if (!this.options.isFocused()) {
      return;
    }
    if (
      TextTargetAdapter.isTextValue(this.entry.elem) &&
      !TextTargetAdapter.hasCollapsedSelection(this.entry.elem)
    ) {
      controls.dismissEntry();
      return;
    }
    if (this.entry.lastKeydownKey !== null) {
      return;
    }
    if (this.entry.visibleSuggestionBeforeCursorText === null) {
      return;
    }

    if (!TextTargetAdapter.isTextValue(this.entry.elem)) {
      const blockContext = this.options.contentEditableAdapter.getBlockContext(this.entry.elem);
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

    const reschedule = (remainingMs: number) => {
      pending.reconcileScheduled = false;
      controls.rescheduleFallback(
        Math.max(1, Math.min(INSERT_INPUT_FALLBACK_RETRY_INTERVAL_MS, remainingMs)),
      );
      return true;
    };
    const snapshot = TextTargetAdapter.snapshot(this.entry.elem);
    const currentFullText =
      pending.scopeElement?.textContent ?? `${snapshot.beforeCursor}${snapshot.afterCursor}`;
    const textChanged =
      pending.expectedFullText !== null && currentFullText !== pending.expectedFullText;
    const shouldReconcileEnterAtEmptyBoundary =
      pending.typedKey === "Enter" &&
      hasMultipleBlockDescendants &&
      this.options.contentEditableAdapter.isCollapsedSelectionBeforeBlockBoundary(this.entry.elem);
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
          return reschedule(remainingMs);
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

    return reschedule(remainingMs);
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
    const scopeElement = TextTargetAdapter.isTextValue(this.entry.elem)
      ? null
      : this.options.contentEditableAdapter.getActiveBlockElement(this.entry.elem);
    const currentSnapshot = scopeElement
      ? this.resolveEditableCursorContext(this.entry, null).snapshot
      : TextTargetAdapter.snapshot(this.entry.elem);
    const currentBeforeCursor = this.resolveBeforeCursorForPrediction(this.entry, {
      snapshot: currentSnapshot,
    });
    const fallback: PendingKeyFallback = {
      scopeElement,
      timer: setTimeout(() => {
        controls.runReconcile();
      }, timeoutMs),
      observer: null,
      reconcileScheduled: false,
      inputAction,
      expectedBeforeCursor: shouldWaitForTextChange ? currentBeforeCursor : null,
      expectedFullText: shouldWaitForTextChange
        ? (scopeElement?.textContent ??
          `${currentSnapshot.beforeCursor}${currentSnapshot.afterCursor}`)
        : null,
      typedKey,
      waitForTextChangeUntilMs: shouldWaitForTextChange
        ? Date.now() + INSERT_INPUT_FALLBACK_MAX_WAIT_MS
        : null,
    };

    if (observeMutations) {
      fallback.observer = new MutationObserver(() => {
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

    const reconcileInsert = (afterCursor: string) => {
      this.recordPredictionInput("insert", predictionBeforeCursor, false);
      this.dispatchPrediction("reconcile", false, "insert", predictionBeforeCursor, afterCursor);
      this.scheduleIdleGrammar();
      return true;
    };
    if (!predictionContext) {
      return reconcileInsert("");
    }

    const grammarEdit = predictionContext.safeForGrammar
      ? this.options.grammarCoordinator.run({
          measurementContext: measurementEditingContext(this.entry.elem),
          beforeCursor: predictionContext.beforeCursor,
          afterCursor: predictionContext.afterCursor,
          inputAction: "insert",
          triggers: this.resolveLocalGrammarTriggers(undefined, predictionContext.beforeCursor),
        })
      : null;
    const { replacement: grammarReplacement, deleteBackwards: grammarDeleteBackwards } = grammarEdit
      ? normalizeGrammarEdit(grammarEdit)
      : { replacement: "", deleteBackwards: 0 };

    if (grammarEdit) {
      const applyResult = this.options.textEditService.applyGrammarEdit(this.entry, grammarEdit, {
        snapshot: predictionContext.snapshot,
        contentEditableContext: predictionContext.applyContext,
      });
      if (applyResult.unverified) {
        this.handleSuppressedInput();
        return true;
      }
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

    return reconcileInsert(predictionContext.afterCursor);
  }

  private resolveCurrentPredictionContext(): { beforeCursor: string; fullText: string } {
    const snapshot = TextTargetAdapter.snapshot(this.entry.elem);
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
      snapshot ?? TextTargetAdapter.snapshot(entry.elem),
      {
        inputAction,
        hasMultipleBlockDescendants,
        typedKey,
      },
    ).beforeCursor;
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
    return TextTargetAdapter.hasCollapsedSelection(entry.elem) ? null : "selection_not_collapsed";
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

    if (!rangeInsideTarget(selection.getRangeAt(0), entry.elem)) {
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
    const processingStartedAt = performance.now();
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
      this.entry.manualAutoFixSuppression !== null ||
      this.entry.pendingExtensionEdit !== null
        ? (() => {
            const startedAt = performance.now();
            const resolved = TextTargetAdapter.snapshot(this.entry.elem);
            snapshotDurationMs = performance.now() - startedAt;
            return resolved;
          })()
        : null);

    if (snapshot) {
      this.syncEditStateWithSnapshot(snapshot);
    }

    const resolvedHasMultipleBlockDescendants =
      hasMultipleBlockDescendants ?? this.resolveHasMultipleBlockDescendants();
    const provisionalStartedAt = performance.now();
    const provisionalContext = this.resolveEditableCursorContext(this.entry, snapshot, {
      hasMultipleBlockDescendants: resolvedHasMultipleBlockDescendants,
      typedKey,
    });
    const provisionalContextDurationMs = performance.now() - provisionalStartedAt;
    const inputAction =
      inputActionOverride ??
      resolvePredictionInputAction(event ?? new Event("input"), provisionalContext.beforeCursor, {
        lastKeydownKey: this.entry.lastKeydownKey,
        lastBeforeCursorText: this.entry.lastBeforeCursorText,
      });
    const predictionStartedAt = performance.now();
    const cursorContext = this.resolveEditableCursorContext(this.entry, snapshot, {
      hasMultipleBlockDescendants: resolvedHasMultipleBlockDescendants,
      inputAction,
      typedKey,
    });
    const predictionContextDurationMs = performance.now() - predictionStartedAt;
    const grammarEdit =
      !allowPredictionWithNonCollapsedSelection && cursorContext.safeForGrammar
        ? this.options.grammarCoordinator.run({
            measurementContext: measurementEditingContext(this.entry.elem),
            beforeCursor: cursorContext.beforeCursor,
            afterCursor: cursorContext.afterCursor,
            inputAction,
            triggers: this.resolveLocalGrammarTriggers(event, cursorContext.beforeCursor),
          })
        : null;

    if (grammarEdit) {
      const { replacement: grammarReplacement, deleteBackwards: grammarDeleteBackwards } =
        normalizeGrammarEdit(grammarEdit);
      // FT-INV-2: normal typing reads the active block; a whole-field anchor is
      // needed only when a rule actually proposes a write or undo is pending.
      const writeContext = snapshot
        ? cursorContext
        : this.resolveEditableCursorContext(
            this.entry,
            TextTargetAdapter.snapshot(this.entry.elem),
            {
              hasMultipleBlockDescendants: resolvedHasMultipleBlockDescendants,
              inputAction,
              typedKey,
            },
          );
      const applyResult = this.options.textEditService.applyGrammarEdit(this.entry, grammarEdit, {
        snapshot: writeContext.snapshot,
        contentEditableContext: writeContext.applyContext,
      });
      if (applyResult.unverified) {
        this.handleSuppressedInput();
        return;
      }
      if (applyResult.applied) {
        this.clearSuggestions();
        if (applyResult.didDispatchInput) {
          if (
            !isTextValueTarget &&
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

        snapshot = TextTargetAdapter.snapshot(this.entry.elem);
        if (this.resolveUnstableInputSkipReason(this.entry) !== null) {
          this.handleSuppressedInput();
          return;
        }
        this.syncEditStateWithSnapshot(snapshot);

        if (
          this.dispatchAdjustedGrammarPrediction({
            beforeCursor: cursorContext.beforeCursor,
            afterCursor: cursorContext.afterCursor,
            grammarReplacement,
            grammarDeleteBackwards,
            inputAction,
            predictionMode,
            scheduleIdle,
            isTextValue: isTextValueTarget,
          })
        ) {
          return;
        }
      } else if (
        !applyResult.suppressedByManualRevert &&
        this.dispatchAdjustedGrammarPrediction({
          beforeCursor: isTextValueTarget
            ? cursorContext.snapshot.beforeCursor
            : cursorContext.beforeCursor,
          afterCursor: isTextValueTarget
            ? cursorContext.snapshot.afterCursor
            : cursorContext.afterCursor,
          grammarReplacement,
          grammarDeleteBackwards,
          inputAction,
          predictionMode,
          scheduleIdle,
          isTextValue: isTextValueTarget,
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
    this.recordPredictionInput(inputAction, predictionBeforeCursor, isTextValueTarget);

    if (this.options.inlineSuggestionEnabled) {
      this.options.renderInline();
    }
    // New text means a fresh prediction is on its way; no veto (earlier, or
    // from dropping the stale suggestion above) applies, so an early Tab may
    // wait for it again.
    this.entry.inlineRenderRejected = false;

    this.dispatchPrediction(
      predictionMode,
      inputAction === "insert" && DUPLICATE_PUNCTUATION_TAIL_REGEX.test(predictionBeforeCursor),
      inputAction,
      predictionBeforeCursor,
      predictionContext.afterCursor,
    );

    if (scheduleIdle) {
      this.scheduleIdleGrammar();
    }

    const totalProcessingDurationMs = performance.now() - processingStartedAt;
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

  private syncEditStateWithSnapshot(snapshot: SuggestionSnapshot): void {
    this.options.textEditService.syncManualAutoFixSuppression(this.entry, snapshot);
    if (this.entry.pendingExtensionEdit && !this.shouldPreservePendingExtensionEdit(snapshot)) {
      this.entry.pendingExtensionEdit = null;
    }
    syncAcceptedSuggestionTrailingSpaceState(this.entry, this.options.contentEditableAdapter);
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
    this.recordPredictionInput(inputAction, adjustedBeforeCursor, isTextValue);
    this.dispatchPrediction(predictionMode, false, inputAction, adjustedBeforeCursor, afterCursor);

    if (scheduleIdle) {
      this.scheduleIdleGrammar();
    }

    return true;
  }

  private recordPredictionInput(
    inputAction: PredictionInputAction,
    beforeCursor: string,
    isTextValue: boolean,
  ): void {
    this.entry.lastInputAction = inputAction;
    this.entry.lastKeydownKey = null;
    this.entry.lastBeforeCursorText = beforeCursor;
    this.entry.pendingGrammarPaste = false;
    const tokenInfo = this.options.predictionCoordinator.findMentionToken(beforeCursor);
    this.entry.latestMentionText = tokenInfo.token;
    this.entry.latestMentionStart = isTextValue ? tokenInfo.start : -1;
  }

  private dispatchPrediction(
    predictionMode: "schedule" | "reconcile",
    force: boolean,
    inputAction: PredictionInputAction,
    beforeCursor: string,
    afterCursor: string,
  ): void {
    const options = {
      clearSuggestions: () => this.clearSuggestions(),
      inputAction,
      beforeCursorOverride: beforeCursor,
      afterCursorOverride: afterCursor,
    };
    if (predictionMode === "reconcile") {
      this.options.predictionCoordinator.reconcile(this.entry, options);
    } else {
      this.options.predictionCoordinator.schedule(this.entry, { force, ...options });
    }
  }

  public acceptSuggestion(suggestion: string): boolean {
    const requestId = this.entry.requestId;
    if (!this.refreshInteraction() || requestId !== this.entry.requestId) return false;
    if (
      this.lastAcceptedSuggestion === suggestion &&
      this.entry.suppressNextSuggestionInputPrediction &&
      this.entry.pendingExtensionEdit?.source === "suggestion"
    ) {
      return false;
    }

    this.entry.suppressNextSuggestionInputPrediction = true;
    const accepted = this.options.textEditService.acceptSuggestion(this.entry, suggestion);
    if (!accepted) {
      this.entry.suppressNextSuggestionInputPrediction = false;
      return false;
    }
    this.lastAcceptedSuggestion = suggestion;
    if (accepted.unverified) {
      this.options.clearPendingFallback();
      this.options.predictionCoordinator.cancelPending(this.entry);
      this.clearPendingRequestTimer();
      this.entry.missingTrailingSpace = false;
      this.handleSuppressedInput();
      return true;
    }
    // A snippet is user content (an address, an email), not a word to learn. The
    // background only recognises exact-shortcut triggers, so skip it here.
    const personalizationEventId = this.snippetSuggestions.has(suggestion)
      ? ""
      : this.options.recordPersonalizationAccepted({
          suggestion,
          triggerText: accepted.triggerText,
          language: this.options.getLang(),
        });
    if (personalizationEventId && this.entry.pendingExtensionEdit?.source === "suggestion") {
      this.entry.pendingExtensionEdit.personalizationEventId = personalizationEventId;
    }
    this.finishAcceptedSuggestion(
      accepted.triggerText,
      accepted.insertedText,
      accepted.cursorAfter,
      accepted.cursorAfterIsBlockLocal,
    );
    this.runAcceptedSuggestionGrammar();
    return true;
  }

  /**
   * Accepting a suggestion finishes a word exactly as typing its last letter
   * and a space would, but it reaches the field through the edit service
   * rather than through keystrokes, so the word-boundary rules never saw it:
   * typing "was " capitalized, picking "was" from the menu did not.
   */
  private runAcceptedSuggestionGrammar(): void {
    const grammarContext = this.wordBoundaryGrammarContext();
    if (!grammarContext) {
      return;
    }
    const measurementContext = measurementEditingContext(this.entry.elem);
    // The accepted text carries its own trailing space when that setting is on;
    // without one the boundary has to be supplied the way Enter does it.
    const endsAtBoundary = /[\s\u00a0]$/u.test(grammarContext.beforeCursor);
    const grammarEdit = endsAtBoundary
      ? this.options.grammarCoordinator.run({
          measurementContext,
          beforeCursor: grammarContext.beforeCursor,
          afterCursor: grammarContext.afterCursor,
          inputAction: "insert",
          triggers: ["wordBoundary"],
        })
      : this.options.grammarCoordinator.runVirtualWordBoundary({
          measurementContext,
          beforeCursor: grammarContext.beforeCursor,
          afterCursor: grammarContext.afterCursor,
        });
    if (!grammarEdit) {
      return;
    }
    this.options.textEditService.applyGrammarEdit(this.entry, grammarEdit, {
      snapshot: grammarContext.snapshot,
      contentEditableContext: grammarContext.applyContext,
    });
  }

  private wordBoundaryGrammarContext(): ReturnType<
    typeof resolveEditableCursorContextHelper
  > | null {
    if (
      !this.options.grammarCoordinator.hasEnabledRules() ||
      this.resolveUnstableInputSkipReason(this.entry) !== null
    ) {
      return null;
    }
    const snapshot = TextTargetAdapter.snapshot(this.entry.elem);
    const grammarContext = this.resolveEditableCursorContext(this.entry, snapshot);
    return grammarContext.safeForGrammar && grammarContext.beforeCursor.length > 0
      ? grammarContext
      : null;
  }

  private finishAcceptedSuggestion(
    triggerText: string,
    insertedText: string,
    cursorAfter: number,
    cursorAfterIsBlockLocal: boolean,
  ): void {
    this.options.clearPendingFallback();
    this.options.predictionCoordinator.cancelPending(this.entry);
    this.clearPendingRequestTimer();
    this.clearPendingIdleTimer();
    this.entry.requestId += 1;
    this.entry.lastKeydownKey = null;
    this.entry.lastBeforeCursorText = null;
    this.entry.latestMentionText = "";
    this.entry.latestMentionStart = TextTargetAdapter.isTextValue(this.entry.elem) ? 0 : -1;
    this.entry.pendingGrammarPaste = false;
    this.clearSuggestions();
    const pendingEdit = this.entry.pendingExtensionEdit;
    const pendingEditText =
      pendingEdit?.postEditBlockText ?? pendingEdit?.postEditFingerprint.fullText ?? "";
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
      pendingEditCaretTrace: pendingEdit
        ? buildCaretTrace(
            pendingEditText.slice(0, pendingEdit.cursorAfter),
            pendingEditText.slice(pendingEdit.cursorAfter),
            CARET_TRACE_TEXT_LIMIT,
          )
        : null,
      activeBlockTrace: this.buildActiveBlockTrace(),
    });
    Object.assign(
      this.entry,
      resolveAcceptedSuggestionSpaceState({
        entry: this.entry,
        insertSpaceAfterAutocomplete: this.options.insertSpaceAfterAutocomplete,
        insertedText,
        cursorAfter,
        cursorAfterIsBlockLocal,
      }),
    );
    this.options.recordSuggestionAccepted({
      triggerText,
      insertedText,
      language: this.options.getLang(),
    });
  }

  private clearAcceptedSuggestionTransientState(): void {
    this.lastAcceptedSuggestion = null;
    clearAcceptedSuggestionTransientEntryState(this.entry);
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
    if (!this.entry.hasMultipleBlockDescendants) {
      this.entry.hasMultipleBlockDescendants =
        this.options.contentEditableAdapter.hasMultipleBlockDescendants(this.entry.elem);
    }
    return this.entry.hasMultipleBlockDescendants;
  }

  private resolveLocalGrammarTriggers(
    event: Event | undefined,
    beforeCursor: string,
  ): GrammarEventType[] {
    if (!this.options.grammarCoordinator.hasEnabledRules()) {
      return [];
    }
    const triggers: GrammarEventType[] = [];
    if (
      this.entry.pendingGrammarPaste ||
      inputTypeOf(event) === "insertFromPaste" ||
      event?.type === "paste"
    ) {
      triggers.push("paste");
    }
    const lastChar = beforeCursor.charAt(beforeCursor.length - 1);
    triggers.push(
      beforeCursor.length > 0 && SPACE_CHARS.includes(lastChar) ? "wordBoundary" : "insertChar",
    );
    // A word also ends at the punctuation that closes its sentence. Without this the
    // boundary rules that require trailing "." / "!" / "?" - englishYourWelcomeCorrection
    // asks for exactly that - can never run, because the boundary they need and the
    // character they test for cannot both be the last one typed.
    if (/[.!?]/.test(lastChar)) {
      triggers.push("wordBoundary");
    }
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
      return (
        resolveLiveBlockScopedEdit(
          this.entry.elem,
          pendingEdit,
          this.options.contentEditableAdapter,
        ) !== null
      );
    }
    if (
      !TextTargetAdapter.isTextValue(this.entry.elem) &&
      pendingEdit.source === "grammar" &&
      TextTargetAdapter.hasCollapsedSelection(this.entry.elem)
    ) {
      const actualFingerprint = TextTargetAdapter.createPostEditFingerprint(
        this.entry.elem,
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
      this.entry.elem,
      pendingEdit.postEditFingerprint,
      snapshot,
    );
  }

  private shouldDeferContentEditableInputToFallback(context: {
    beforeCursor: string;
    fullText: string;
    kind: "text-value" | "contenteditable";
  }): boolean {
    if (context.kind === "text-value" || TextTargetAdapter.isTextValue(this.entry.elem)) {
      return false;
    }
    const pending = this.options.getPendingFallback();
    if (!pending || pending.inputAction !== "insert") {
      return false;
    }
    if (
      typeof pending.expectedBeforeCursor !== "string" ||
      typeof pending.expectedFullText !== "string"
    ) {
      return false;
    }
    if (
      pending.scopeElement &&
      (!pending.scopeElement.isConnected || !this.entry.elem.contains(pending.scopeElement))
    )
      return false;
    if ((pending.scopeElement?.textContent ?? context.fullText) === pending.expectedFullText) {
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
  ) {
    return resolveEditableCursorContextHelper({
      entry,
      snapshot,
      contentEditableAdapter: this.options.contentEditableAdapter,
      hasMultipleBlockDescendants:
        hasMultipleBlockDescendants ?? this.resolveHasMultipleBlockDescendants(),
      inputAction,
      typedKey,
    });
  }

  private scheduleIdleGrammar(): void {
    if (!this.refreshInteraction()) return;
    if (!this.options.grammarCoordinator.hasEnabledRules() && !this.options.findGrammarProposals) {
      return;
    }
    this.clearPendingIdleTimer();
    this.entry.pendingIdleTimer = setTimeout(() => {
      this.entry.pendingIdleTimer = null;
      this.runIdleGrammar();
    }, LOCAL_GRAMMAR_IDLE_DELAY_MS);
  }

  /**
   * Enter ends the line whether or not the host turns it into text, so the
   * word-boundary rules get one pass over the pending word before the key
   * reaches the host. The key itself is left untouched: the host's own submit
   * or newline still happens exactly as before.
   */
  private runEnterWordBoundaryGrammar(): void {
    if (!this.refreshInteraction()) return;
    const grammarContext = this.wordBoundaryGrammarContext();
    if (!grammarContext) {
      return;
    }
    const grammarEdit = this.options.grammarCoordinator.runVirtualWordBoundary({
      measurementContext: measurementEditingContext(this.entry.elem),
      beforeCursor: grammarContext.beforeCursor,
      afterCursor: grammarContext.afterCursor,
    });
    if (!grammarEdit) {
      return;
    }
    const applyResult = this.options.textEditService.applyGrammarEdit(this.entry, grammarEdit, {
      snapshot: grammarContext.snapshot,
      contentEditableContext: grammarContext.applyContext,
    });
    if (applyResult.applied || applyResult.unverified) {
      this.clearSuggestions();
    }
  }

  private runIdleGrammar(): void {
    if (!this.refreshInteraction()) return;
    if (!this.options.isFocused() || this.resolveUnstableInputSkipReason(this.entry) !== null) {
      return;
    }
    const snapshot = TextTargetAdapter.snapshot(this.entry.elem);
    const grammarContext = this.resolveEditableCursorContext(this.entry, snapshot);
    const grammarEdit = grammarContext.safeForGrammar
      ? this.options.grammarCoordinator.run({
          measurementContext: measurementEditingContext(this.entry.elem),
          beforeCursor: grammarContext.beforeCursor,
          afterCursor: grammarContext.afterCursor,
          inputAction: this.entry.lastInputAction ?? "other",
          triggers: ["idle"],
        })
      : null;
    const applyResult = grammarEdit
      ? this.options.textEditService.applyGrammarEdit(this.entry, grammarEdit, {
          snapshot: grammarContext.snapshot,
          contentEditableContext: grammarContext.applyContext,
        })
      : null;
    if (applyResult?.unverified) {
      this.handleSuppressedInput();
      return;
    }
    if (!applyResult?.applied) {
      // Automatic fixes first; what only Review would fix is then offered, never applied.
      // On a pause, offer the newest finding not seen before as the menu's last row.
      this.readGrammarProposals(true);
      return;
    }
    this.clearSuggestions();
    if (applyResult.didDispatchInput) {
      return;
    }
    const updatedSnapshot = TextTargetAdapter.snapshot(this.entry.elem);
    const predictionContext = this.resolveEditableCursorContext(this.entry, updatedSnapshot);
    this.options.predictionCoordinator.schedule(this.entry, {
      force: true,
      clearSuggestions: () => this.clearSuggestions(),
      inputAction: this.entry.lastInputAction ?? "other",
      beforeCursorOverride: predictionContext.beforeCursor,
      afterCursorOverride: predictionContext.afterCursor,
    });
  }

  private handleSuppressedInput(): void {
    this.entry.requestId += 1;
    this.suppressAcceptedSuggestionInput();
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
    const inputType = inputTypeOf(event) || event.type;
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
    const activeBlock = this.options.contentEditableAdapter.getActiveBlockElement(this.entry.elem);
    const blockContext = this.options.contentEditableAdapter.getBlockContext(this.entry.elem);
    if (!blockContext) {
      return null;
    }
    return buildElementSnapshot(
      activeBlock,
      blockContext.beforeCursor,
      blockContext.afterCursor,
      CARET_TRACE_TEXT_LIMIT,
      180,
    );
  }

  private hasVisibleSuggestionState(): boolean {
    return this.entry.suggestions.length > 0 || this.entry.inlineSuggestion !== null;
  }
}
