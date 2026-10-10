import { editorCapabilities } from "./EditorCapabilities";
import { fieldSignatureSource, hashFieldSignature } from "./FieldSignature";
import { acceptKeyLabels } from "@core/domain/suggestionPopup/keyHints";
import { getDeepActiveElement, isInDocument } from "@core/application/dom-utils";
import type { LiveGrammarProposal } from "@core/domain/grammar/review/liveProposalSelection";
import { InlineSuggestionPresenter } from "./InlineSuggestionPresenter";
import { InlineSuggestionView } from "./InlineSuggestionView";
import {
  ManualAttachUiManager,
  type ManualAttachTarget,
  resolveManualAttachIconUrl,
} from "./ManualAttachUiManager";
import {
  isSearchField,
  reservesAutocompleteArrow,
  classifyField,
} from "./NativeAutocompleteConflictDetector";
import { isVisiblyInteractive, SuggestionElementDiscovery } from "./SuggestionElementDiscovery";
import { SuggestionEntrySession } from "./SuggestionEntrySession";
import { SuggestionGrammarCoordinator } from "./SuggestionGrammarCoordinator";
import {
  highlightedMenuRow,
  menuSuggestionRows,
  SuggestionKeyboardHandler,
} from "./SuggestionKeyboardHandler";
import { SuggestionLifecycleController } from "./SuggestionLifecycleController";
import { SuggestionMenuPresenter } from "./SuggestionMenuPresenter";
import { SuggestionPositioningService } from "./SuggestionPositioningService";
import { SuggestionPredictionCoordinator } from "./SuggestionPredictionCoordinator";
import { resolveSuggestionStateHost } from "./SuggestionStateHost";
import { SuggestionMenuView } from "./SuggestionMenuView";
import { resolveSuggestionMenuHostId } from "./SuggestionMenuHost";
import { SuggestionTelemetryService } from "./SuggestionTelemetryService";
import { SuggestionPersonalizationService } from "./SuggestionPersonalizationService";
import { EditableContextResolver } from "./EditableContextResolver";
import { SuggestionTextEditService } from "./SuggestionTextEditService";
import { ContentEditableAdapter } from "./ContentEditableAdapter";
import { TextTargetAdapter } from "./TextTargetAdapter";
import { gutenbergSelectedField } from "./GutenbergEnvironment";
import {
  EARLY_TAB_ACCEPT_CONTEXT_ATTR,
  EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR,
  EARLY_TAB_ACCEPT_ENABLED_ATTR,
  EARLY_TAB_ACCEPT_ENTRY_ID_ATTR,
  EARLY_TAB_ACCEPT_VISIBLE_ATTR,
} from "./EarlyTabAcceptBridgeProtocol";
import type {
  PendingKeyFallback,
  PredictionResponse,
  SuggestionElement,
  SuggestionEntry,
  SuggestionManagerOptions,
  SuggestionPersonalization,
  SuggestionTelemetry,
} from "./types";

export class SuggestionManagerRuntime {
  private readonly discovery: SuggestionElementDiscovery;
  private nextEntryId = 1;
  private readonly entries = new Map<number, SuggestionEntry>();
  private readonly entryByElement = new WeakMap<Element, SuggestionEntry>();
  private readonly sessionRegistry = new Map<number, SuggestionEntrySession>();
  private forcedNativeConflictElements = new WeakSet<SuggestionElement>();
  // Fields whose paused label already showed during this focus.
  private pauseAnnounced = new WeakSet<SuggestionElement>();
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
  private readonly personalization: SuggestionPersonalization;
  private readonly pendingKeyFallbacks = new Map<number, PendingKeyFallback>();

  private readonly acceptKeys: string[] | undefined;
  private readonly findGrammarProposals?: (beforeCursor: string) => Promise<LiveGrammarProposal[]>;

  private lang: string;

  private fieldPreferenceEpoch = 0;
  private savedSignatures = new Set<string>();
  private readonly savedElements = new WeakMap<HTMLElement, string>();
  private readonly pendingSignatures = new WeakMap<HTMLElement, string>();
  private activeEntryId: number | null = null;
  /** Editors under review: no live grammar, predictions or suggestion UI until resumed. */
  private readonly reviewSuspended = new WeakSet<HTMLElement>();

