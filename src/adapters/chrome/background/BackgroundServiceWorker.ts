import { CMD_BACKGROUND_PAGE_PREDICT_RESP, isDevBuild } from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
import { getErrorMessage, logError } from "@core/domain/error";
import { isFiniteNumber } from "@core/domain/guards";
import { serialQueue } from "@core/domain/serialQueue";
import { SettingsManager } from "@core/application/settingsManager";
import { isEnabledForDomain } from "@core/application/domain-utils";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { LanguageDetector, type AutoLanguageSessionLookup } from "./LanguageDetector";
import { PredictionManager } from "./PredictionManager";
import type { PredictionConfigOverride } from "./PredictionTypes";
import { TabMessenger } from "./TabMessenger";
import { ProductivityStatsService } from "@core/application/productivityStats/ProductivityStatsService";
import { migrateToLocalStore } from "./Migration";
import { runSettingsMigrations } from "@core/application/settings/migrations";
import type {
  ConfigMessage,
  PredictRequestContext,
  PredictResponseMessage,
} from "@core/domain/messageTypes";
import {
  resolveDomainRuntimeSettings,
  rotateLanguageForDomain,
  sanitizeLanguageSettings,
} from "./config/runtimeSettings";
import { ConfigAssembler } from "./config/ConfigAssembler";
import { DomainSettingsCache } from "./config/DomainSettingsCache";
import { ObservabilityService } from "./ObservabilityService";
import { ChromeStorageBackend } from "@core/application/storage/ChromeStorageBackend";
import { PersonalizationRepository } from "@core/application/personalization/PersonalizationRepository";
import { PersonalizationService } from "@core/application/personalization/PersonalizationService";
import { LocalAiSettingsRepository } from "@core/application/repositories/LocalAiSettingsRepository";
import { LocalAiController } from "./localAi/LocalAiController";
import type { EngineLike } from "./localAi/LocalAiHost";

const logger = createLogger("BackgroundServiceWorker");

export class BackgroundServiceWorker {
  settingsManager!: SettingsManager;
  coreSettingsRepository!: CoreSettingsRepository;
  languageDetector!: LanguageDetector;
  predictionManager!: PredictionManager;
  tabMessenger!: TabMessenger;
  productivityStats!: ProductivityStatsService;
  observabilityService!: ObservabilityService;
  configAssembler!: ConfigAssembler;
  personalizationService!: PersonalizationService;
  localAiController!: LocalAiController;
  domainSettingsCache!: DomainSettingsCache;
  private runtimeConfigReady = false;
  private runtimeConfigLoadPromise: Promise<void> | null = null;
  private initializationPromise: Promise<void> | null = null;
  private readonly configUpdates = serialQueue();

