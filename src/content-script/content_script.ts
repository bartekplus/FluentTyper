import { TributeManager } from "./TributeManager";
import { DomObserver } from "./DomObserver";
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
} from "../shared/constants";
import { LANG_SEPERATOR_CHARS_REGEX } from "../shared/lang";
import { checkLastError, isInDocument } from "../shared/utils";
import {
  Message,
  ContentScriptPredictRequestContext,
  ContentScriptPredictRequestMessage,
  PopupPageStatusMessage,
  ContentScriptGetConfigMessage,
  SetConfigContext,
} from "../shared/messageTypes";

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
  };
  public domObserver: DomObserver;
  private hostName: string = window.location.hostname;

  constructor() {
    console.info(
      "[%s:%s] Initializing on %s",
      FluentTyper.LOG_PREFIX,
      this.constructor.name,
      window.location.hostname,
    );
    this.domObserver = new DomObserver(
      document.body || document.documentElement,
      this.mutationCallback.bind(this),
    );
    chrome.runtime.onMessage.addListener(this.messageHandler.bind(this));
    this.getConfig();
    setInterval(this.watchDog.bind(this), 1000);
    window.navigation?.addEventListener("navigate", () => {
      this.checkHostName();
    });
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
      getPrediction: this.handleGetPrediction.bind(this),
    });
    // Set autocompleteSeparator property after construction
    if (this.tributeManager) {
      this.tributeManager.autocompleteSeparator =
        LANG_SEPERATOR_CHARS_REGEX[this.config.lang] || /\s+/;
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
    this.tributeManager?.removeHelpersNotInDocument();
    for (const mutation of mutationsList) {
      mutation.addedNodes.forEach((element) => {
        if (element instanceof Element && isInDocument(element)) {
          this.tributeManager?.queryAndAttachHelper(element);
        }
      });
      if (mutation.type === "attributes") {
        if (
          mutation.target instanceof Element &&
          isInDocument(mutation.target)
        ) {
          this.tributeManager?.queryAndAttachHelper(mutation.target);
        }
      }
    }
    this.attachMutationObserver();
    console.groupEnd();
  }

  /**
   * A callback function for the MutationObserver that processes the mutations.
   */
  mutationCallback(mutationsList: MutationRecord[]): void {
    setTimeout(() => this.processMutations(mutationsList), 0);
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
    this.tributeManager = null;
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
    sendResponse?: (response: any) => void,
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
    chrome.runtime.sendMessage(msg, (response: any) => {
      checkLastError();
      this.messageHandler(response);
    });
  }
}

if (!window.FluentTyper) {
  window.FluentTyper = new FluentTyper();
}
