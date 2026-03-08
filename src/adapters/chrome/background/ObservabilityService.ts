import {
  createLogger,
  getRegisteredObservabilityModules,
  resetGlobalObservabilityRuntime,
  setGlobalObservabilityRuntime,
} from "@core/application/logging/Logger";
import {
  DEFAULT_OBSERVABILITY_CONFIG,
  OBSERVABILITY_MODULE_IDS,
  type LogLevel,
  type ObservabilityConfig,
  type ObservabilityContentRuntimeStatus,
  type ObservabilityEvent,
  type ObservabilityModuleState,
  type ObservabilitySnapshot,
} from "@core/domain/observability";
import type { AutoLanguageLiveRuntimeStatus } from "./LanguageDetector";
import type { PredictorDebugSnapshot } from "./PredictionManager";

const logger = createLogger("BackgroundServiceWorker");
const MAX_OBSERVABILITY_EVENTS = 250;

interface ObservabilityServiceOptions {
  isDevBuild: boolean;
  getPredictorSnapshot: () => PredictorDebugSnapshot;
  getAutoLanguageRuntimes: () => AutoLanguageLiveRuntimeStatus[];
}

function cloneConfig(config: ObservabilityConfig): ObservabilityConfig {
  return {
    enabled: config.enabled,
    defaultLevel: config.defaultLevel,
    moduleOverrides: Object.fromEntries(
      Object.entries(config.moduleOverrides).map(([moduleId, override]) => [
        moduleId,
        override ? { ...override } : override,
      ]),
    ) as ObservabilityConfig["moduleOverrides"],
  };
}

function normalizeDomain(domainURL?: string): string | null {
  if (typeof domainURL !== "string" || domainURL.trim().length === 0) {
    return null;
  }
  return domainURL.trim().toLowerCase();
}

export class ObservabilityService {
  private readonly isDevBuild: boolean;
  private readonly getPredictorSnapshot: () => PredictorDebugSnapshot;
  private readonly getAutoLanguageRuntimes: () => AutoLanguageLiveRuntimeStatus[];
  private config: ObservabilityConfig = cloneConfig(DEFAULT_OBSERVABILITY_CONFIG);
  private events: ObservabilityEvent[] = [];
  private readonly moduleSources = new Map<string, Set<ObservabilityEvent["source"]>>();
  private readonly lastEventAt = new Map<string, number>();
  private readonly contentRuntimes = new Map<string, ObservabilityContentRuntimeStatus>();

  constructor(options: ObservabilityServiceOptions) {
    this.isDevBuild = options.isDevBuild;
    this.getPredictorSnapshot = options.getPredictorSnapshot;
    this.getAutoLanguageRuntimes = options.getAutoLanguageRuntimes;
    if (this.isDevBuild) {
      setGlobalObservabilityRuntime({
        config: this.config,
        sink: (event) => this.recordEvent(event),
        source: "background",
      });
    } else {
      resetGlobalObservabilityRuntime();
      setGlobalObservabilityRuntime({
        source: "background",
      });
    }
  }

  setConfig(config?: ObservabilityConfig): void {
    this.config = cloneConfig(config || DEFAULT_OBSERVABILITY_CONFIG);
    if (!this.isDevBuild) {
      return;
    }
    setGlobalObservabilityRuntime({
      config: this.config,
      sink: (event) => this.recordEvent(event),
      source: "background",
    });
    logger.info("Updated observability config", {
      enabled: this.config.enabled,
      defaultLevel: this.config.defaultLevel,
      overrideCount: Object.keys(this.config.moduleOverrides).length,
    });
  }

  recordEvent(event: ObservabilityEvent): void {
    this.events.unshift({
      ...event,
      context: event.context ? { ...event.context } : undefined,
    });
    this.lastEventAt.set(event.moduleId, event.timestampMs);
    const sourceSet =
      this.moduleSources.get(event.moduleId) || new Set<ObservabilityEvent["source"]>();
    sourceSet.add(event.source);
    this.moduleSources.set(event.moduleId, sourceSet);
    if (this.events.length > MAX_OBSERVABILITY_EVENTS) {
      this.events = this.events.slice(0, MAX_OBSERVABILITY_EVENTS);
    }
  }