  constructor(localAiEngine: EngineLike | null = null) {
    this.settingsManager = new SettingsManager();
    this.coreSettingsRepository = new CoreSettingsRepository(this.settingsManager);
    this.personalizationService = new PersonalizationService({
      repository: new PersonalizationRepository(new ChromeStorageBackend()),
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
    this.productivityStats = new ProductivityStatsService(this.settingsManager);
    this.observabilityService = new ObservabilityService({
      isDevBuild: isDevBuild(),
      getPredictorSnapshot: () => this.predictionManager.getPredictorDebugSnapshot(),
      getAutoLanguageRuntimes: () => this.languageDetector.getLiveRuntimes(),
    });
    this.configAssembler = new ConfigAssembler(this.settingsManager, { isDevBuild: isDevBuild() });
    this.localAiController = new LocalAiController(
      new LocalAiSettingsRepository(this.settingsManager),
      localAiEngine,
    );
    this.domainSettingsCache = new DomainSettingsCache();
  }

  async runPrediction(
    request: PredictRequestContext,
    configOverride?: PredictionConfigOverride,
  ): Promise<void> {
    const traceId = this.predictionManager.ensureTraceId(request.traceId);
    const traceMeta = {
      traceId,
      requestId: request.requestId,
      tabId: request.tabId,
      frameId: request.frameId,
      suggestionId: request.suggestionId,
    };
    if (isFiniteNumber(request.traceStartedAtMs)) {
      this.predictionManager.recordTraceTimelineEvent(
        traceMeta,
        "content.request.created",
        undefined,
        request.traceStartedAtMs,
      );
    }
    this.predictionManager.recordTraceTimelineEvent(
      traceMeta,
      "background.request.received",
      `lang=${request.lang}`,
    );
    await this.ensureRuntimeConfigReady();

    const { predictions, snippetShortcuts } = await this.predictionManager.runPrediction(
      request.text,
      request.nextChar,
      request.lang,
      configOverride,
      traceMeta,
      request.afterCursorTokenSuffix,
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
    const { afterCursorTokenSuffix: _suffix, inputAction: _action, ...echo } = request;
    const predictResponseMessage: PredictResponseMessage = {
      command: CMD_BACKGROUND_PAGE_PREDICT_RESP,
      context: { ...echo, traceId, predictions, snippetShortcuts },
    };
    this.predictionManager.recordTraceTimelineEvent(
      traceMeta,
      "background.response.dispatching",
      `frame=${request.frameId}`,
    );

    try {
      await chrome.tabs.sendMessage(request.tabId, predictResponseMessage, {
        frameId: request.frameId,
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

  async getBackgroundPageSetConfigMsg(domainURL?: string): Promise<ConfigMessage> {
    await this.initializationPromise;
    return this.configUpdates(async () => {
      if (!this.runtimeConfigReady) await this.applyPresageConfig();
      const message = await this.configAssembler.assembleBackgroundPageSetConfig(domainURL);
      message.context.enabled = await isEnabledForDomain(this.settingsManager, domainURL ?? "");
      return message;
    });
  }

  updatePresageConfig(): Promise<void> {
    return this.configUpdates(async () => {
      await this.initializationPromise;
      await this.applyPresageConfig();
    });
  }

  private async applyPresageConfig(): Promise<void> {
    this.runtimeConfigReady = false;
    await sanitizeLanguageSettings(this.settingsManager);
    await Promise.all([
      this.personalizationService.initialize(),
      this.predictionManager.initialize(),
    ]);
    const runtimeConfig = await this.configAssembler.assemblePredictionRuntimeConfig();
    this.observabilityService.setConfig(runtimeConfig.observabilityConfig);
    this.predictionManager.setConfig(runtimeConfig.predictionConfig);
    this.productivityStats.setSnippetShortcuts(runtimeConfig.predictionConfig.textExpansions);
    this.runtimeConfigReady = true;
    // Flush the cache before the broadcast, so that a prediction from a tab reads the new settings.
    this.domainSettingsCache.invalidate();
    logger.info("Broadcasting runtime config update", {
      observabilityEnabled: runtimeConfig.observabilityConfig?.enabled,
    });
    await this.tabMessenger.sendToAllTabs(
      await this.configAssembler.assembleBackgroundPageSetConfig(),
      this.settingsManager,
      (domain: string) => this.configAssembler.resolveDomainConfigOverrides(domain),
    );
  }

  async handleActiveLanguageToggle(scope: AutoLanguageSessionLookup): Promise<{
    language: string;
    tabId: number;
    frameId: number;
  }> {
    const liveRuntime = await this.languageDetector.getLiveRuntimeStatus(scope);
    const effectiveDomainURL = liveRuntime?.domain || scope.domainURL || undefined;
    const effectiveScope: AutoLanguageSessionLookup = {
      tabId: scope.tabId,
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
    const nextLang = await rotateLanguageForDomain(
      this.settingsManager,
      effectiveDomainURL,
      domainSettings,
    );
    // The next prediction request must read the new language, not a cached one.
    this.domainSettingsCache.invalidate();
    return {
      language: nextLang,
      tabId: scope.tabId,
      frameId: liveRuntime?.frameId ?? 0,
    };
  }

  async initialize(lastVersion: string | undefined | Promise<string | undefined>): Promise<void> {
    this.initializationPromise ??= this.configUpdates(async () => {
      try {
        await migrateToLocalStore(await lastVersion);
        await runSettingsMigrations(this.settingsManager);
        await this.applyPresageConfig();
      } catch (error) {
        logError("lastVersion handler", error);
        throw error;
      }
    });
    await this.initializationPromise;
  }

  async ensureRuntimeConfigReady(): Promise<void> {
    await this.initializationPromise;
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