  constructor(private readonly options: SuggestionManagerOptions) {
    this.discovery = new SuggestionElementDiscovery({
      selectors: options.selectors,
      isCandidateElement: this.isStructurallyEligibleElement.bind(this),
      onShadowRootDiscovered: options.onShadowRootDiscovered,
    });
    this.lifecycleController = new SuggestionLifecycleController({
      getEntries: () => this.entries.values(),
      dismissEntry: (entry) => this.dismissEntry(entry),
      reconcileEntrySelection: (entry) => this.reconcileEntrySelection(entry),
    });

    // No footer: no key hints (the language is left out by the session).
    this.acceptKeys = options.showSuggestionFooter ? acceptKeyLabels(options) : undefined;
    this.manualAttachUiManager = new ManualAttachUiManager({
      iconUrl: resolveManualAttachIconUrl(),
      onActivate: this.handleManualAttachActivate.bind(this),
    });

    if (options.loadFieldPreferences) {
      const epoch = this.fieldPreferenceEpoch;
      void options
        .loadFieldPreferences()
        .then((signatures) => {
          if (epoch !== this.fieldPreferenceEpoch) return;
          this.savedSignatures = new Set(signatures);
          this.queryAndAttachHelper();
        })
        .catch(() => undefined);
    }

    this.lang = options.lang;
    this.grammarCoordinator = new SuggestionGrammarCoordinator({
      enabledGrammarRules: options.enabledGrammarRules,
      insertSpaceAfterAutocomplete: options.insertSpaceAfterAutocomplete,
      lang: this.lang,
      userDictionaryList: options.userDictionaryList,
    });
    this.predictionCoordinator = new SuggestionPredictionCoordinator({
      getPrediction: options.getPrediction,
      canPredict: (entry) => this.getSession(entry.id)?.refreshInteraction() ?? false,
      lang: this.lang,
      minWordLengthToPredict: options.minWordLengthToPredict,
    });
    this.telemetry = options.telemetry ?? new SuggestionTelemetryService();
    this.personalization = options.personalization ?? new SuggestionPersonalizationService();
    this.textEditService = new SuggestionTextEditService({
      findMentionToken: this.predictionCoordinator.findMentionToken.bind(
        this.predictionCoordinator,
      ),
      isSeparator: this.predictionCoordinator.isSeparator.bind(this.predictionCoordinator),
      contentEditableAdapter: this.contentEditableAdapter,
      canEdit: (entry, automatic, edit) => {
        const session = this.getSession(entry.id);
        return (
          !!session?.refreshInteraction() &&
          (!automatic ||
            (!isSearchField(entry.elem) && (!edit || session.allowsAutomaticEdit(edit))))
        );
      },
    });
    this.keyboardHandler = new SuggestionKeyboardHandler({
      canAccept: (entry) =>
        editorCapabilities(entry.elem, {
          preferNativeAutocomplete: this.options.preferNativeAutocomplete,
          fieldActivated: this.hasFieldActivation(entry.elem),
        }).consumeAcceptanceKey,
      autocompleteOnSpace: options.autocomplete,
      autocompleteOnEnter: options.autocompleteOnEnter,
      autocompleteOnTab: options.autocompleteOnTab,
      selectByDigit: options.selectByDigit,
      inlineSuggestionEnabled: this.options.inline_suggestion,
      handleMissingSpaceAfterAccept: (entry, event) =>
        this.textEditService.handleMissingSpaceAfterAccept(
          entry,
          event,
          this.consumeCancelableEvent.bind(this),
        ),
      tryUndoLastExtensionEdit: (entry, event) =>
        this.textEditService.tryUndoLastExtensionEdit(entry, event, {
          consumeEvent: this.consumeCancelableEvent.bind(this),
          clearSuggestions: () => this.clearSuggestions(entry),
          onSuccessfulUndo: (edit) => this.recordPersonalizationReversal(edit),
        }),
      consumeKeyboardEvent: this.consumeCancelableEvent.bind(this),
      // Escape: an answer that is still on its way must not show the menu again.
      clearSuggestions: (entry) => this.dismissEntry(entry, true),
      isMenuVisible: (entry) => this.menuPresenter.isVisible(entry.menu, this.menuRowCount(entry)),
      isInlineVisible: (entry) =>
        InlineSuggestionView.hasForEntry(entry.id, entry.elem.ownerDocument),
      updateSelectionHighlight: (entry) => this.updateSelectionHighlight(entry),
      acceptSuggestion: (entry, suggestion) =>
        this.getSession(entry.id)?.acceptSuggestion(suggestion) ?? false,
      acceptSuggestionAtIndex: (entry, index) =>
        this.getSession(entry.id)?.acceptSuggestionAtIndex(index) ?? false,
      acceptGrammarProposal: (entry) => this.getSession(entry.id)?.acceptGrammarProposal() ?? false,
      requestInlineSuggestion: (entry) => this.getSession(entry.id)?.requestInlineSuggestion(),
    });
    const proposalRules = options.grammarProposalRules ?? [];
    const findLive = options.findLiveProposals;
    this.findGrammarProposals =
      proposalRules.length === 0 || !findLive
        ? undefined
        : (beforeCursor) =>
            findLive(
              beforeCursor,
              {
                lang: this.lang,
                enabledRules: proposalRules,
                liveRules: options.enabledGrammarRules,
                userDictionary: options.userDictionaryList ?? [],
                insertSpaceAfterAutocomplete: options.insertSpaceAfterAutocomplete,
              },
              // The explanation comes back in the popup's language.
              this.options.uiLanguage || navigator.language,
            );
  }

