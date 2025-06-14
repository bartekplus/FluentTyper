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
import { checkLastError } from "../shared/utils";
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
  public autocomplete: boolean = false;
  public autocompleteOnEnter: boolean = true;
  public autocompleteOnTab: boolean = true;
  public lang: string = "en_US";
  public domObserver: DomObserver;
  public activeHelperArrId: string | null = null;
  public minWordLengthToPredict: number = 0;
  public revertOnBackspace: boolean = true;
  public selectByDigit: boolean = false;
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
        lang: this.lang,
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
  handleTributeTrigger(helperArrId: string): void {
    this.activeHelperArrId = helperArrId;
  }

  initializeTributeManager(): void {
    this.tributeManager = new TributeManager({
      selectors: this.SELECTORS,
      minWordLengthToPredict: this.minWordLengthToPredict,
      autocomplete: this.autocomplete,
      autocompleteOnEnter: this.autocompleteOnEnter,
      autocompleteOnTab: this.autocompleteOnTab,
      lang: this.lang,
      selectByDigit: this.selectByDigit,
      revertOnBackspace: this.revertOnBackspace,
      getPrediction: this.handleGetPrediction.bind(this),
      onTrigger: this.handleTributeTrigger.bind(this),
    });
    // Set autocompleteSeparator property after construction
    if (this.tributeManager) {
      this.tributeManager.autocompleteSeparator =
        LANG_SEPERATOR_CHARS_REGEX[this.lang] || /\s+/;
    }
  }

  /**
   * Checks if a Tribute instance is attached to the specified element.
   */
  isHelperAttached(elem: HTMLElement): boolean {
    if (!this.tributeManager) return false;
    for (const [key] of Object.entries(this.tributeManager.tributeArr)) {
      if (elem === this.tributeManager.tributeArr[key].elem) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if the given element is part of the document tree.
   */
  isInDocument(element: Element): boolean {
    return element.ownerDocument === document;
  }

  /**
   * Processes the mutations and attaches or detaches Tribute components as needed.
   */
  processMutations(mutationsList: MutationRecord[]): void {
    this.domObserver.disconnect();
    if (this.tributeManager) {
      for (const [key, entry] of Object.entries(
        this.tributeManager.tributeArr,
      )) {
        if (!this.isInDocument(entry.elem)) {
          this.tributeManager.detachHelper(key);
        }
      }
    }
    for (const mutation of mutationsList) {
      mutation.addedNodes.forEach((element) => {
        if (element instanceof Element && this.isInDocument(element)) {
          this.tributeManager?.queryAndAttachHelper(element);
        }
      });
      if (mutation.type === "attributes") {
        if (
          mutation.target instanceof Element &&
          this.isInDocument(mutation.target)
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
    this.autocomplete = config.autocomplete;
    this.autocompleteOnEnter = config.autocompleteOnEnter;
    this.autocompleteOnTab = config.autocompleteOnTab;
    this.lang = config.lang;
    this.selectByDigit = config.selectByDigit;
    this.minWordLengthToPredict =
      config.minWordLengthToPredict === -1
        ? Number.MAX_VALUE
        : config.minWordLengthToPredict;
    this.revertOnBackspace = config.revertOnBackspace;
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
          console.log(
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
        this.lang = message.context.lang;
        if (this.tributeManager && this.activeHelperArrId !== null) {
          this.tributeManager.updateLangConfig(
            this.lang,
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
