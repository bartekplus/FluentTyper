import { checkLastError } from "@core/application/transport-utils";
import { createLogger, installObservabilityRelay } from "@core/application/logging/Logger";
import {
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT,
  CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_MODULES,
} from "@core/domain/constants";
import type {
  ContentScriptGetConfigMessage,
  ContentScriptPredictRequestContext,
  Message,
  PredictResponseContext,
  SetConfigContext,
} from "@core/domain/messageTypes";
import { ContentMessageHandler } from "./ContentMessageHandler";
import { ContentRuntimeController } from "./ContentRuntimeController";
import { HostChangeWatcher } from "./HostChangeWatcher";
import { isEarlyTabAcceptMessage } from "./suggestions/EarlyTabAcceptBridgeProtocol";
import type { SuggestionManagerRuntime } from "./suggestions/SuggestionManagerRuntime";

declare global {
  interface Window {
    FluentTyper?: FluentTyper;
  }
}

const logger = createLogger("FluentTyperContentScript");

if (typeof __FT_DEV_BUILD__ !== "undefined" && __FT_DEV_BUILD__) {
  installObservabilityRelay({
    source: "content_script",
    eventCommand: CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT,
    modulesCommand: CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_MODULES,
  });
}

class FluentTyper {
  private readonly runtimeController: ContentRuntimeController;
  private readonly contentMessageHandler: ContentMessageHandler;
  private readonly hostChangeWatcher: HostChangeWatcher;
  private readonly boundMessageHandler = (
    message: Message | null,
    _sender?: chrome.runtime.MessageSender,
    sendResponse?: (response: unknown) => void,
  ) => this.messageHandler(message, sendResponse);
  private readonly boundEarlyTabAcceptHandler = (event: MessageEvent) => {
    if (isEarlyTabAcceptMessage(event.data)) {
      this.runtimeController.handleEarlyTabAcceptRequest(event.data.entryId);
    }
  };
  // document.open() (CKEditor 4 writes its editing frame so, also on setData) erases
  // every listener of this script and replaces the root element. Only an observer of
  // the document itself sees that: then a new instance starts on the new document.
  private readonly root = document.documentElement;
  private readonly documentRewriteObserver = new MutationObserver(() => {
    if (!document.documentElement || document.documentElement === this.root) return;
    logger.info("Document rewritten; restarting content script");
    this.destroy();
    window.FluentTyper = new FluentTyper();
  });
  private destroyed = false;

  constructor() {
    logger.info("Initializing content script", {
      host: window.location.hostname,
    });

    this.runtimeController = new ContentRuntimeController({
      onPredictionRequest: this.handleGetPrediction.bind(this),
      onRuntimeActivity: (runtimeGeneration) => {
        this.contentMessageHandler.reportRuntimeStatus(runtimeGeneration);
      },
    });

    this.contentMessageHandler = new ContentMessageHandler({
      getEnabled: () => this.enabled,
      setEnabled: (value: boolean) => {
        this.enabled = value;
      },
      toggleEnabled: () => {
        this.enabled = !this.enabled;
      },
      setConfig: (config: SetConfigContext) => this.setConfig(config),
      updateLanguage: (lang: string) => this.runtimeController.updateLanguage(lang),
      triggerActiveSuggestion: () => this.runtimeController.triggerActiveSuggestion(),
      reviewActiveEditor: (source) => this.runtimeController.reviewActiveEditor(source),
      fulfillPrediction: (context: PredictResponseContext) =>
        this.runtimeController.fulfillPrediction(context),
      getLanguage: () => this.runtimeController.config.lang,
    });

    this.hostChangeWatcher = new HostChangeWatcher({
      watchDogRunner: () => this.watchDog(),
      getObservedNode: () => this.runtimeController.getObservedNode(),
      setObservedNode: (node: Node) => this.runtimeController.setObservedNode(node),
      isRuntimeEnabled: () => this.enabled,
      restartRuntime: () => this.restart(),
      requestConfig: () => this.getConfig(),
    });

    chrome.runtime.onMessage.addListener(this.boundMessageHandler);
    this.documentRewriteObserver.observe(document, { childList: true });
    this.getConfig();
  }

  get suggestionManager(): SuggestionManagerRuntime | null {
    return this.runtimeController.suggestionManager;
  }

  set enabled(newValue: boolean) {
    this.runtimeController.enabled = newValue;
    this.syncPageListeners();
  }

  get enabled(): boolean {
    return this.runtimeController.enabled;
  }

  watchDog(): void {
    this.hostChangeWatcher.watchDog();
  }

  handleGetPrediction(context: ContentScriptPredictRequestContext): void {
    this.contentMessageHandler.handleGetPrediction(context);
  }

  setConfig(config: SetConfigContext): void {
    this.runtimeController.setConfig(config);
    this.syncPageListeners();
  }

  private syncPageListeners(): void {
    if (this.enabled) {
      this.hostChangeWatcher.start();
      window.addEventListener("message", this.boundEarlyTabAcceptHandler);
    } else {
      this.hostChangeWatcher.stop();
      window.removeEventListener("message", this.boundEarlyTabAcceptHandler);
    }
  }

  enable(): void {
    this.runtimeController.enable();
  }

  restart(): void {
    this.runtimeController.restart();
  }

  destroy(): void {
    logger.info("Destroying content script instance");
    this.destroyed = true;
    this.documentRewriteObserver.disconnect();
    this.hostChangeWatcher.stop();
    this.runtimeController.disable();
    window.removeEventListener("message", this.boundEarlyTabAcceptHandler);
    chrome.runtime.onMessage.removeListener(this.boundMessageHandler);
  }

  messageHandler(message: Message | null, sendResponse?: (response: unknown) => void): void {
    this.contentMessageHandler.handleMessage(message, sendResponse);
  }

  getConfig(): void {
    const msg: ContentScriptGetConfigMessage = {
      command: CMD_CONTENT_SCRIPT_GET_CONFIG,
      context: {},
    };
    chrome.runtime.sendMessage(msg, (response: unknown) => {
      checkLastError();
      // A late answer must not enable a destroyed instance again.
      if (!this.destroyed) this.messageHandler(response as Message);
    });
  }
}

if (!window.FluentTyper) {
  window.FluentTyper = new FluentTyper();
}