  /** Rows the menu shows: its suggestions (none when they show inline) and a proposal. */
  private menuRowCount(entry: SuggestionEntry): number {
    return (
      menuSuggestionRows(entry, this.options.inline_suggestion) + (entry.grammarProposal ? 1 : 0)
    );
  }

  private updateSelectionHighlight(entry: SuggestionEntry): void {
    const row = highlightedMenuRow(
      entry,
      menuSuggestionRows(entry, this.options.inline_suggestion),
    );
    this.menuPresenter.updateHighlight(entry.list, row);
    resolveSuggestionStateHost(entry.elem).setAttribute(
      EARLY_TAB_ACCEPT_VISIBLE_ATTR,
      String(row >= 0),
    );
  }

  public fulfillPrediction(context: PredictionResponse): void {
    this.getSession(context.suggestionId)?.handlePredictionResponse(context);
  }

  public detachAllHelpers(): void {
    this.fieldPreferenceEpoch += 1;
    for (const id of [...this.entries.keys()]) {
      this.detachHelper(id);
    }
    this.manualAttachUiManager.removeAll();
    this.forcedNativeConflictElements = new WeakSet<SuggestionElement>();
    this.activeEntryId = null;
  }

  public removeHelpersNotInDocument(): void {
    for (const [id, entry] of this.entries) {
      // Keep helpers attached for temporarily hidden elements, but detach when element
      // becomes structurally/security-ineligible (e.g. password fields).
      if (!isInDocument(entry.elem) || !this.isStructurallyEligibleElement(entry.elem)) {
        this.forcedNativeConflictElements.delete(entry.elem);
        this.detachHelper(id);
        continue;
      }
      if (this.shouldDemoteAttachedElement(entry.elem)) {
        this.detachHelper(id);
        if (this.isManualAttachSupportedElement(entry.elem)) {
          this.manualAttachUiManager.ensureForElement(entry.elem, classifyField(entry.elem));
        }
      }
    }
    const active = this.getActiveEntry();
    if (active) this.getSession(active.id)?.refreshInteraction();
    this.manualAttachUiManager.pruneNotices();
    for (const element of [...this.manualAttachUiManager.targets()]) {
      if (!this.hasNativeAutocompleteConflict(element)) this.attachSession(element);
    }
    this.pruneManualAttachUi();
  }

