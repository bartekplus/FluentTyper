import { createLogger, setGlobalObservabilityRuntime } from "@core/application/logging/Logger";
import { getDeepActiveElement, isInDocument } from "@core/application/dom-utils";
import { CMD_CONTENT_SCRIPT_ADD_TO_DICTIONARY } from "@core/domain/constants";
import { filterCodeSafeGrammarRules } from "@core/domain/grammar/ruleCatalog";
import type {
  ContentScriptAddToDictionaryMessage,
  ContentScriptPredictRequestContext,
  PredictResponseContext,
  SetConfigContext,
} from "@core/domain/messageTypes";
import { DomObserver } from "./DomObserver";
import { MutationPipeline } from "./MutationPipeline";
import { MutationScheduler } from "./MutationScheduler";
import { ShadowRootInterceptor } from "./ShadowRootInterceptor";
import { ThemeApplicator } from "./ThemeApplicator";
import { SuggestionManagerRuntime } from "./suggestions/SuggestionManagerRuntime";
import { ReviewController } from "./review/ReviewController";

import { GoogleDocsAdapter } from "./google-docs/GoogleDocsAdapter";
import { DOCS_SESSION_ID } from "./google-docs/GoogleDocsModel";
import { isGoogleDocsPage, isGoogleDocsInputFrame } from "./google-docs/GoogleDocsEnvironment";

const logger = createLogger("ContentRuntimeController");

export class ContentRuntimeController {
  private static readonly SELECTORS = "textarea, input, [contentEditable]";
  private static readonly LATE_DISCOVERY_EVENTS = ["focusin", "mousedown", "input"] as const;
  private static readonly MUTATION_COALESCE_DELAY_MS = 16;
  private static readonly MAX_MUTATION_BATCH_SIZE = 200;
  private static readonly MAX_MUTATION_ROOTS = 64;

  private googleDocs: GoogleDocsAdapter | null = null;
  public suggestionManager: SuggestionManagerRuntime | null = null;
  public config: SetConfigContext = {
    enabled: false,
    autocomplete: false,
    autocompleteOnEnter: true,
    autocompleteOnTab: true,
    insertSpaceAfterAutocomplete: true,
    lang: "en_US",
    selectByDigit: false,
    minWordLengthToPredict: 0,
    displayLangHeader: true,
    inline_suggestion: false,
    preferNativeAutocomplete: true,
    codeMode: false,
    themeConfig: undefined,
    enabledGrammarRules: [],
    userDictionaryList: [],
  };
  private readonly domObserver: DomObserver;
  private readonly shadowObservers = new Map<ShadowRoot, DomObserver>();
  private shadowRootInterceptor: ShadowRootInterceptor | null = null;
  private lateDiscoveryListenersAttached = false;
  private readonly onMutationCallbackBound = this.mutationCallback.bind(this);
  private readonly onDocumentPotentialLateTargetBound: EventListener =
    this.onDocumentPotentialLateTarget.bind(this);

  private _enabled = false;
  private onPredictionRequest: ((context: ContentScriptPredictRequestContext) => void) | null =
    null;
  private onRuntimeActivity: ((runtimeGeneration: number) => void) | null = null;
  private readonly onRestartRequest = this.restart.bind(this);
  private readonly mutationPipeline: MutationPipeline;
  private readonly mutationScheduler: MutationScheduler;
  private predictionGeneration = 0;
  private pendingRestartToken: symbol | null = null;
  private pendingRestartTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly themeApplicator = new ThemeApplicator();
  // Created on the first review request: no cost for pages that never review.
  private review: ReviewController | null = null;
  private reviewSuspended: HTMLElement | null = null;

  constructor() {
    this.domObserver = new DomObserver(
      document.body || document.documentElement,
      this.onMutationCallbackBound,
    );
    this.mutationScheduler = new MutationScheduler(
      ContentRuntimeController.MUTATION_COALESCE_DELAY_MS,
      (mutations) => {
        if (this.enabled) {
          this.processMutations(mutations);
        }
      },
    );
    this.mutationPipeline = new MutationPipeline(
      ContentRuntimeController.MAX_MUTATION_BATCH_SIZE,
      ContentRuntimeController.MAX_MUTATION_ROOTS,
    );
  }

  setPredictionRequestHandler(
    handler: (context: ContentScriptPredictRequestContext) => void,
  ): void {
    this.onPredictionRequest = handler;
  }

