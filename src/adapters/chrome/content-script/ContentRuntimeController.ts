import { createLogger } from "@core/application/logging/Logger";
import type {
  ContentScriptPredictRequestContext,
  PredictResponseContext,
  SetConfigContext,
} from "@core/domain/messageTypes";
import { DomObserver } from "./DomObserver";
import { MutationPipeline, type MutationPlan } from "./MutationPipeline";
import { MutationScheduler } from "./MutationScheduler";
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
    themeConfig: undefined,
    enabledGrammarRules: [],
    userDictionaryList: [],
  };
  public readonly domObserver: DomObserver;

  private _enabled = false;
  private onPredictionRequest: ((context: ContentScriptPredictRequestContext) => void) | null =
    null;
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
    this.config.lang = lang;
    this.suggestionManager?.updateLangConfig(this.config.lang);
  }

  triggerActiveSuggestion(): void {
    this.suggestionManager?.triggerActiveSuggestion();
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
    logger.debug("Processing DOM mutations", {
      mutationCount: mutationsList.length,
    });
    this.domObserver.disconnect();
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
  }

  disable(): void {
    logger.info("Disabling content runtime");
    if (this.pendingRestartTimer !== null) {
      clearTimeout(this.pendingRestartTimer);
      this.pendingRestartTimer = null;
      this.pendingRestartToken = null;
    }
    this.domObserver.disconnect();
    this.mutationScheduler.clear();
    this.suggestionManager?.detachAllHelpers();
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
      enabledGrammarRules: this.config.enabledGrammarRules,
      userDictionaryList: this.config.userDictionaryList,
      getPrediction: (context: ContentScriptPredictRequestContext) =>
        this.onPredictionRequest?.({
          ...context,
          runtimeGeneration: generation,
        }),
    });
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
