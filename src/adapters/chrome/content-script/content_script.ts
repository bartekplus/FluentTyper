import { TributeManager } from "./TributeManager";
import { DomObserver } from "./DomObserver";
import { ThemeApplicator } from "./ThemeApplicator";
import {
  CMD_BACKGROUND_PAGE_PREDICT_RESP,
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_CONTENT_SCRIPT_PREDICT_REQ,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
  CMD_POPUP_PAGE_ENABLE,
  CMD_POPUP_PAGE_DISABLE,
  CMD_STATUS_COMMAND,
  CMD_GET_HOSTNAME,
} from "@core/domain/constants";
import { LANG_SEPARATOR_CHARS_REGEX } from "@core/domain/lang";
import { checkLastError, isInDocument } from "@core/application/utils";
import type {
  Message,
  ContentScriptPredictRequestContext,
  ContentScriptPredictRequestMessage,
  PopupPageStatusMessage,
  ContentScriptGetConfigMessage,
  SetConfigContext,
} from "@core/domain/messageTypes";

/**
 * Extend the Window interface to include FluentTyper.
 */
declare global {
  interface Window {
    FluentTyper?: FluentTyper;
  }
}

/**
 * FluentTyper class for creating a fluent typing experience with autocomplete functionality.
 */
class FluentTyper {
  // Logging prefix for all logs in this module
  private static readonly LOG_PREFIX = "ContentScript";
  private static readonly WATCHDOG_DEBOUNCE_MS = 250;
  private static readonly MUTATION_COALESCE_DELAY_MS = 16;
  private static readonly MAX_MUTATION_BATCH_SIZE = 200;
  private static readonly MAX_MUTATION_ROOTS = 64;

  private readonly SELECTORS: string = "textarea, input, [contentEditable]";
  public tributeManager: TributeManager | null = null;
  private pendingReq: ContentScriptPredictRequestMessage | null = null;
  private _enabled: boolean = false;
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
  public domObserver: DomObserver;
  private hostName: string = window.location.hostname;
  private watchDogTimeoutId: number | null = null;
  private mutationProcessTimeoutId: number | null = null;
  private mutationProcessingScheduled: boolean = false;
  private pendingMutations: MutationRecord[] = [];
  private rootNodeObserver: MutationObserver | null = null;
  private readonly scheduleWatchDogCheckBound: () => void;
  private readonly themeApplicator: ThemeApplicator;

  constructor() {
    console.info(
      "[%s:%s] Initializing on %s",
      FluentTyper.LOG_PREFIX,
      this.constructor.name,
      window.location.hostname,
    );
    this.scheduleWatchDogCheckBound = this.scheduleWatchDogCheck.bind(this);
    this.themeApplicator = new ThemeApplicator();
    this.domObserver = new DomObserver(
      document.body || document.documentElement,
      this.mutationCallback.bind(this),
    );
    this.attachRootNodeObserver();
    this.attachWatchDogEventListeners();
    chrome.runtime.onMessage.addListener(this.messageHandler.bind(this));
    this.getConfig();
    this.scheduleWatchDogCheck();
  }

  private attachRootNodeObserver(): void {
    if (this.rootNodeObserver) {
      return;
    }
    this.rootNodeObserver = new MutationObserver(() => {
      this.scheduleWatchDogCheck();
    });
    this.rootNodeObserver.observe(document.documentElement, {
      childList: true,
    });
  }

  private attachWatchDogEventListeners(): void {
    window.navigation?.addEventListener(
      "navigate",
      this.scheduleWatchDogCheckBound,
    );
    window.addEventListener("pageshow", this.scheduleWatchDogCheckBound);
    window.addEventListener("popstate", this.scheduleWatchDogCheckBound);
    window.addEventListener("hashchange", this.scheduleWatchDogCheckBound);
    window.addEventListener("focus", this.scheduleWatchDogCheckBound, true);
    document.addEventListener(
      "visibilitychange",
      this.scheduleWatchDogCheckBound,
    );
    document.addEventListener(
      "readystatechange",
      this.scheduleWatchDogCheckBound,
    );
  }