  public queryAndAttachHelper(root?: Element): boolean {
    let attachedAny = false;

    for (const candidate of this.discovery.queryCandidates(root)) {
      this.restoreFieldPreference(candidate);
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
    this.getSession(entry.id)?.requestPrediction();
  }

  public handleEarlyTabAcceptRequest(entryId: string): boolean {
    const entry = this.resolveEntryForBridgeEntryId(entryId);
    const session = entry ? this.getSession(entry.id) : undefined;
    if (!entry || !session || !session.refreshInteraction()) {
      return false;
    }

    this.activeEntryId = entry.id;

    if (entry.grammarProposal && entry.grammarProposalSelected) {
      return session.acceptGrammarProposal();
    }

    if (this.options.inline_suggestion && entry.inlineSuggestion) {
      return session.acceptSuggestion(entry.inlineSuggestion);
    }

    if (
      this.options.autocompleteOnTab &&
      this.menuPresenter.isVisible(entry.menu, entry.suggestions.length) &&
      entry.suggestions.length > 0
    ) {
      return session.acceptSuggestionAtIndex(entry.selectedIndex);
    }

    return false;
  }

  /** True while the "enable FluentTyper here" icon owns `element` (one icon per field). */
  public isAwaitingManualAttach(element: HTMLElement): boolean {
    return this.manualAttachUiManager.has(element);
  }

  /** Detaches the helper from an editor while a review writes its fixes into it. */
  public suspendForReview(elem: HTMLElement): void {
    this.reviewSuspended.add(elem);
    for (const [id, entry] of [...this.entries]) {
      if (entry.elem === elem || elem.contains(entry.elem) || entry.elem.contains(elem)) {
        this.detachHelper(id);
      }
    }
  }

  /** Restores normal behavior after a review's write; no setting was changed meanwhile. */
  public resumeAfterReview(elem: HTMLElement): void {
    this.reviewSuspended.delete(elem);
    if (isInDocument(elem)) this.queryAndAttachHelper(elem);
  }

  /** A suggestion menu or inline preview is showing in (or around) this editor. */
  public hasOpenSuggestions(elem: HTMLElement): boolean {
    for (const [, entry] of this.entries) {
      if (entry.elem !== elem && !elem.contains(entry.elem) && !entry.elem.contains(elem)) continue;
      if (
        this.menuPresenter.isVisible(entry.menu, this.menuRowCount(entry)) ||
        InlineSuggestionView.hasForEntry(entry.id, entry.elem.ownerDocument)
      ) {
        return true;
      }
    }
    return false;
  }

  private isReviewSuspended(elem: HTMLElement): boolean {
    for (let node: HTMLElement | null = elem; node; node = node.parentElement) {
      if (this.reviewSuspended.has(node)) return true;
    }
    return false;
  }

  public updateLangConfig(lang: string): void {
    if (this.lang === lang) {
      return;
    }
    this.lang = lang;
    this.grammarCoordinator.updateLanguage(this.lang);
    this.predictionCoordinator.updateLang(this.lang);
    this.triggerActiveSuggestion();
  }

  private isStructurallyEligibleElement(elem: HTMLElement): elem is SuggestionElement {
    return classifyField(elem).kind !== "blocked";
  }

  private isManualAttachSupportedElement(elem: SuggestionElement): elem is ManualAttachTarget {
    return TextTargetAdapter.isTextValue(elem) || elem.isContentEditable;
  }

  private hasFieldActivation(element: SuggestionElement): boolean {
    return (
      this.forcedNativeConflictElements.has(element) ||
      (this.savedElements.has(element) &&
        this.savedElements.get(element) === fieldSignatureSource(element))
    );
  }

  private restoreFieldPreference(element: SuggestionElement): void {
    if (!this.savedSignatures.size || this.hasFieldActivation(element)) return;
    const source = fieldSignatureSource(element);
    if (!source || this.pendingSignatures.get(element) === source) return;
    this.pendingSignatures.set(element, source);
    const epoch = this.fieldPreferenceEpoch;
    void hashFieldSignature(source)
      .then((signature) => {
        if (
          epoch !== this.fieldPreferenceEpoch ||
          source !== fieldSignatureSource(element) ||
          !this.savedSignatures.has(signature)
        )
          return;
        this.savedElements.set(element, source);
        this.attachSession(element);
      })
      .catch(() => undefined);
  }

  private showActivationChoice(element: ManualAttachTarget): void {
    if (!this.options.rememberField) return;
    const source = fieldSignatureSource(element);
    this.manualAttachUiManager.showNotice(
      element,
      source
        ? "Writing assistance enabled for this visit."
        : "Enabled for this visit. This field has no unique stable identifier to remember.",
      source
        ? async () => {
            if (
              !this.isStructurallyEligibleElement(element) ||
              source !== fieldSignatureSource(element)
            )
              throw new Error("This field changed. Enable it again before remembering it.");
            const signature = await hashFieldSignature(source);
            if (
              source !== fieldSignatureSource(element) ||
              !this.isStructurallyEligibleElement(element)
            )
              throw new Error("This field changed.");
            const eligibility = classifyField(element);
            const label =
              eligibility.kind === "manual"
                ? {
                    structured: "Structured field",
                    selector: "Selection field",
                    browser: "Browser suggestions field",
                  }[eligibility.reason]
                : "Writing field";
            await this.options.rememberField!(signature, label);
          }
        : undefined,
    );
  }

  private hasNativeAutocompleteConflict(elem: SuggestionElement): boolean {
    return classifyField(elem).kind === "manual";
  }

  private shouldDemoteAttachedElement(elem: SuggestionElement): boolean {
    return (
      this.options.preferNativeAutocomplete &&
      !this.hasFieldActivation(elem) &&
      this.hasNativeAutocompleteConflict(elem)
    );
  }

  private shouldShowManualAttachUi(elem: SuggestionElement): elem is ManualAttachTarget {
    return (
      this.options.preferNativeAutocomplete &&
      !this.entryByElement.has(elem) &&
      !this.hasFieldActivation(elem) &&
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
        !isVisiblyInteractive(element)
      ) {
        this.forcedNativeConflictElements.delete(element);
        this.manualAttachUiManager.removeForElement(element);
        continue;
      }
      if (this.entryByElement.has(element)) {
        if (!this.manualAttachUiManager.isSuccessPending(element)) {
          this.manualAttachUiManager.removeForElement(element);
        }
        continue;
      }
      if (this.shouldShowManualAttachUi(element)) {
        this.manualAttachUiManager.ensureForElement(element);
      } else {
        this.manualAttachUiManager.removeForElement(element);
      }
    }
  }

