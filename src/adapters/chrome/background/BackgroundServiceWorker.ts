import { CMD_BACKGROUND_PAGE_PREDICT_RESP } from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
import { getErrorMessage, logError } from "@core/domain/error";
import { SettingsManager } from "@core/application/settingsManager";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { LanguageDetector } from "./LanguageDetector";
import type {
  AutoLanguageLiveRuntimeStatus,
  AutoLanguageSessionLookup,
  AutoLanguageSessionStatus,
} from "./LanguageDetector";
import { PredictionManager } from "./PredictionManager";
import { TabMessenger } from "./TabMessenger";
import { ProductivityStatsManager } from "./ProductivityStatsManager";
import { migrateSettingsV3 } from "@core/application/settings/SettingsMigrationV3";
import { migrateSettingsV4 } from "@core/application/settings/SettingsMigrationV4";
import { migrateSettingsV5 } from "@core/application/settings/SettingsMigrationV5";
import { migrateSettingsV6 } from "@core/application/settings/SettingsMigrationV6";
import { migrateSettingsV7 } from "@core/application/settings/SettingsMigrationV7";
import { migrateToLocalStore } from "./Migration";
import type {
  ContentScriptPredictRequestContext,
  ConfigMessage,
  PredictRequestMessage,
  PredictResponseMessage,
} from "@core/domain/messageTypes";
import {
  resolveDomainRuntimeSettings,
  rotateLanguageForDomain,
  sanitizeAutoLanguagePriorsSetting,
  sanitizeSiteProfilesSetting,
} from "./config/runtimeSettings";
import { ConfigAssembler } from "./config/ConfigAssembler";
import { ObservabilityService } from "./ObservabilityService";

declare const __FT_DEV_BUILD__: boolean | undefined;

export const IS_DEV_BUILD = typeof __FT_DEV_BUILD__ !== "undefined" && Boolean(__FT_DEV_BUILD__);
export const ENABLE_AI_PREDICTOR = IS_DEV_BUILD;
const logger = createLogger("BackgroundServiceWorker");

export class BackgroundServiceWorker {
  static instance: BackgroundServiceWorker;
  settingsManager!: SettingsManager;
  coreSettingsRepository!: CoreSettingsRepository;
  languageDetector!: LanguageDetector;
  predictionManager!: PredictionManager;
  tabMessenger!: TabMessenger;
  productivityStatsManager!: ProductivityStatsManager;
  observabilityService!: ObservabilityService;
  configAssembler!: ConfigAssembler;
  language!: string;
  private runtimeConfigReady = false;
  private runtimeConfigLoadPromise: Promise<void> | null = null;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    if (BackgroundServiceWorker.instance) {
      return BackgroundServiceWorker.instance;
    }
    this.settingsManager = new SettingsManager();
    this.coreSettingsRepository = new CoreSettingsRepository(this.settingsManager);
    this.languageDetector = new LanguageDetector(this.settingsManager);
    this.predictionManager = new PredictionManager();
    this.tabMessenger = new TabMessenger();
    this.productivityStatsManager = new ProductivityStatsManager(this.settingsManager);
    this.observabilityService = new ObservabilityService({
      isDevBuild: IS_DEV_BUILD,
      getPredictorSnapshot: () => this.predictionManager.getPredictorDebugSnapshot(),
      getAutoLanguageRuntimes: () => this.languageDetector.getDebugState().liveRuntimes,
    });
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
    const traceId = this.predictionManager.ensureTraceId(message.context.traceId);
    const traceMeta = {
      traceId,
      requestId: message.context.requestId,
      tabId: message.context.tabId,
      frameId: message.context.frameId,
      suggestionId: message.context.suggestionId,
    };
    if (
      typeof message.context.traceStartedAtMs === "number" &&
      Number.isFinite(message.context.traceStartedAtMs)
    ) {
      this.predictionManager.recordTraceTimelineEvent(
        traceMeta,
        "content.request.created",
        undefined,
        message.context.traceStartedAtMs,
      );
    }
    this.predictionManager.recordTraceTimelineEvent(
      traceMeta,
      "background.request.received",
      `lang=${message.context.lang}`,
    );
    await this.ensureRuntimeConfigReady();

    const { predictions } = await this.predictionManager.runPrediction(
      message.context.text,
      message.context.nextChar,
      message.context.lang,
      configOverride,
      traceMeta,
      message.context.afterCursorTokenSuffix,
    );
    this.predictionManager.recordTraceTimelineEvent(
      traceMeta,
      "background.prediction.completed",
      `${predictions.length} predictions`,
    );
    if (!Array.isArray(predictions) || predictions.length === 0) {
      this.predictionManager.recordTraceTimelineEvent(
        traceMeta,
        "background.response.empty",
        "no predictions",
      );
    }
    const predictResponseMessage: PredictResponseMessage = {
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: {
        text: message.context.text,
        nextChar: message.context.nextChar,
        lang: message.context.lang,
        tabId: message.context.tabId,
        suggestionId: message.context.suggestionId,
        requestId: message.context.requestId,
        runtimeGeneration: message.context.runtimeGeneration,
        traceId,
        traceStartedAtMs: message.context.traceStartedAtMs,
        frameId: message.context.frameId,
        predictions,
      },
    };
    this.predictionManager.recordTraceTimelineEvent(
      traceMeta,
      "background.response.dispatching",
      `frame=${message.context.frameId}`,
    );