  private scheduleWatchDogCheck(): void {
    if (this.watchDogTimeoutId !== null) {
      window.clearTimeout(this.watchDogTimeoutId);
    }
    this.watchDogTimeoutId = window.setTimeout(() => {
      this.watchDogTimeoutId = null;
      this.watchDog();
    }, FluentTyper.WATCHDOG_DEBOUNCE_MS);
  }

  checkHostName(): boolean {
    if (this.hostName !== window.location.hostname) {
      console.info(
        "[%s:%s:%s] Host name changed, re-fetching config",
        FluentTyper.LOG_PREFIX,
        this.constructor.name,
        this.checkHostName.name,
      );
      this.hostName = window.location.hostname;
      this.getConfig();
      return true;
    }
    return false;
  }
  /**
   * Checks if the node has changed and re-enables the plugin if necessary.
   */
  watchDog(): void {
    const currentNode = document.body || document.documentElement;
    if (this.checkHostName()) {
      console.debug(
        "[%s:%s:%s] Host name changed in watchDog, returning",
        FluentTyper.LOG_PREFIX,
        this.constructor.name,
        this.watchDog.name,
      );
      return;
    }
    if (this.domObserver.getNode() !== currentNode) {
      console.warn(
        "[%s:%s:%s] DOM node changed, restarting",
        FluentTyper.LOG_PREFIX,
        this.constructor.name,
        this.watchDog.name,
      );
      if (this.enabled) {
        this.restart();
      }
      this.domObserver.setNode(currentNode);
    }
  }