  setRuntimeActivityHandler(handler: (runtimeGeneration: number) => void): void {
    this.onRuntimeActivity = handler;
  }

  set enabled(newValue: boolean) {
    if (this._enabled !== newValue) {
      logger.info("Runtime enabled state changed", { enabled: newValue });
      this._enabled = newValue;
      if (newValue) {
        this.enable();
      } else {
        this.disable();
      }
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setConfig(config: SetConfigContext): void {
    if (config.observability) {
      setGlobalObservabilityRuntime({
        config: config.observability,
        source: "content_script",
      });
    }
    logger.debug("Applying runtime config update", {
      enabled: config.enabled,
      lang: config.lang,
      autocomplete: config.autocomplete,
    });
    this.config = config;

    if (config.themeConfig) {
      this.themeApplicator.apply(config.themeConfig);
    }

    if (this.enabled && config.enabled) {
      logger.info("Restarting runtime due to config change");
      this.onRestartRequest();
      // A settings change (rules, dictionary, language) rechecks an open review.
      this.review?.handleOptionsChanged();
      return;
    }

    this.enabled = config.enabled;
    if (!this.enabled) {
      this.suggestionManager = null;
    }
  }

  updateLanguage(lang: string): void {
    if (this.config.lang === lang) {
      return;
    }
    this.config.lang = lang;
    this.suggestionManager?.updateLangConfig(this.config.lang);
    this.googleDocs?.updateLanguage(this.config.lang);
    this.review?.handleOptionsChanged();
  }

  /**
   * Starts a review of the focused editor in THIS frame. Every frame receives
   * the request; only the one holding the focused editor acts. From the popup,
   * focus returns to the page once the popup closes.
   */
  reviewActiveEditor(source: "command" | "popup"): void {
    if (!this.enabled || isGoogleDocsInputFrame()) {
      return;
    }
    const run = () => {
      if (!this.googleDocs && /^I?FRAME$/.test(getDeepActiveElement(document)?.tagName ?? "")) {
        // A child frame holds the focus and handles the request itself.
        return;
      }
      this.review ??= this.createReviewController();
      this.review.invoke();
    };
    if (document.hasFocus()) {
      run();
      return;
    }
    if (source !== "popup") {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFocus = () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      if (document.hasFocus()) run();
    };
    window.addEventListener("focus", onFocus);
    timer = setTimeout(() => window.removeEventListener("focus", onFocus), 1500);
  }

  private createReviewController(): ReviewController {
    return new ReviewController({
      getOptions: () => ({
        lang: this.config.lang,
        // Code mode keeps only code-safe rules, none of which review supports.
        enabledRules: this.config.codeMode
          ? filterCodeSafeGrammarRules(this.config.enabledGrammarRules)
          : this.config.enabledGrammarRules,
        userDictionary: this.config.userDictionaryList ?? [],
        insertSpaceAfterAutocomplete: this.config.insertSpaceAfterAutocomplete,
      }),
      suspend: (element) => {
        this.reviewSuspended = element;
        this.suggestionManager?.suspendForReview(element);
      },
      resume: (element) => {
        this.reviewSuspended = null;
        this.suggestionManager?.resumeAfterReview(element);
      },
      addToDictionary: async (word) => {
        const message: ContentScriptAddToDictionaryMessage = {
          command: CMD_CONTENT_SCRIPT_ADD_TO_DICTIONARY,
          context: { word },
        };
        const response: unknown = await chrome.runtime.sendMessage(message);
        return (response as { ok?: unknown } | undefined)?.ok === true;
      },
      getDocsSurface: () => this.googleDocs,
    });
  }

  triggerActiveSuggestion(): void {
    this.googleDocs?.triggerActiveSuggestion();
    this.suggestionManager?.triggerActiveSuggestion();
  }

  handleEarlyTabAcceptRequest(entryId: string): void {
    this.suggestionManager?.handleEarlyTabAcceptRequest(entryId);
  }

  getPredictionGeneration(): number {
    return this.predictionGeneration;
  }

  fulfillPrediction(context: PredictResponseContext): void {
    if (
      Number.isFinite(context.runtimeGeneration) &&
      context.runtimeGeneration !== this.predictionGeneration
    ) {
      logger.debug("Ignoring stale prediction response generation", {
        responseGeneration: context.runtimeGeneration,
        activeGeneration: this.predictionGeneration,
        suggestionId: context.suggestionId,
        requestId: context.requestId,
      });
      return;
    }
    if (context.suggestionId === DOCS_SESSION_ID && this.googleDocs) {
      this.googleDocs.fulfillPrediction(context);
      return;
    }
    this.suggestionManager?.fulfillPrediction(context);
  }

  mutationCallback(mutationsList: MutationRecord[]): void {
    if (!this.enabled) {
      return;
    }
    this.mutationScheduler.enqueue(mutationsList);
  }

  processMutations(mutationsList: MutationRecord[]): void {
    if (mutationsList.length > 1) {
      logger.debug("Processing DOM mutations", {
        mutationCount: mutationsList.length,
      });
    }
    this.domObserver.disconnect();
    this.disconnectShadowObservers();
    try {
      if (!this.suggestionManager) {
        return;
      }
      this.suggestionManager.removeHelpersNotInDocument();

      const plan = this.mutationPipeline.buildPlan(mutationsList);
      if (plan.type === "full-scan") {
        this.suggestionManager.queryAndAttachHelper();
      } else if (plan.type === "targeted-scan") {
        for (const root of plan.roots) {
          this.suggestionManager.queryAndAttachHelper(root);
        }
      }
    } finally {
      if (this.enabled) {
        this.domObserver.attach();
        this.refreshShadowObservers();
      }
    }
  }

  enable(): void {
    logger.info("Enabling content runtime");
    if (!this.suggestionManager || (isGoogleDocsPage() && !this.googleDocs)) {
      this.suggestionManager?.detachAllHelpers();
      this.initializeSuggestionManager();
    }
    this.googleDocs?.start();
    this.suggestionManager?.queryAndAttachHelper();
    this.suggestionManager?.triggerActiveSuggestion();
    this.domObserver.attach();
    this.refreshShadowObservers();
    this.ensureShadowRootInterceptor();
    this.ensureLateDiscoveryListeners();
    this.reportRuntimeActivity();
  }

  disable({ keepReview = false }: { keepReview?: boolean } = {}): void {
    // A restart for a settings change keeps an open review; turning off ends it.
    if (!keepReview) this.review?.close();
    this.googleDocs?.dispose();
    this.googleDocs = null;
    logger.info("Disabling content runtime");
    if (this.pendingRestartTimer !== null) {
      clearTimeout(this.pendingRestartTimer);
      this.pendingRestartTimer = null;
      this.pendingRestartToken = null;
    }
    this.domObserver.disconnect();
    this.disconnectShadowObservers();
    this.mutationScheduler.clear();
    this.suggestionManager?.detachAllHelpers();
    this.shadowRootInterceptor?.detach();
    this.removeLateDiscoveryListeners();
  }

  restart(): void {
    if (this.pendingRestartTimer !== null) {
      logger.debug("Skipping content runtime restart; restart already scheduled");
      return;
    }

    logger.warn("Restarting content runtime");
    this.disable({ keepReview: !this.googleDocs });
    this.suggestionManager = null;
    const restartToken = Symbol("content-runtime-restart");
    this.pendingRestartToken = restartToken;
    this.pendingRestartTimer = setTimeout(() => {
      if (this.pendingRestartToken !== restartToken) {
        return;
      }
      this.pendingRestartToken = null;
      this.pendingRestartTimer = null;
      if (this._enabled) {
        this.enable();
      }
    }, 0);
  }

  getObservedNode(): Node {
    return this.domObserver.getNode();
  }

  setObservedNode(node: Node): void {
    this.domObserver.setNode(node);
  }

  private registerShadowRoot(root: ShadowRoot): void {
    if (this.shadowObservers.has(root)) {
      return;
    }
    const observer = new DomObserver(root, this.onMutationCallbackBound);
    this.shadowObservers.set(root, observer);
    if (this.enabled) {
      observer.attach();
    }
  }

  private disconnectShadowObservers(): void {
    for (const observer of this.shadowObservers.values()) {
      observer.disconnect();
    }
  }

  private refreshShadowObservers(): void {
    for (const [root, observer] of this.shadowObservers.entries()) {
      if (!isInDocument(root.host)) {
        observer.disconnect();
        this.shadowObservers.delete(root);
        continue;
      }
      observer.attach();
    }
  }

  private ensureShadowRootInterceptor(): void {
    if (!this.shadowRootInterceptor) {
      this.shadowRootInterceptor = new ShadowRootInterceptor((root) => {
        this.registerShadowRoot(root);
        // Trigger an initial scan of the host so elements already present in
        // the shadow root at interception time are discovered immediately.
        // Subsequent appends are caught by the DomObserver on the shadow root.
        this.suggestionManager?.queryAndAttachHelper(root.host);
      });
    }
    this.shadowRootInterceptor.attach();
  }

  private ensureLateDiscoveryListeners(): void {
    if (this.lateDiscoveryListenersAttached) {
      return;
    }
    for (const eventName of ContentRuntimeController.LATE_DISCOVERY_EVENTS) {
      document.addEventListener(eventName, this.onDocumentPotentialLateTargetBound, true);
    }
    this.lateDiscoveryListenersAttached = true;
  }

  private removeLateDiscoveryListeners(): void {
    if (!this.lateDiscoveryListenersAttached) {
      return;
    }
    for (const eventName of ContentRuntimeController.LATE_DISCOVERY_EVENTS) {
      document.removeEventListener(eventName, this.onDocumentPotentialLateTargetBound, true);
    }
    this.lateDiscoveryListenersAttached = false;
  }

  private onDocumentPotentialLateTarget(event: Event): void {
    if (!this.enabled || !this.suggestionManager) {
      return;
    }
    const candidate = this.resolveLateDiscoveryCandidate(event);
    if (!candidate) {
      return;
    }
    this.reportRuntimeActivity();
    const attachedNow = this.suggestionManager.queryAndAttachHelper(candidate);
    if (event.type === "focusin" || (event.type === "input" && attachedNow)) {
      this.suggestionManager.triggerActiveSuggestion();
    }
  }

  private resolveLateDiscoveryCandidate(event: Event): Element | null {
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) {
        continue;
      }
      const shadowActiveElement = node.shadowRoot?.activeElement;
      if (
        shadowActiveElement instanceof Element &&
        shadowActiveElement.matches(ContentRuntimeController.SELECTORS)
      ) {
        return shadowActiveElement;
      }
      if (node.matches(ContentRuntimeController.SELECTORS)) {
        return node;
      }
      const matchingAncestor = node.closest(ContentRuntimeController.SELECTORS);
      if (matchingAncestor) {
        return matchingAncestor;
      }
    }
    return null;
  }