  recordContentRuntimeStatus(scope: {
    tabId: number;
    frameId: number;
    runtimeGeneration: number;
    domainURL?: string;
  }): void {
    const key = `${scope.tabId}:${scope.frameId}:${scope.runtimeGeneration}`;
    this.contentRuntimes.set(key, {
      tabId: scope.tabId,
      frameId: scope.frameId,
      runtimeGeneration: scope.runtimeGeneration,
      domain: normalizeDomain(scope.domainURL),
      updatedAt: Date.now(),
    });
  }

  clearEvents(): void {
    this.events = [];
    this.lastEventAt.clear();
    this.moduleSources.clear();
  }

  getSnapshot(): ObservabilitySnapshot {
    if (!this.isDevBuild) {
      return {
        generatedAtMs: Date.now(),
        devBuild: false,
        available: false,
        reason: "dev_build_required",
        config: cloneConfig(DEFAULT_OBSERVABILITY_CONFIG),
        modules: [],
        summary: {
          totalEvents: 0,
          eventsByLevel: { debug: 0, info: 0, warn: 0, error: 0 },
          eventsBySource: { background: 0, content_script: 0, options: 0 },
        },
        events: [],
        predictor: null,
        contentRuntimes: [],
        autoLanguageRuntimes: [],
      };
    }

    return {
      generatedAtMs: Date.now(),
      devBuild: this.isDevBuild,
      available: true,
      config: cloneConfig(this.config),
      modules: this.buildModuleStates(),
      summary: this.buildSummary(),
      events: this.events.map((event) => ({
        ...event,
        context: event.context ? { ...event.context } : undefined,
      })),
      predictor: this.getPredictorSnapshot(),
      contentRuntimes: [...this.contentRuntimes.values()].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
      autoLanguageRuntimes: this.getAutoLanguageRuntimes().map((runtime) => ({
        tabId: runtime.tabId,
        frameId: runtime.frameId,
        runtimeGeneration: runtime.runtimeGeneration,
        domain: runtime.domain,
        updatedAt: runtime.updatedAt,
      })),
    };
  }

  getLegacyPredictorSnapshot(): PredictorDebugSnapshot {
    return this.getPredictorSnapshot();
  }

  private buildSummary(): ObservabilitySnapshot["summary"] {
    const eventsByLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
    const eventsBySource: Record<ObservabilityEvent["source"], number> = {
      background: 0,
      content_script: 0,
      options: 0,
    };
    for (const event of this.events) {
      eventsByLevel[event.level] += 1;
      eventsBySource[event.source] += 1;
    }
    return {
      totalEvents: this.events.length,
      eventsByLevel,
      eventsBySource,
    };
  }

  private buildModuleStates(): ObservabilityModuleState[] {
    const loggerRegisteredModules = new Set<string>(getRegisteredObservabilityModules());
    const allModules = new Set<string>([
      ...OBSERVABILITY_MODULE_IDS,
      ...loggerRegisteredModules,
      ...this.moduleSources.keys(),
    ]);
    return [...allModules]
      .sort((left, right) => left.localeCompare(right))
      .map((moduleId) => {
        const override =
          this.config.moduleOverrides[moduleId as keyof typeof this.config.moduleOverrides];
        return {
          moduleId,
          enabled: typeof override?.enabled === "boolean" ? override.enabled : this.config.enabled,
          level: override?.level || this.config.defaultLevel,
          hasOverride: Boolean(override && Object.keys(override).length > 0),
          override: override || null,
          sources: [
            ...(this.moduleSources.get(moduleId) || new Set<ObservabilityEvent["source"]>()),
          ],
          registered: loggerRegisteredModules.has(moduleId) || this.moduleSources.has(moduleId),
          lastEventAt: this.lastEventAt.get(moduleId) || null,
        };
      });
  }
}
