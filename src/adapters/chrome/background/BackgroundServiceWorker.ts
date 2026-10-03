import { CMD_BACKGROUND_PAGE_PREDICT_RESP, isDevBuild } from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
import { getErrorMessage, logError } from "@core/domain/error";
import { SettingsManager } from "@core/application/settingsManager";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { LanguageDetector, type AutoLanguageSessionLookup } from "./LanguageDetector";
import { PredictionManager } from "./PredictionManager";
import type { PredictionConfigOverride } from "./PredictionTypes";
import { TabMessenger } from "./TabMessenger";
import { ProductivityStatsManager } from "./ProductivityStatsManager";
import { migrateSettingsV3 } from "@core/application/settings/SettingsMigrationV3";
import { migrateSettingsV4 } from "@core/application/settings/SettingsMigrationV4";
import { migrateSettingsV5 } from "@core/application/settings/SettingsMigrationV5";
import { migrateSettingsV6 } from "@core/application/settings/SettingsMigrationV6";
import { migrateSettingsV7 } from "@core/application/settings/SettingsMigrationV7";
import { migrateSettingsV8 } from "@core/application/settings/SettingsMigrationV8";
import { migrateSettingsV9 } from "@core/application/settings/SettingsMigrationV9";
import { migrateSettingsV10 } from "@core/application/settings/SettingsMigrationV10";
import { migrateToLocalStore } from "./Migration";
import type {
  ConfigMessage,
  Message,
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
import { ChromeStorageBackend } from "@core/application/storage/ChromeStorageBackend";
import { PersonalizationRepository } from "@core/application/personalization/PersonalizationRepository";
import { PersonalizationService } from "@core/application/personalization/PersonalizationService";
import { LocalAiSettingsRepository } from "@core/application/repositories/LocalAiSettingsRepository";
import { LocalAiController } from "./localAi/LocalAiController";
import type { EngineLike } from "./localAi/LocalAiHost";

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
  personalizationService!: PersonalizationService;
  localAiController!: LocalAiController;
  language!: string;
  private runtimeConfigReady = false;
  private runtimeConfigLoadPromise: Promise<void> | null = null;
  private initializationPromise: Promise<void> | null = null;

  constructor(localAiEngine: EngineLike | null = null) {
    if (BackgroundServiceWorker.instance) {
      return BackgroundServiceWorker.instance;
    }
    this.settingsManager = new SettingsManager();
    this.coreSettingsRepository = new CoreSettingsRepository(this.settingsManager);
    this.personalizationService = new PersonalizationService({
      repository: new PersonalizationRepository(new ChromeStorageBackend(true)),
      isEnabled: () => this.coreSettingsRepository.getPersonalizationEnabled(),
      isTextExpansionTrigger: async (triggerText) => {
        const normalizedTrigger = triggerText.trim().toLocaleLowerCase();
        const expansions = await this.coreSettingsRepository.getTextExpansions();
        return expansions.some(
          ([shortcut]) => shortcut.trim().toLocaleLowerCase() === normalizedTrigger,
        );
      },
    });
    this.languageDetector = new LanguageDetector(this.settingsManager);
    this.predictionManager = new PredictionManager({
      getPersonalizationSnapshot: () => this.personalizationService.getRankingSnapshot(),
      isDevBuild: isDevBuild(),
    });
    this.tabMessenger = new TabMessenger();
    this.productivityStatsManager = new ProductivityStatsManager(this.settingsManager);
    this.observabilityService = new ObservabilityService({
      isDevBuild: isDevBuild(),
      getPredictorSnapshot: () => this.predictionManager.getPredictorDebugSnapshot(),
      getAutoLanguageRuntimes: () => this.languageDetector.getDebugState().liveRuntimes,
    });
    this.configAssembler = new ConfigAssembler(this.settingsManager, { isDevBuild: isDevBuild() });
    this.localAiController = new LocalAiController(
      new LocalAiSettingsRepository(this.settingsManager),
      localAiEngine,
    );
    this.language = "auto_detect";
    BackgroundServiceWorker.instance = this;
  }

  async runPrediction(
    message: PredictRequestMessage,
    configOverride?: PredictionConfigOverride,
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

    const { predictions, snippetShortcuts } = await this.predictionManager.runPrediction(
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
    if (predictions.length === 0) {
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
        snippetShortcuts,
      },
    };
    this.predictionManager.recordTraceTimelineEvent(
      traceMeta,
      "background.response.dispatching",
      `frame=${message.context.frameId}`,
    );

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

  reportAutoLanguageRuntime(
    context: Pick<AutoLanguageSessionLookup, "runtimeGeneration" | "domainURL"> & {
      tabId: number;
      frameId: number;
    },
  ): void {
    this.languageDetector.reportRuntimeActivity(context);
  }

  sendCommandToTabContentScript(tabId: number, frameId: number, message: Message): void {
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
    await Promise.all([
      this.personalizationService.initialize(),
      this.predictionManager.initialize(),
    ]);
    const runtimeConfig = await this.configAssembler.assemblePredictionRuntimeConfig();
    this.language = runtimeConfig.language;
    this.observabilityService.setConfig(runtimeConfig.observabilityConfig);
    this.predictionManager.setConfig(runtimeConfig.predictionConfig);
    this.productivityStatsManager.setSnippetShortcuts(runtimeConfig.textExpansions);
    this.runtimeConfigReady = true;
    logger.info("Broadcasting runtime config update", {
      observabilityEnabled: runtimeConfig.observabilityConfig?.enabled,
    });
    await this.tabMessenger.sendToAllTabs(
      await this.getBackgroundPageSetConfigMsg(),
      this.settingsManager,
      (domain: string) => this.configAssembler.resolveDomainConfigOverrides(domain),
    );
  }

  async handleActiveLanguageToggle(scope: AutoLanguageSessionLookup): Promise<{
    language: string;
    tabId?: number;
    frameId?: number;
  }> {
    const tabId = scope.tabId;
    if (typeof tabId === "number") {
      const liveRuntime = await this.languageDetector.getLiveRuntimeStatus(scope);
      const effectiveDomainURL = liveRuntime?.domain || scope.domainURL || undefined;
      const effectiveScope: AutoLanguageSessionLookup = {
        tabId,
        frameId: liveRuntime?.frameId,
        runtimeGeneration: liveRuntime?.runtimeGeneration,
        domainURL: effectiveDomainURL,
      };
      const domainSettings = await resolveDomainRuntimeSettings(
        this.settingsManager,
        effectiveDomainURL,
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
      const nextLang = await rotateLanguageForDomain(this.settingsManager, effectiveDomainURL);
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
    this.initializationPromise ??= (async () => {
      try {
        await migrateToLocalStore(lastVersion);
        await migrateSettingsV3(this.settingsManager);
        await migrateSettingsV4(this.settingsManager);
        await migrateSettingsV5(this.settingsManager);
        await migrateSettingsV6(this.settingsManager);
        await migrateSettingsV7(this.settingsManager);
        await migrateSettingsV8(this.settingsManager);
        await migrateSettingsV9(this.settingsManager);
        await migrateSettingsV10(this.settingsManager);
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