    // Send directly without a chrome.tabs.get pre-flight — that extra IPC
    // round-trip added ~5–10 ms of latency on every prediction response.
    // chrome.tabs.sendMessage throws if the tab/frame is gone, which we
    // catch and trace just like before.
    try {
      await chrome.tabs.sendMessage(message.context.tabId, predictResponseMessage, {
        frameId: message.context.frameId,
      });
      this.predictionManager.recordTraceTimelineEvent(
        traceMeta,
        "background.response.sent",
        `${predictions.length} predictions`,
      );
    } catch (error) {
      this.predictionManager.recordTraceTimelineEvent(
        traceMeta,
        "background.response.error",
        getErrorMessage(error),
      );
      logError("BackgroundServiceWorker.runPrediction.sendMessage", error);
    }
  }

  async resolveAutoLanguage(
    context: Pick<
      ContentScriptPredictRequestContext,
      "text" | "nextChar" | "suggestionId" | "runtimeGeneration" | "inputAction" | "documentLang"
    > & {
      tabId: number;
      frameId: number;
      domainURL?: string;
      enabledLanguages?: string[];
    },
  ) {
    return this.languageDetector.resolveLanguage(context);
  }

  reportAutoLanguageRuntime(
    context: Pick<AutoLanguageSessionLookup, "runtimeGeneration" | "domainURL"> & {
      tabId: number;
      frameId: number;
    },
  ): void {
    this.languageDetector.reportRuntimeActivity(context);
  }

  sendCommandToActiveTabContentScript(message: import("@core/domain/messageTypes").Message): void {
    this.tabMessenger.sendToActiveTab(message);
  }

  sendCommandToTabContentScript(
    tabId: number,
    frameId: number,
    message: import("@core/domain/messageTypes").Message,
  ): void {
    this.tabMessenger.sendToTab(tabId, frameId, message);
  }

  async getBackgroundPageSetConfigMsg(domainURL?: string): Promise<ConfigMessage> {
    const message = await this.configAssembler.assembleBackgroundPageSetConfig(domainURL);
    this.language = message.context.lang;
    return message;
  }

  async updatePresageConfig(): Promise<void> {
    await sanitizeSiteProfilesSetting(this.settingsManager);
    await sanitizeAutoLanguagePriorsSetting(this.settingsManager);
    await this.predictionManager.initialize();
    const runtimeConfig = await this.configAssembler.assemblePredictionRuntimeConfig();
    this.language = runtimeConfig.language;
    this.observabilityService.setConfig(runtimeConfig.observabilityConfig);
    this.predictionManager.setConfig(runtimeConfig.predictionConfig);
    this.productivityStatsManager.setSnippetShortcuts(runtimeConfig.textExpansions);
    this.runtimeConfigReady = true;
    logger.info("Broadcasting runtime config update", {
      aiPredictorEnabled: runtimeConfig.predictionConfig.aiPredictorEnabled,
      observabilityEnabled: runtimeConfig.observabilityConfig?.enabled,
    });
    await this.tabMessenger.sendToAllTabs(
      await this.getBackgroundPageSetConfigMsg(),
      this.settingsManager,
      (domain: string) => this.configAssembler.resolveDomainConfigOverrides(domain),
    );
  }

  async getAutoLanguageStatusForScope(
    scope: AutoLanguageSessionLookup,
  ): Promise<AutoLanguageSessionStatus | null> {
    return this.languageDetector.getRecentSessionStatusForScope(scope);
  }

  async getLiveAutoLanguageRuntime(
    scope: AutoLanguageSessionLookup,
  ): Promise<AutoLanguageLiveRuntimeStatus | null> {
    return this.languageDetector.getLiveRuntimeStatus(scope);
  }

  async handleActiveLanguageToggle(scope: AutoLanguageSessionLookup): Promise<{
    language: string;
    tabId?: number;
    frameId?: number;
  }> {
    const tabId = scope.tabId;
    if (typeof tabId === "number") {
      const liveRuntime = await this.getLiveAutoLanguageRuntime(scope);
      const effectiveDomainURL = liveRuntime?.domain || scope.domainURL;
      const effectiveScope: AutoLanguageSessionLookup = {
        tabId,
        frameId: liveRuntime?.frameId,
        runtimeGeneration: liveRuntime?.runtimeGeneration,
        domainURL: effectiveDomainURL || undefined,
      };
      const domainSettings = await resolveDomainRuntimeSettings(
        this.settingsManager,
        effectiveDomainURL || undefined,
      );
      if (domainSettings.language === "auto_detect") {
        const status = await this.languageDetector.cycleManualLockForScope(effectiveScope);
        if (status) {
          return {
            language: status.language,
            tabId: status.tabId,
            frameId: status.frameId,
          };
        }
      }
      const nextLang = await rotateLanguageForDomain(
        this.settingsManager,
        effectiveDomainURL || undefined,
      );
      return {
        language: nextLang,
        tabId,
        frameId: liveRuntime?.frameId ?? 0,
      };
    }
    return {
      language: this.language,
      frameId: 0,
    };
  }

  async initialize(lastVersion: string | undefined): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }
    this.initializationPromise = (async () => {
      try {
        await migrateToLocalStore(lastVersion);
        await migrateSettingsV3(this.settingsManager);
        await migrateSettingsV4(this.settingsManager);
        await migrateSettingsV5(this.settingsManager);
        await migrateSettingsV6(this.settingsManager);
        await migrateSettingsV7(this.settingsManager);
        await this.predictionManager.initialize();
        await this.updatePresageConfig();
      } catch (error) {
        logError("lastVersion handler", error);
      }
    })();
    await this.initializationPromise;
  }

  private async ensureRuntimeConfigReady(): Promise<void> {
    if (this.runtimeConfigReady) {
      return;
    }
    if (!this.runtimeConfigLoadPromise) {
      this.runtimeConfigLoadPromise = this.updatePresageConfig().finally(() => {
        this.runtimeConfigLoadPromise = null;
      });
    }
    await this.runtimeConfigLoadPromise;
  }
}
