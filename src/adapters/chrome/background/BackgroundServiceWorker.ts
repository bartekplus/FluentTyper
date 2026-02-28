import {
  CMD_BACKGROUND_PAGE_PREDICT_RESP,
} from "@core/domain/constants";
import { checkLastError } from "@core/application/utils";
import { logError } from "@core/domain/error";
import { SettingsManager } from "@core/application/settingsManager";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { LanguageDetector } from "./LanguageDetector";
import { PredictionManager } from "./PredictionManager";
import { TabMessenger } from "./TabMessenger";
import { ProductivityStatsManager } from "./ProductivityStatsManager";
import { migrateSettingsV3 } from "@core/application/settings/SettingsMigrationV3";
import { migrateToLocalStore } from "./Migration";
import type {
  ConfigMessage,
  PredictRequestMessage,
  PredictResponseMessage,
} from "@core/domain/messageTypes";
import { sanitizeSiteProfilesSetting } from "./config/runtimeSettings";
import { ConfigAssembler } from "./config/ConfigAssembler";

declare const __FT_DEV_BUILD__: boolean | undefined;
declare const __FT_E2E_BUILD__: boolean | undefined;

export const IS_DEV_BUILD =
  typeof __FT_DEV_BUILD__ !== "undefined" && Boolean(__FT_DEV_BUILD__);
export const IS_E2E_BUILD =
  typeof __FT_E2E_BUILD__ !== "undefined" && Boolean(__FT_E2E_BUILD__);
export const ENABLE_TEST_RUNTIME_HOOKS = IS_DEV_BUILD || IS_E2E_BUILD;
export const ENABLE_AI_PREDICTOR = IS_DEV_BUILD || IS_E2E_BUILD;

export class BackgroundServiceWorker {
  static instance: BackgroundServiceWorker;
  settingsManager!: SettingsManager;
  coreSettingsRepository!: CoreSettingsRepository;
  languageDetector!: LanguageDetector;
  predictionManager!: PredictionManager;
  tabMessenger!: TabMessenger;
  productivityStatsManager!: ProductivityStatsManager;
  configAssembler!: ConfigAssembler;
  language!: string;

  constructor() {
    if (BackgroundServiceWorker.instance) {
      return BackgroundServiceWorker.instance;
    }
    this.settingsManager = new SettingsManager();
    this.coreSettingsRepository = new CoreSettingsRepository(this.settingsManager);
    this.languageDetector = new LanguageDetector(this.settingsManager);
    this.predictionManager = new PredictionManager();
    this.tabMessenger = new TabMessenger();
    this.productivityStatsManager = new ProductivityStatsManager(
      this.settingsManager,
    );
    this.configAssembler = new ConfigAssembler(this.settingsManager, {
      enableAIPredictor: ENABLE_AI_PREDICTOR,
      isDevBuild: IS_DEV_BUILD,
    });
    this.language = "auto_detect";
    BackgroundServiceWorker.instance = this;
  }

  async runPrediction(
    message: PredictRequestMessage,
    configOverride?: { numSuggestions?: number },
  ): Promise<void> {
    const { predictions, forceReplace } =
      await this.predictionManager.runPrediction(
        message.context.text!,
        message.context.nextChar!,
        message.context.lang!,
        configOverride,
        {
          requestId: message.context.requestId,
          tabId: message.context.tabId,
          frameId: message.context.frameId,
          tributeId: message.context.tributeId,
        },
      );
    if (
      (!Array.isArray(predictions) || predictions.length === 0) &&
      !forceReplace
    ) {
      return;
    }
    const predictResponseMessage: PredictResponseMessage = {
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: {
        text: message.context.text,
        nextChar: message.context.nextChar,
        lang: message.context.lang,
        tabId: message.context.tabId,
        tributeId: message.context.tributeId,
        requestId: message.context.requestId,
        frameId: message.context.frameId,
        predictions,
        forceReplace,
      },
    };
    chrome.tabs.get(message.context.tabId!, async function (tab) {
      checkLastError();
      if (tab) {
        await chrome.tabs.sendMessage(
          message.context.tabId!,
          predictResponseMessage,
          {
            frameId: message.context.frameId,
          },
        );
      }
    });
  }

  async detectLanguage(
    text: string,
    tabId: number,
    enabledLanguages?: string[],
  ): Promise<string> {
    return this.languageDetector.detectLanguage(text, tabId, enabledLanguages);
  }

  sendCommandToActiveTabContentScript(
    message: import("@core/domain/messageTypes").Message,
  ): void {
    this.tabMessenger.sendToActiveTab(message);
  }

  async getBackgroundPageSetConfigMsg(domainURL?: string): Promise<ConfigMessage> {
    const message =
      await this.configAssembler.assembleBackgroundPageSetConfig(domainURL);
    this.language = message.context.lang;
    return message;
  }

  async updatePresageConfig(): Promise<void> {
    await sanitizeSiteProfilesSetting(this.settingsManager);
    await this.predictionManager.initialize();
    const runtimeConfig =
      await this.configAssembler.assemblePredictionRuntimeConfig();
    this.language = runtimeConfig.language;
    this.predictionManager.setConfig(runtimeConfig.predictionConfig);
    this.productivityStatsManager.setSnippetShortcuts(
      runtimeConfig.textExpansions,
    );
    this.tabMessenger.sendToAllTabs(
      await this.getBackgroundPageSetConfigMsg(),
      this.settingsManager,
      (domain: string) => this.configAssembler.resolveDomainConfigOverrides(domain),
    );
  }

  async initialize(lastVersion: string | undefined): Promise<void> {
    try {
      await migrateToLocalStore(lastVersion);
      await migrateSettingsV3(this.settingsManager);
      await this.predictionManager.initialize();
      await this.updatePresageConfig();
    } catch (error) {
      logError("lastVersion handler", error);
    }
  }

  async resolveEnabledLanguages(): Promise<string[]> {
    return this.coreSettingsRepository.getEnabledLanguages();
  }
}