  /** The user chose FluentTyper over the site's list in this field, until the page reloads. */
  private useDespiteSitePopup(entry: SuggestionEntry): void {
    if (!isInDocument(entry.elem) || !this.isStructurallyEligibleElement(entry.elem)) return;
    this.forcedNativeConflictElements.add(entry.elem);
    resolveSuggestionStateHost(entry.elem).setAttribute("data-ft-avoid-conflicts", "false");
    const session = this.getSession(entry.id);
    session?.refreshInteraction();
    entry.elem.focus({ preventScroll: true });
    session?.requestPrediction();
  }

  private handleManualAttachActivate(elem: ManualAttachTarget): void {
    if (!isInDocument(elem) || !this.isStructurallyEligibleElement(elem)) {
      this.manualAttachUiManager.removeForElement(elem);
      return;
    }
    this.attachSession(elem, { forceNativeConflict: true });
    this.showActivationChoice(elem);
    elem.focus({ preventScroll: true });
  }

  private attachSession(
    elem: SuggestionElement,
    options: { forceNativeConflict?: boolean } = {},
  ): boolean {
    if (this.entryByElement.has(elem)) {
      if (
        !this.isManualAttachSupportedElement(elem) ||
        !this.manualAttachUiManager.isSuccessPending(elem)
      ) {
        this.removeManualAttachUi(elem);
      }
      return false;
    }

    let shouldSkip = false;
    for (const [existingId, existing] of this.entries) {
      if (elem.contains(existing.elem)) {
        this.detachHelper(existingId);
        continue;
      }
      if (existing.elem.contains(elem)) {
        shouldSkip = true;
        break;
      }
    }

    if (shouldSkip || !this.isStructurallyEligibleElement(elem) || this.isReviewSuspended(elem)) {
      return false;
    }

    if (options.forceNativeConflict) {
      this.forcedNativeConflictElements.add(elem);
    } else if (this.shouldShowManualAttachUi(elem)) {
      this.manualAttachUiManager.ensureForElement(elem, classifyField(elem));
      return false;
    } else if (this.shouldDemoteAttachedElement(elem)) {
      return false;
    }

    const id = this.nextEntryId++;
    const stateHost = resolveSuggestionStateHost(elem);

    const { menu, list } = SuggestionMenuView.ensureMenu(
      (elem.ownerDocument ?? document).documentElement,
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
      chosenSuggestion: null,
      menuHeader: null,
      latestMentionText: "",
      latestMentionStart: 0,
      visibleSuggestionBeforeCursorText: null,
      visibleSuggestionFullText: null,
      inlineSuggestion: null,
      inlineSuggestionToken: null,
      pendingInlineAccept: false,
      inlineRenderRejected: false,
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
      handlers: {
        beforeinput: this.onElementBeforeInput.bind(this, id),
        input: this.onElementInput.bind(this, id),
        keydown: this.onElementKeyDown.bind(this, id),
        paste: this.onElementPaste.bind(this, id),
        focus: this.onElementFocus.bind(this, id),
        blur: this.onElementBlur.bind(this, id),
        click: this.onElementClick.bind(this, id),
        compositionStart: this.onElementCompositionStart.bind(this, id),
        compositionEnd: this.onElementCompositionEnd.bind(this, id),
        menuMouseDown: (event) => {
          event.preventDefault();
        },
        menuClick: this.onMenuClick.bind(this, id),
      },
    };

    stateHost.setAttribute("data-suggestion", "true");
    stateHost.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, String(id));
    stateHost.setAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR, String(this.options.autocompleteOnTab));
    stateHost.setAttribute(
      EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR,
      String(!TextTargetAdapter.isTextValue(elem)),
    );
    stateHost.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "false");
    stateHost.setAttribute(
      "data-ft-avoid-conflicts",
      String(this.options.preferNativeAutocomplete && !this.hasFieldActivation(elem)),
    );
    menu.id = resolveSuggestionMenuHostId(id);

    const session = this.buildEntrySession(entry);

    this.entries.set(id, entry);
    this.entryByElement.set(elem, entry);
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
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }

    this.clearPendingKeyFallback(id);
    this.getSession(id)?.dispose();
    this.lifecycleController.detachEntryListeners(entry);
    entry.menu.remove();
    const stateHost = resolveSuggestionStateHost(entry.elem);
    // A shared host (a Notion page root for all its leaves) keeps the state of the other leaves.
    const sharer =
      stateHost === entry.elem
        ? undefined
        : [...this.entries.values()].find(
            (other) => other.id !== id && resolveSuggestionStateHost(other.elem) === stateHost,
          );

    if (sharer) {
      if (stateHost.getAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR) === String(id)) {
        stateHost.setAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR, String(sharer.id));
        stateHost.setAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR, "false");
      }
    } else {
      stateHost.removeAttribute("data-suggestion");
      stateHost.removeAttribute(EARLY_TAB_ACCEPT_ENTRY_ID_ATTR);
      stateHost.removeAttribute(EARLY_TAB_ACCEPT_ENABLED_ATTR);
      stateHost.removeAttribute(EARLY_TAB_ACCEPT_BRIDGE_TARGET_ATTR);
      stateHost.removeAttribute(EARLY_TAB_ACCEPT_VISIBLE_ATTR);
      stateHost.removeAttribute(EARLY_TAB_ACCEPT_CONTEXT_ATTR);
      stateHost.removeAttribute("data-ft-avoid-conflicts");
    }

    this.entries.delete(id);
    this.entryByElement.delete(entry.elem);
    this.sessionRegistry.delete(id);

    if (this.activeEntryId === id) {
      this.activeEntryId = null;
    }

    this.manualAttachUiManager.removeNotice(entry.elem);
    this.inlinePresenter.clearForEntry(id);
  }

  private dismissEntry(entry: SuggestionEntry, keepActive = false): void {
    this.clearPendingKeyFallback(entry.id);
    this.getSession(entry.id)?.dispose();
    entry.requestId += 1;
    if (!keepActive && this.activeEntryId === entry.id) {
      this.activeEntryId = null;
    }
  }

  private isEntryFocused(entry: SuggestionEntry): boolean {
    if (this.activeEntryId === entry.id) {
      return true;
    }
    const active = gutenbergSelectedField(getDeepActiveElement(document));
    return !!active && (active === entry.elem || entry.elem.contains(active));
  }

  private getActiveEntry(): SuggestionEntry | null {
    if (this.activeEntryId !== null) {
      const known = this.entries.get(this.activeEntryId);
      if (known && gutenbergSelectedField(getDeepActiveElement(document)) === known.elem) {
        return known;
      }
    }

    const active = gutenbergSelectedField(getDeepActiveElement(document));
    if (!active) {
      return null;
    }
    const entry = this.entryByElement.get(active) ?? null;
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

    return this.entries.get(numericId) ?? null;
  }

  private onElementFocus(id: number): void {
    this.activeEntryId = id;
    this.getSession(id)?.handleFocus();
  }

  private onElementClick(id: number): void {
    this.activeEntryId = id;
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    this.getSession(id)?.handleClick({
      dismissEntry: () => this.dismissEntry(entry, true),
    });
  }

  private onElementBlur(id: number): void {
    if (this.activeEntryId === id) {
      this.activeEntryId = null;
    }
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    this.manualAttachUiManager.removeNotice(entry.elem, true);
    this.pauseAnnounced.delete(entry.elem);
    this.getSession(id)?.handleBlur({
      dismissEntry: () => this.dismissEntry(entry),
    });
  }

  private onElementInput(id: number, event: Event): void {
    this.activeEntryId = id;
    this.getSession(id)?.handleInput(event);
  }

  private onElementBeforeInput(id: number, event: Event): void {
    this.activeEntryId = id;
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    if (!this.getSession(id)?.refreshInteraction()) return;
    const inputEvent = event as InputEvent;
    const handled = this.textEditService.tryUndoLastExtensionEditOnBeforeInput(entry, inputEvent, {
      consumeEvent: this.consumeCancelableEvent.bind(this),
      clearSuggestions: () => this.clearSuggestions(entry),
      onSuccessfulUndo: (edit) => this.recordPersonalizationReversal(edit),
    });
    if (handled) {
      this.clearPendingKeyFallback(id);
    }
  }

  private onElementPaste(id: number): void {
    this.activeEntryId = id;
    this.getSession(id)?.handlePaste();
  }

  private onElementCompositionStart(id: number): void {
    this.activeEntryId = id;
    this.getSession(id)?.handleCompositionStart();
  }

  private onElementCompositionEnd(id: number): void {
    this.activeEntryId = id;
    this.getSession(id)?.handleCompositionEnd();
  }

  private clearSuggestions(entry: SuggestionEntry): void {
    this.getSession(entry.id)?.clearSuggestions();
  }

  private buildEntrySession(entry: SuggestionEntry): SuggestionEntrySession {
    return new SuggestionEntrySession({
      entry,
      onPauseChange: (paused) => {
        const capabilities = editorCapabilities(entry.elem);
        const elem = entry.elem;
        if (!paused || !this.isEntryFocused(entry) || !this.isStructurallyEligibleElement(elem)) {
          this.manualAttachUiManager.removeNotice(elem, true);
          return;
        }
        const expand = !this.pauseAnnounced.has(elem);
        if (capabilities.conflict === "native-popup") {
          this.pauseAnnounced.add(elem);
          this.manualAttachUiManager.showPausedBadge(elem, {
            label: "Paused while site list is open",
            hint: "Click to use FluentTyper here",
            title: capabilities.renderReview
              ? "The website list for this field is open. Review remains available. Typing assistance resumes when the list closes. Click to use FluentTyper in this field."
              : "The website list for this field is open. Typing assistance resumes when the list closes. Click to use FluentTyper in this field.",
            expand,
            onActivate: () => this.useDespiteSitePopup(entry),
          });
        } else if (capabilities.reason === "unverified-writer" && capabilities.renderReview) {
          this.pauseAnnounced.add(elem);
          this.manualAttachUiManager.showPausedBadge(elem, {
            label: "Review and Copy only",
            title: "This editor supports Review and Copy. Automatic replacement is unavailable.",
            expand,
          });
        } else {
          this.manualAttachUiManager.removeNotice(elem, true);
        }
      },
      canInteract: (yielding) =>
        editorCapabilities(entry.elem, {
          preferNativeAutocomplete: this.options.preferNativeAutocomplete,
          fieldActivated: this.hasFieldActivation(entry.elem),
          yielding,
        }).displaySuggestions,
      editableContextResolver: this.editableContextResolver,
      clearPendingFallback: () => this.clearPendingKeyFallback(entry.id),
      hideMenu: () => this.menuPresenter.hide(entry.menu, entry.list, entry.elem),
      clearInlinePresenter: () => this.inlinePresenter.clearForEntry(entry.id),
      isFocused: () => this.isEntryFocused(entry),
      showSuggestionFooter: this.options.showSuggestionFooter,
      inlineSuggestionEnabled: this.options.inline_suggestion,
      predictionCoordinator: this.predictionCoordinator,
      grammarCoordinator: {
        hasEnabledRules: () =>
          !isSearchField(entry.elem) && this.grammarCoordinator.hasEnabledRules(),
        run: (args) => (isSearchField(entry.elem) ? null : this.grammarCoordinator.run(args)),
        runVirtualWordBoundary: (args) =>
          isSearchField(entry.elem) ? null : this.grammarCoordinator.runVirtualWordBoundary(args),
      },
      textEditService: this.textEditService,
      contentEditableAdapter: this.contentEditableAdapter,
      getPendingFallback: () => this.pendingKeyFallbacks.get(entry.id),
      findGrammarProposals: this.findGrammarProposals,
      renderMenu: ({ suggestions, snippetShortcuts, menuHeader, mentionText }) =>
        this.menuPresenter.render({
          menuId: entry.id,
          menu: entry.menu,
          list: entry.list,
          target: entry.elem,
          suggestions,
          snippetShortcuts,
          selectedIndex: highlightedMenuRow(entry, suggestions.length),
          proposal: entry.grammarProposal
            ? {
                original: entry.grammarProposal.original,
                replacement: entry.grammarProposal.replacement,
                explanation: entry.grammarProposal.explanation,
              }
            : null,
          showShortcutDigits: this.options.selectByDigit,
          horizontal: this.options.horizontalSuggestions,
          acceptKeys: this.acceptKeys,
          uiLanguage: this.options.uiLanguage,
          menuHeader,
          mentionText,
        }),
      renderInline: () =>
        this.inlinePresenter.renderForEntry({
          enabled: this.options.inline_suggestion,
          entry,
          resolveMentionToken: this.predictionCoordinator.findMentionToken.bind(
            this.predictionCoordinator,
          ),
          // Mirror acceptance's trailing-token scan so the mid-text preview
          // hides the characters that acceptance will replace.
          resolveTrailingToken: (afterCursor: string) =>
            this.textEditService.findTrailingToken(afterCursor),
        }),
      recordSuggestionShown: (context) => this.telemetry.recordSuggestionShown(context),
      recordSuggestionAccepted: (context) => this.telemetry.recordSuggestionAccepted(context),
      recordPersonalizationAccepted: (context) =>
        this.personalization.recordSuggestionAccepted(context),
      getLang: () => this.lang,
      insertSpaceAfterAutocomplete: this.options.insertSpaceAfterAutocomplete,
    });
  }

  private recordPersonalizationReversal(
    edit: Pick<
      NonNullable<SuggestionEntry["pendingExtensionEdit"]>,
      "source" | "personalizationEventId"
    >,
  ): void {
    if (edit.source === "suggestion" && edit.personalizationEventId) {
      this.personalization.recordSuggestionReverted(edit.personalizationEventId);
    }
  }

  private reconcileEntrySelection(entry: SuggestionEntry): void {
    this.getSession(entry.id)?.reconcileSelection({
      dismissEntry: () => this.dismissEntry(entry, true),
    });
  }

  private onMenuClick(id: number, event: Event): void {
    this.activeEntryId = id;
    const item = event
      .composedPath()
      .find(
        (node) => node instanceof HTMLElement && node.matches("li[data-index], li[data-proposal]"),
      ) as HTMLElement | undefined;
    if (!item) {
      return;
    }
    if (item.hasAttribute("data-proposal")) {
      this.getSession(id)?.acceptGrammarProposal();
      return;
    }

    const index = Number(item.getAttribute("data-index"));
    if (!Number.isInteger(index)) {
      return;
    }

    this.getSession(id)?.acceptSuggestionAtIndex(index);
  }

  private onElementKeyDown(id: number, event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    this.activeEntryId = id;
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    if (!this.getSession(id)?.refreshInteraction()) return;
    if (
      this.options.preferNativeAutocomplete &&
      reservesAutocompleteArrow(entry.elem, keyboardEvent)
    ) {
      this.dismissEntry(entry, true);
      return;
    }
    this.getSession(id)?.handleKeyDown(keyboardEvent, {
      dispatchKeyboard: () => this.keyboardHandler.handle(entry, keyboardEvent),
      dismissEntry: (keepActive = true) => this.dismissEntry(entry, keepActive),
      storePendingFallback: (pending) => this.pendingKeyFallbacks.set(id, pending),
      runReconcile: () => this.runKeyFallbackReconcile(id),
    });
  }

  private runKeyFallbackReconcile(id: number): void {
    const pending = this.pendingKeyFallbacks.get(id);
    if (!pending) {
      return;
    }

    const current = this.entries.get(id);
    if (!current) {
      this.clearPendingKeyFallback(id);
      return;
    }
    this.getSession(id)?.handleKeyFallbackReconcile(pending, {
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

  private getSession(entryId: number): SuggestionEntrySession | undefined {
    return this.sessionRegistry.get(entryId);
  }

  private consumeCancelableEvent(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
