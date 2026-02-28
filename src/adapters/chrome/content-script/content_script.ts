import { checkLastError } from "@core/application/utils";
import { CMD_CONTENT_SCRIPT_GET_CONFIG } from "@core/domain/constants";
import type {
  ContentScriptGetConfigMessage,
  ContentScriptPredictRequestContext,
  Message,
  SetConfigContext,
} from "@core/domain/messageTypes";
import { ContentMessageHandler } from "./ContentMessageHandler";
import { ContentRuntimeController } from "./ContentRuntimeController";
import { HostChangeWatcher } from "./HostChangeWatcher";
import { ThemeApplicator } from "./ThemeApplicator";
import type { DomObserver } from "./DomObserver";
import type { TributeManager } from "./TributeManager";

declare global {
  interface Window {
    FluentTyper?: FluentTyper;
  }
}

class FluentTyper {
  private static readonly LOG_PREFIX = "ContentScript";

  private readonly runtimeController: ContentRuntimeController;
  private readonly contentMessageHandler: ContentMessageHandler;
  private readonly hostChangeWatcher: HostChangeWatcher;

  constructor() {
    console.info(
      "[%s:%s] Initializing on %s",
      FluentTyper.LOG_PREFIX,
      this.constructor.name,
      window.location.hostname,
    );

    this.runtimeController = new ContentRuntimeController(new ThemeApplicator());
    this.runtimeController.setRestartRequestHandler(() => this.restart());

    this.contentMessageHandler = new ContentMessageHandler({
      getEnabled: () => this.enabled,
      setEnabled: (value) => {
        this.enabled = value;
      },
      toggleEnabled: () => {
        this.enabled = !this.enabled;
      },
      setConfig: (config) => this.setConfig(config),
      updateLanguage: (lang) => this.runtimeController.updateLanguage(lang),
      triggerActiveTribute: () => this.runtimeController.triggerActiveTribute(),
      fulfillPrediction: (context) =>
        this.runtimeController.fulfillPrediction(context),
      getLanguage: () => this.config.lang,
    });

    this.runtimeController.setPredictionRequestHandler((context) =>
      this.handleGetPrediction(context),
    );

    this.hostChangeWatcher = new HostChangeWatcher({
      watchDogRunner: () => this.watchDog(),
      getObservedNode: () => this.runtimeController.getObservedNode(),
      setObservedNode: (node) => this.runtimeController.setObservedNode(node),
      isRuntimeEnabled: () => this.enabled,
      restartRuntime: () => this.restart(),
      requestConfig: () => this.getConfig(),
    });

    chrome.runtime.onMessage.addListener(this.messageHandler.bind(this));
    this.hostChangeWatcher.start();
    this.getConfig();
  }

  get tributeManager(): TributeManager | null {
    return this.runtimeController.tributeManager;
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

  messageHandler(
    message: Message | null,
    sender?: chrome.runtime.MessageSender,
    sendResponse?: (response: unknown) => void,
  ): void {
    this.contentMessageHandler.handleMessage(message, sender, sendResponse);
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
