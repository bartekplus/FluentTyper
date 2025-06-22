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
  public activeHelperArrId: number | null = null;
  private hostName: string = window.location.hostname;

  constructor() {
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
      // Re-fetch config if the host name has changed
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
      return;
    }
    if (this.domObserver.getNode() !== currentNode) {
      if (this.enabled) {
        this.restart();
      }
      this.domObserver.setNode(currentNode);
    }
  }

  set enabled(newValue: boolean) {
    if (this._enabled !== newValue) {
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
    chrome.runtime.sendMessage(message, (response: any) => {
      this.messageHandler(response);
      checkLastError();
    });
  }

  /**
   * Callback for TributeManager when a tribute element is triggered (e.g. by keydown).
   */
  handleTributeTrigger(helperArrId: number): void {
    this.activeHelperArrId = helperArrId;
  }

  initializeTributeManager(): void {
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
      onTrigger: this.handleTributeTrigger.bind(this),
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
    this.config = config;
    this.tributeManager = null;
    if (this.enabled && config.enabled) {
      this.restart();
    } else {
      this.enabled = config.enabled;
    }
  }

  /**
   * Enables Tribute by querying for and attaching helpers, and attaching a mutation observer.
   */
  enable(): void {
    if (!this.tributeManager) {
      this.initializeTributeManager();
    }
    this.tributeManager?.queryAndAttachHelper();
    this.attachMutationObserver();
  }

  /**
   * Disables Tribute by disconnecting the mutation observer and detaching all helpers.
   */
  disable(): void {
    this.domObserver.disconnect();
    this.tributeManager?.detachAllHelpers();
  }

  /**
   * Restarts Tribute by disabling and then enabling it again.
   */
  restart(): void {
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
    if (!message) return;
    switch (message.command) {
      case CMD_BACKGROUND_PAGE_PREDICT_RESP:
        if (
          this.pendingReq &&
          this.tributeManager &&
          message.context.tributeId !== undefined &&
          this.pendingReq.context.tributeId === message.context.tributeId &&
          this.pendingReq.context.requestId === message.context.requestId
        ) {
          this.tributeManager.fulfillPrediction(message.context);
          this.pendingReq = null;
        } else {
          console.debug(
            "Prediction response ignored (mismatch or no pending request):",
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
        if (this.tributeManager && this.activeHelperArrId !== null) {
          this.tributeManager.updateLangConfig(
            this.config.lang,
            this.activeHelperArrId,
          );
        }
        sendStatusMsg = true;
        break;
      case CMD_POPUP_PAGE_DISABLE:
        this.enabled = false;
        sendStatusMsg = true;
        break;
      case CMD_POPUP_PAGE_ENABLE:
        this.enabled = true;
        sendStatusMsg = true;
        break;
      case CMD_TOGGLE_FT_ACTIVE_TAB:
        this.enabled = !this.enabled;
        sendStatusMsg = true;
        break;
      case CMD_TRIGGER_FT_ACTIVE_TAB:
        if (this.tributeManager && this.activeHelperArrId !== null) {
          this.tributeManager.triggerTribute(this.activeHelperArrId);
        }
        sendStatusMsg = true;
        break;
      default:
        console.log("Unknown message:", message);
        break;
    }
    if (sendStatusMsg) {
      const statusMsg: PopupPageStatusMessage = {
        command: CMD_STATUS_COMMAND,
        context: { enabled: this.enabled },
      };
      if (sendResponse) sendResponse(statusMsg);
    }
  }

  /**
   * Method to get configuration using chrome runtime sendMessage API.
   */
  getConfig(): void {
    const message: ContentScriptGetConfigMessage = {
      command: CMD_CONTENT_SCRIPT_GET_CONFIG,
      context: {},
    };
    chrome.runtime.sendMessage(message, (response: any) => {
      this.messageHandler(response);
      checkLastError();
    });
  }
}

if (!window.FluentTyper) {
  window.FluentTyper = new FluentTyper();
}