  set enabled(newValue: boolean) {
    if (this._enabled !== newValue) {
      console.info(
        "[%s:%s:%s] enabled set to %s",
        FluentTyper.LOG_PREFIX,
        this.constructor.name,
        "set enabled",
        newValue,
      );
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

  attachMutationObserver(): void {
    this.domObserver.attach();
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

  private scheduleMutationProcessing(): void {
    if (this.mutationProcessingScheduled) {
      return;
    }
    this.mutationProcessingScheduled = true;
    this.mutationProcessTimeoutId = window.setTimeout(() => {
      this.mutationProcessingScheduled = false;
      this.mutationProcessTimeoutId = null;
      const mergedMutations = this.pendingMutations;
      this.pendingMutations = [];
      if (!this.enabled || mergedMutations.length === 0) {
        return;
      }
      this.processMutations(mergedMutations);
    }, FluentTyper.MUTATION_COALESCE_DELAY_MS);
  }

  /**
   * Callback for TributeManager to request predictions.
   */
  handleGetPrediction(context: ContentScriptPredictRequestContext): void {
    console.debug(
      "[%s:%s:%s] called with context:",
      FluentTyper.LOG_PREFIX,
      this.constructor.name,
      this.handleGetPrediction.name,
      context,
    );
    const message: ContentScriptPredictRequestMessage = {
      command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
      context: {
        text: context.text,
        nextChar: context.nextChar,
        tributeId: context.tributeId,
        requestId: context.requestId,
        lang: this.config.lang,
      },
    };
    this.pendingReq = message;
    chrome.runtime.sendMessage(message);
  }

  initializeTributeManager(): void {
    console.info(
      "[%s:%s:%s] Initializing TributeManager with config:",
      FluentTyper.LOG_PREFIX,
      this.constructor.name,
      this.initializeTributeManager.name,
      this.config,
    );
    this.tributeManager = new TributeManager({
      selectors: this.SELECTORS,
      minWordLengthToPredict: this.config.minWordLengthToPredict,
      autocomplete: this.config.autocomplete,
      autocompleteOnEnter: this.config.autocompleteOnEnter,
      autocompleteOnTab: this.config.autocompleteOnTab,
      lang: this.config.lang,
      selectByDigit: this.config.selectByDigit,
      revertOnBackspace: this.config.revertOnBackspace,
      displayLangHeader: this.config.displayLangHeader,
      inline_suggestion: this.config.inline_suggestion,
      getPrediction: this.handleGetPrediction.bind(this),
    });
    // Set autocompleteSeparator property after construction
    if (this.tributeManager) {
      this.tributeManager.autocompleteSeparator =
        LANG_SEPARATOR_CHARS_REGEX[this.config.lang] || /\s+/;
    }
  }

  /**
   * Processes the mutations and attaches or detaches Tribute components as needed.
   */
  processMutations(mutationsList: MutationRecord[]): void {
    console.groupCollapsed(
      "[%s:%s:%s] Starting processMutations with %d mutations",
      FluentTyper.LOG_PREFIX,
      this.constructor.name,
      this.processMutations.name,
      mutationsList.length,
    );
    this.domObserver.disconnect();
    try {
      if (!this.tributeManager) {
        return;
      }
      this.tributeManager.removeHelpersNotInDocument();

      if (mutationsList.length >= FluentTyper.MAX_MUTATION_BATCH_SIZE) {
        this.tributeManager.queryAndAttachHelper();
        return;
      }

      const mutationRoots = this.collectMutationRoots(mutationsList);
      if (mutationRoots.length === 0) {
        return;
      }

      if (mutationRoots.length >= FluentTyper.MAX_MUTATION_ROOTS) {
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
      console.groupEnd();
    }
  }

  /**
   * A callback function for the MutationObserver that processes the mutations.
   */
  mutationCallback(mutationsList: MutationRecord[]): void {
    if (mutationsList.length === 0 || !this.enabled) {
      return;
    }
    this.pendingMutations.push(...mutationsList);
    this.scheduleMutationProcessing();
  }

  /**
   * Sets the configuration options for Tribute.
   */
  setConfig(config: SetConfigContext): void {
    console.info(
      "[%s:%s:%s] setConfig called with config:",
      FluentTyper.LOG_PREFIX,
      this.constructor.name,
      this.setConfig.name,
      config,
    );
    this.config = config;

    // Apply theme configuration if provided
    if (config.themeConfig) {
      this.applyTheme(config.themeConfig);
    }

    if (this.enabled && config.enabled) {
      console.warn(
        "[%s:%s:%s] Restarting due to config change",
        FluentTyper.LOG_PREFIX,
        this.constructor.name,
        this.setConfig.name,
      );
      this.restart();
    } else {
      this.enabled = config.enabled;
      if (!this.enabled) {
        this.tributeManager = null;
      }
    }
  }

  /**
   * Enables Tribute by querying for and attaching helpers, and attaching a mutation observer.
   */
  enable(): void {
    console.groupCollapsed(
      "[%s:%s:%s] Enabling FluentTyper",
      FluentTyper.LOG_PREFIX,
      this.constructor.name,
      this.enable.name,
    );
    if (!this.tributeManager) {
      this.initializeTributeManager();
    }
    this.tributeManager?.queryAndAttachHelper();
    this.attachMutationObserver();
    console.groupEnd();
  }

  /**
   * Disables Tribute by disconnecting the mutation observer and detaching all helpers.
   */
  disable(): void {
    console.groupCollapsed(
      "[%s:%s:%s] Disabling FluentTyper",
      FluentTyper.LOG_PREFIX,
      this.constructor.name,
      this.disable.name,
    );
    this.domObserver.disconnect();
    if (this.mutationProcessTimeoutId !== null) {
      window.clearTimeout(this.mutationProcessTimeoutId);
      this.mutationProcessTimeoutId = null;
    }
    this.mutationProcessingScheduled = false;
    this.pendingMutations = [];
    this.tributeManager?.detachAllHelpers();
    console.groupEnd();
  }

  /**
   * Restarts Tribute by disabling and then enabling it again.
   */
  restart(): void {
    console.warn(
      "[%s:%s:%s] Restarting FluentTyper",
      FluentTyper.LOG_PREFIX,
      this.constructor.name,
      this.restart.name,
    );
    this.disable();
    this.tributeManager = null;
    setTimeout(() => {
      if (this._enabled) this.enable();
    }, 0);
  }

  /**
   * Handles incoming messages from content scripts and popup pages.
   */
  messageHandler(
    message: Message,
    sender?: chrome.runtime.MessageSender,
    sendResponse?: (response: unknown) => void,
  ): void {
    checkLastError();
    let sendStatusMsg = false;
    if (!message) {
      console.error(
        "[%s:%s:%s] Received empty message in messageHandler",
        FluentTyper.LOG_PREFIX,
        this.constructor.name,
        this.messageHandler.name,
      );
      return;
    }
    console.groupCollapsed(
      "[%s:%s:%s] Handling message %s:",
      FluentTyper.LOG_PREFIX,
      this.constructor.name,
      this.messageHandler.name,
      message.command,
      message,
    );

    switch (message.command) {
      case CMD_BACKGROUND_PAGE_PREDICT_RESP:
        if (
          this.pendingReq &&
          this.pendingReq.context.tributeId === message.context.tributeId &&
          this.pendingReq.context.requestId === message.context.requestId
        ) {
          console.info(
            "[%s:%s:%s] Fulfilling prediction with context:",
            FluentTyper.LOG_PREFIX,
            this.constructor.name,
            this.messageHandler.name,
            message.context,
          );
          this.tributeManager?.fulfillPrediction(message.context);
          this.pendingReq = null;
        } else {
          console.warn(
            "[%s:%s:%s] Prediction response ignored (mismatch or no pending request):",
            FluentTyper.LOG_PREFIX,
            this.constructor.name,
            this.messageHandler.name,
            message.context,
          );
        }
        break;
      case CMD_BACKGROUND_PAGE_SET_CONFIG:
        this.setConfig(message.context);
        sendStatusMsg = true;
        break;
      case CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG:
        this.config.lang = message.context.lang;
        this.tributeManager?.updateLangConfig(this.config.lang);
        sendStatusMsg = true;
        break;
      case CMD_POPUP_PAGE_DISABLE:
        this.enabled = false;
        sendStatusMsg = true;
        break;
      case CMD_POPUP_PAGE_ENABLE:
        this.enabled = true;
        sendStatusMsg = true;
        console.groupEnd();
        break;
      case CMD_TOGGLE_FT_ACTIVE_TAB:
        this.enabled = !this.enabled;
        sendStatusMsg = true;
        console.groupEnd();
        break;
      case CMD_TRIGGER_FT_ACTIVE_TAB:
        this.tributeManager?.triggerActiveTribute();
        sendStatusMsg = true;
        break;
      case CMD_GET_HOSTNAME:
        if (sendResponse) sendResponse({ hostname: window.location.hostname });
        break;
      default:
        console.trace(
          "[%s:%s:%s] Unknown message command: %s",
          FluentTyper.LOG_PREFIX,
          this.constructor.name,
          this.messageHandler.name,
          message.command,
          message,
        );
        break;
    }
    if (sendStatusMsg) {
      const statusMsg: PopupPageStatusMessage = {
        command: CMD_STATUS_COMMAND,
        context: { enabled: this.enabled },
      };
      if (sendResponse) sendResponse(statusMsg);
    }
    console.groupEnd();
  }

  /**
   * Retrieves the configuration from the background script.
   */
  getConfig(): void {
    const msg: ContentScriptGetConfigMessage = {
      command: CMD_CONTENT_SCRIPT_GET_CONFIG,
      context: {},
    };
    chrome.runtime.sendMessage(msg, (response: unknown) => {
      checkLastError();
      this.messageHandler(response as Message);
    });
  }

  /**
   * Applies custom theme colors by injecting CSS variables.
   */
  private applyTheme(
    themeSettings: NonNullable<SetConfigContext["themeConfig"]>,
  ): void {
    this.themeApplicator.apply(themeSettings);
  }
}

if (!window.FluentTyper) {
  window.FluentTyper = new FluentTyper();
}