  private initializeSuggestionManager(): void {
    this.predictionGeneration += 1;
    const generation = this.predictionGeneration;
    logger.debug("Initializing suggestion manager", {
      lang: this.config.lang,
      autocomplete: this.config.autocomplete,
      minWordLengthToPredict: this.config.minWordLengthToPredict,
      generation,
    });
    const managerOptions = {
      // Only Docs' hidden input iframe is excluded; titles/comments keep the normal helper.
      selectors: isGoogleDocsInputFrame() ? ":not(*)" : ContentRuntimeController.SELECTORS,
      minWordLengthToPredict: this.config.minWordLengthToPredict,
      autocomplete: this.config.autocomplete,
      autocompleteOnEnter: this.config.autocompleteOnEnter,
      autocompleteOnTab: this.config.autocompleteOnTab,
      insertSpaceAfterAutocomplete: this.config.insertSpaceAfterAutocomplete,
      lang: this.config.lang,
      selectByDigit: this.config.selectByDigit,
      displayLangHeader: this.config.displayLangHeader,
      inline_suggestion: this.config.inline_suggestion,
      preferNativeAutocomplete: this.config.preferNativeAutocomplete,
      // Code mode keeps FluentTyper from rewriting code: only rules that never
      // touch code run.
      enabledGrammarRules: this.config.codeMode
        ? filterCodeSafeGrammarRules(this.config.enabledGrammarRules)
        : this.config.enabledGrammarRules,
      userDictionaryList: this.config.userDictionaryList,
      getPrediction: (context: ContentScriptPredictRequestContext) =>
        this.onPredictionRequest?.({
          ...context,
          runtimeGeneration: generation,
        }),
      onShadowRootDiscovered: this.registerShadowRoot.bind(this),
    };
    this.suggestionManager = new SuggestionManagerRuntime(managerOptions);
    if (this.reviewSuspended) this.suggestionManager.suspendForReview(this.reviewSuspended);
    if (isGoogleDocsPage()) this.googleDocs = new GoogleDocsAdapter(managerOptions);
    this.reportRuntimeActivity();
  }

  private reportRuntimeActivity(): void {
    if (this.predictionGeneration <= 0) {
      return;
    }
    this.onRuntimeActivity?.(this.predictionGeneration);
  }
}
