import { createLogger, setGlobalObservabilityRuntime } from "@core/application/logging/Logger";
import { isInDocument } from "@core/application/dom-utils";
import type {
  ContentScriptPredictRequestContext,
  PredictResponseContext,
  SetConfigContext,
} from "@core/domain/messageTypes";
import { DomObserver } from "./DomObserver";
import { MutationPipeline, type MutationPlan } from "./MutationPipeline";
import { MutationScheduler } from "./MutationScheduler";
import { ShadowRootInterceptor } from "./ShadowRootInterceptor";
import { ThemeApplicator } from "./ThemeApplicator";
import { SuggestionManager } from "./SuggestionManager";

const logger = createLogger("ContentRuntimeController");

export class ContentRuntimeController {
  private static readonly SELECTORS = "textarea, input, [contentEditable]";
  private static readonly MUTATION_COALESCE_DELAY_MS = 16;
  private static readonly MAX_MUTATION_BATCH_SIZE = 200;
  private static readonly MAX_MUTATION_ROOTS = 64;

  public suggestionManager: SuggestionManager | null = null;
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
    themeConfig: undefined,
    enabledGrammarRules: [],
    userDictionaryList: [],
  };
  public readonly domObserver: DomObserver;
  private readonly shadowObservers = new Map<ShadowRoot, DomObserver>();
  private shadowRootInterceptor: ShadowRootInterceptor | null = null;
  private lateDiscoveryListenersAttached = false;
  private readonly onDocumentFocusInBound: EventListener =
    this.onDocumentPotentialLateTarget.bind(this);
  private readonly onDocumentMouseDownBound: EventListener =
    this.onDocumentPotentialLateTarget.bind(this);
  private readonly onDocumentInputBound: EventListener =
    this.onDocumentPotentialLateTarget.bind(this);

  private _enabled = false;
  private onPredictionRequest: ((context: ContentScriptPredictRequestContext) => void) | null =
    null;
  private onRuntimeActivity: ((runtimeGeneration: number) => void) | null = null;
  private onRestartRequest: () => void;
  private readonly mutationPipeline: MutationPipeline;
  private readonly mutationScheduler: MutationScheduler;
  private predictionGeneration = 0;
  private pendingRestartToken: symbol | null = null;
  private pendingRestartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly themeApplicator: ThemeApplicator = new ThemeApplicator()) {
    this.domObserver = new DomObserver(
      document.body || document.documentElement,
      this.mutationCallback.bind(this),
    );
    this.mutationScheduler = new MutationScheduler(
      ContentRuntimeController.MUTATION_COALESCE_DELAY_MS,
      (mutations) => {
        if (!this.enabled || mutations.length === 0) {
          return;
        }
        this.processMutations(mutations);
      },
    );
    this.mutationPipeline = new MutationPipeline(
      ContentRuntimeController.MAX_MUTATION_BATCH_SIZE,
      ContentRuntimeController.MAX_MUTATION_ROOTS,
    );
    this.onRestartRequest = this.restart.bind(this);
  }

  setPredictionRequestHandler(
    handler: (context: ContentScriptPredictRequestContext) => void,
  ): void {
    this.onPredictionRequest = handler;
  }

  setRestartRequestHandler(handler: () => void): void {
    this.onRestartRequest = handler;
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
  }

  triggerActiveSuggestion(): void {
    this.suggestionManager?.triggerActiveSuggestion();
  }

  handleEarlyTabAcceptRequest(entryId: string): EarlyTabAcceptResult {
    return (
      this.suggestionManager?.handleEarlyTabAcceptRequest(entryId) ?? {
        accepted: false,
        reason: "entry_not_found",
        entryId,
        suggestionCount: 0,
        menuVisible: false,
        hasInlineSuggestion: false,
      }
    );
  }

  getPredictionGeneration(): number {
    return this.predictionGeneration;
  }

  fulfillPrediction(context: PredictResponseContext): void {
    if (
      typeof context.runtimeGeneration === "number" &&
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
    this.suggestionManager?.fulfillPrediction(context);
  }

  attachMutationObserver(): void {
    this.domObserver.attach();
  }

  mutationCallback(mutationsList: MutationRecord[]): void {
    if (mutationsList.length === 0 || !this.enabled) {
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
    for (const o of this.shadowObservers.values()) {
      o.disconnect();
    }
    try {
      if (!this.suggestionManager) {
        return;
      }
      this.suggestionManager.removeHelpersNotInDocument();

      const mutationPlan = this.mutationPipeline.buildPlan(mutationsList);
      this.executeMutationPlan(mutationPlan);
    } finally {
      if (this.enabled) {
        this.attachMutationObserver();
        for (const [root, observer] of this.shadowObservers.entries()) {
          if (!isInDocument(root.host)) {
            observer.disconnect();
            this.shadowObservers.delete(root);
          } else {
            observer.attach();
          }
        }
      }
    }
  }

  enable(): void {
    logger.info("Enabling content runtime");
    if (!this.suggestionManager) {
      this.initializeSuggestionManager();
    }
    this.suggestionManager?.queryAndAttachHelper();
    this.suggestionManager?.triggerActiveSuggestion();
    this.attachMutationObserver();
    for (const o of this.shadowObservers.values()) {
      o.attach();
    }
    this.ensureShadowRootInterceptor();
    this.ensureLateDiscoveryListeners();
    this.reportRuntimeActivity();
  }

  disable(): void {
    logger.info("Disabling content runtime");
    if (this.pendingRestartTimer !== null) {
      clearTimeout(this.pendingRestartTimer);
      this.pendingRestartTimer = null;
      this.pendingRestartToken = null;
    }
    this.domObserver.disconnect();
    for (const o of this.shadowObservers.values()) {
      o.disconnect();
    }
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
    this.disable();
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
    const observer = new DomObserver(root, this.mutationCallback.bind(this));
    this.shadowObservers.set(root, observer);
    if (this.enabled) {
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
    document.addEventListener("focusin", this.onDocumentFocusInBound, true);
    document.addEventListener("mousedown", this.onDocumentMouseDownBound, true);
    document.addEventListener("input", this.onDocumentInputBound, true);
    this.lateDiscoveryListenersAttached = true;
  }

  private removeLateDiscoveryListeners(): void {
    if (!this.lateDiscoveryListenersAttached) {
      return;
    }
    document.removeEventListener("focusin", this.onDocumentFocusInBound, true);
    document.removeEventListener("mousedown", this.onDocumentMouseDownBound, true);
    document.removeEventListener("input", this.onDocumentInputBound, true);
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
    this.suggestionManager = new SuggestionManager({
      selectors: ContentRuntimeController.SELECTORS,
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
      enabledGrammarRules: this.config.enabledGrammarRules,
      userDictionaryList: this.config.userDictionaryList,
      getPrediction: (context: ContentScriptPredictRequestContext) =>
        this.onPredictionRequest?.({
          ...context,
          runtimeGeneration: generation,
        }),
      onShadowRootDiscovered: this.registerShadowRoot.bind(this),
    });
    this.reportRuntimeActivity();
  }

  private reportRuntimeActivity(): void {
    if (this.predictionGeneration <= 0) {
      return;
    }
    this.onRuntimeActivity?.(this.predictionGeneration);
  }

  private executeMutationPlan(mutationPlan: MutationPlan): void {
    if (!this.suggestionManager) {
      return;
    }

    if (mutationPlan.type === "full-scan") {
      this.suggestionManager.queryAndAttachHelper();
      return;
    }

    if (mutationPlan.type === "targeted-scan") {
      for (const mutationRoot of mutationPlan.roots) {
        this.suggestionManager.queryAndAttachHelper(mutationRoot);
      }
    }
  }
}
import type { EarlyTabAcceptResult } from "./suggestions/SuggestionManagerRuntime";
