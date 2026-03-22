import { checkLastError } from "@core/application/transport-utils";
import {
  createLogger,
  getRegisteredObservabilityModules,
  setGlobalObservabilityRuntime,
} from "@core/application/logging/Logger";
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
import type { ContentMessageHandlerDependencies } from "./ContentMessageHandler";
import { ContentRuntimeController } from "./ContentRuntimeController";
import { HostChangeWatcher, type HostChangeWatcherDependencies } from "./HostChangeWatcher";
import { isEarlyTabAcceptMessage } from "./suggestions/EarlyTabAcceptBridgeProtocol";
import { ThemeApplicator } from "./ThemeApplicator";
import type { DomObserver } from "./DomObserver";
import type { SuggestionManager } from "./SuggestionManager";

declare global {
  interface Window {
    FluentTyper?: FluentTyper;
  }
}

const logger = createLogger("FluentTyperContentScript");
declare const __FT_DEV_BUILD__: boolean | undefined;

if (typeof __FT_DEV_BUILD__ !== "undefined" && __FT_DEV_BUILD__) {
  setGlobalObservabilityRuntime({
    source: "content_script",
    sink: (event) => {
      try {
        void chrome.runtime.sendMessage({
          command: CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT,
          context: {
            event,
          },
        });
      } catch {
        // Ignore runtime disconnects during page teardown.
      }
    },
  });
  try {
    void chrome.runtime.sendMessage({
      command: CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_MODULES,
      context: {
        modules: getRegisteredObservabilityModules(),
      },
    });
  } catch {
    // Ignore runtime disconnects during page teardown.
  }
}

class FluentTyper {
  private readonly runtimeController: ContentRuntimeController;
  private readonly contentMessageHandler: ContentMessageHandler;
  private readonly hostChangeWatcher: HostChangeWatcher;
  private readonly boundMessageHandler = (
    message: Message | null,
    sender?: chrome.runtime.MessageSender,
    sendResponse?: (response: unknown) => void,
  ) => this.messageHandler(message, sender, sendResponse);
  private readonly boundEarlyTabAcceptHandler = (event: MessageEvent) =>
    this.handleEarlyTabAccept(event);

  constructor() {
    logger.info("Initializing content script", {
      host: window.location.hostname,
    });

    this.runtimeController = new ContentRuntimeController(new ThemeApplicator());
    this.runtimeController.setRestartRequestHandler(() => this.restart());

    this.contentMessageHandler = new ContentMessageHandler(
      this.createContentMessageHandlerDependencies(),
    );
    this.runtimeController.setRuntimeActivityHandler((runtimeGeneration) => {
      this.contentMessageHandler.reportRuntimeStatus(runtimeGeneration);
    });

    this.runtimeController.setPredictionRequestHandler(this.handleGetPrediction.bind(this));

    this.hostChangeWatcher = new HostChangeWatcher(this.createHostChangeWatcherDependencies());

    chrome.runtime.onMessage.addListener(this.boundMessageHandler);
    window.addEventListener("message", this.boundEarlyTabAcceptHandler);
    this.hostChangeWatcher.start();
    this.getConfig();
  }

  get suggestionManager(): SuggestionManager | null {
    return this.runtimeController.suggestionManager;
  }

  get config(): SetConfigContext {
    return this.runtimeController.config;
  }

  get domObserver(): DomObserver {
    return this.runtimeController.domObserver;
  }

  get hostName(): string {
    return this.hostChangeWatcher.getHostName();
  }

  set hostName(hostName: string) {
    this.hostChangeWatcher.setHostName(hostName);
  }

  set enabled(newValue: boolean) {
    this.runtimeController.enabled = newValue;
  }

  get enabled(): boolean {
    return this.runtimeController.enabled;
  }

  checkHostName(): boolean {
    return this.hostChangeWatcher.checkHostName();
  }

  watchDog(): void {
    this.hostChangeWatcher.watchDog();
  }

  attachMutationObserver(): void {
    this.runtimeController.attachMutationObserver();
  }

  handleGetPrediction(context: ContentScriptPredictRequestContext): void {
    this.contentMessageHandler.handleGetPrediction(context);
  }

  processMutations(mutationsList: MutationRecord[]): void {
    this.runtimeController.processMutations(mutationsList);
  }

  mutationCallback(mutationsList: MutationRecord[]): void {
    this.runtimeController.mutationCallback(mutationsList);
  }

  setConfig(config: SetConfigContext): void {
    this.runtimeController.setConfig(config);
  }

  enable(): void {
    this.runtimeController.enable();
  }

  disable(): void {
    this.runtimeController.disable();
  }

  restart(): void {
    this.runtimeController.restart();
  }

  destroy(): void {
    logger.info("Destroying content script instance");
    this.hostChangeWatcher.stop();
    this.disable();
    window.removeEventListener("message", this.boundEarlyTabAcceptHandler);
    chrome.runtime.onMessage.removeListener(this.boundMessageHandler);
  }

  handleEarlyTabAccept(event: MessageEvent): void {
    if (!isEarlyTabAcceptMessage(event.data)) {
      return;
    }

    this.runtimeController.handleEarlyTabAcceptRequest(event.data.entryId);
  }

  messageHandler(
    message: Message | null,
    sender?: chrome.runtime.MessageSender,
    sendResponse?: (response: unknown) => void,
  ): void {
    this.contentMessageHandler.handleMessage(message, sender, sendResponse);
  }

  private createContentMessageHandlerDependencies(): ContentMessageHandlerDependencies {
    return {
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
      fulfillPrediction: (context: PredictResponseContext) =>
        this.runtimeController.fulfillPrediction(context),
      getLanguage: () => this.config.lang,
      getPredictionGeneration: () => this.runtimeController.getPredictionGeneration(),
    };
  }

  private createHostChangeWatcherDependencies(): HostChangeWatcherDependencies {
    return {
      watchDogRunner: () => this.watchDog(),
      getObservedNode: () => this.runtimeController.getObservedNode(),
      setObservedNode: (node: Node) => this.runtimeController.setObservedNode(node),
      isRuntimeEnabled: () => this.enabled,
      restartRuntime: () => this.restart(),
      requestConfig: () => this.getConfig(),
    };
  }

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
}

if (!window.FluentTyper) {
  window.FluentTyper = new FluentTyper();
}
