import { LANG_SEPARATOR_CHARS_REGEX } from "@core/domain/lang";
import { isInDocument } from "@core/application/utils";
import { createLogger } from "@core/application/logging/Logger";
import type {
  ContentScriptPredictRequestContext,
  PredictResponseContext,
  SetConfigContext,
} from "@core/domain/messageTypes";
import { DomObserver } from "./DomObserver";
import { MutationScheduler } from "./MutationScheduler";
import { ThemeApplicator } from "./ThemeApplicator";
import { TributeManager } from "./TributeManager";

const logger = createLogger("ContentRuntimeController");

export class ContentRuntimeController {
  private static readonly SELECTORS = "textarea, input, [contentEditable]";
  private static readonly MUTATION_COALESCE_DELAY_MS = 16;
  private static readonly MAX_MUTATION_BATCH_SIZE = 200;
  private static readonly MAX_MUTATION_ROOTS = 64;

  public tributeManager: TributeManager | null = null;
  public config: SetConfigContext = {
    enabled: false,
    autocomplete: false,
    autocompleteOnEnter: true,
    autocompleteOnTab: true,
    lang: "en_US",
    selectByDigit: false,
    minWordLengthToPredict: 0,
    revertOnBackspace: true,
    displayLangHeader: true,
    inline_suggestion: false,
    themeConfig: undefined,
  };
  public readonly domObserver: DomObserver;

  private _enabled = false;
  private onPredictionRequest: ((context: ContentScriptPredictRequestContext) => void) | null =
    null;
  private onRestartRequest: () => void;
  private readonly mutationScheduler: MutationScheduler;

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
      this.tributeManager = null;
    }
  }

  updateLanguage(lang: string): void {
    this.config.lang = lang;
    this.tributeManager?.updateLangConfig(this.config.lang);
  }

  triggerActiveTribute(): void {
    this.tributeManager?.triggerActiveTribute();
  }

  fulfillPrediction(context: PredictResponseContext): void {
    this.tributeManager?.fulfillPrediction(context);
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
      if (!this.tributeManager) {
        return;
      }
      this.tributeManager.removeHelpersNotInDocument();

      if (mutationsList.length >= ContentRuntimeController.MAX_MUTATION_BATCH_SIZE) {
        this.tributeManager.queryAndAttachHelper();
        return;
      }

      const mutationRoots = this.collectMutationRoots(mutationsList);
      if (mutationRoots.length === 0) {
        return;
      }

      if (mutationRoots.length >= ContentRuntimeController.MAX_MUTATION_ROOTS) {
        this.tributeManager.queryAndAttachHelper();
        return;
      }

      for (const mutationRoot of mutationRoots) {
        this.tributeManager.queryAndAttachHelper(mutationRoot);
      }
    } finally {
      if (this.enabled) {
        this.attachMutationObserver();
      }
    }
  }

  enable(): void {
    logger.info("Enabling content runtime");
    if (!this.tributeManager) {
      this.initializeTributeManager();
    }
    this.tributeManager?.queryAndAttachHelper();
    this.attachMutationObserver();
  }

  disable(): void {
    logger.info("Disabling content runtime");
    this.domObserver.disconnect();
    this.mutationScheduler.clear();
    this.tributeManager?.detachAllHelpers();
  }

  restart(): void {
    logger.warn("Restarting content runtime");
    this.disable();
    this.tributeManager = null;
    setTimeout(() => {
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

  private initializeTributeManager(): void {
    logger.debug("Initializing tribute manager", {
      lang: this.config.lang,
      autocomplete: this.config.autocomplete,
      minWordLengthToPredict: this.config.minWordLengthToPredict,
    });
    this.tributeManager = new TributeManager({
      selectors: ContentRuntimeController.SELECTORS,
      minWordLengthToPredict: this.config.minWordLengthToPredict,
      autocomplete: this.config.autocomplete,
      autocompleteOnEnter: this.config.autocompleteOnEnter,
      autocompleteOnTab: this.config.autocompleteOnTab,
      lang: this.config.lang,
      selectByDigit: this.config.selectByDigit,
      revertOnBackspace: this.config.revertOnBackspace,
      displayLangHeader: this.config.displayLangHeader,
      inline_suggestion: this.config.inline_suggestion,
      getPrediction: (context: ContentScriptPredictRequestContext) =>
        this.onPredictionRequest?.(context),
    });
    if (this.tributeManager) {
      this.tributeManager.autocompleteSeparator =
        LANG_SEPARATOR_CHARS_REGEX[this.config.lang] || /\s+/;
    }
  }

  private getElementDepth(element: Element): number {
    let depth = 0;
    let currentNode: Node | null = element;
    while (currentNode.parentNode) {
      depth += 1;
      currentNode = currentNode.parentNode;
    }
    return depth;
  }

  private collectMutationRoots(mutationsList: MutationRecord[]): Element[] {
    const candidates: Element[] = [];
    for (const mutation of mutationsList) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element && isInDocument(node)) {
          candidates.push(node);
        }
      });
      if (
        mutation.type === "attributes" &&
        mutation.target instanceof Element &&
        isInDocument(mutation.target)
      ) {
        candidates.push(mutation.target);
      }
    }
    if (candidates.length === 0) {
      return [];
    }

    const uniqueCandidates = Array.from(new Set(candidates));
    uniqueCandidates.sort(
      (left, right) => this.getElementDepth(left) - this.getElementDepth(right),
    );

    const roots: Element[] = [];
    for (const candidate of uniqueCandidates) {
      if (roots.some((root) => root === candidate || root.contains(candidate))) {
        continue;
      }
      for (let i = roots.length - 1; i >= 0; i -= 1) {
        if (candidate.contains(roots[i])) {
          roots.splice(i, 1);
        }
      }
      roots.push(candidate);
    }
    return roots;
  }
}
