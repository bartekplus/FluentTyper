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
const CONTENT_RUNTIME_TTL_MS = 5 * 60 * 1000;
const MAX_CONTENT_RUNTIMES = 64;

interface ContentRuntimeState extends ObservabilityContentRuntimeStatus {
  key: string;
}

interface ObservabilityServiceOptions {
  isDevBuild: boolean;
  getPredictorSnapshot: () => PredictorDebugSnapshot;
  getAutoLanguageRuntimes: () => AutoLanguageLiveRuntimeStatus[];
  now?: () => number;
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
  private readonly now: () => number;
  private config: ObservabilityConfig = cloneConfig(DEFAULT_OBSERVABILITY_CONFIG);
  private events: ObservabilityEvent[] = [];
  private readonly moduleSources = new Map<string, Set<ObservabilityEvent["source"]>>();
  private readonly remotelyRegisteredModules = new Map<string, Set<ObservabilityEvent["source"]>>();
  private readonly lastEventAt = new Map<string, number>();
  private readonly contentRuntimes = new Map<string, ContentRuntimeState>();

  constructor(options: ObservabilityServiceOptions) {
    this.isDevBuild = options.isDevBuild;
    this.getPredictorSnapshot = options.getPredictorSnapshot;
    this.getAutoLanguageRuntimes = options.getAutoLanguageRuntimes;
    this.now = options.now || (() => Date.now());
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

  registerRemoteModules(source: ObservabilityEvent["source"], modules: string[]): void {
    if (source === "background") {
      return;
    }
    for (const moduleId of modules) {
      if (typeof moduleId !== "string" || moduleId.trim().length === 0) {
        continue;
      }
      const normalizedModuleId = moduleId.trim();
      const sources =
        this.remotelyRegisteredModules.get(normalizedModuleId) ||
        new Set<ObservabilityEvent["source"]>();
      sources.add(source);
      this.remotelyRegisteredModules.set(normalizedModuleId, sources);
    }
  }

  recordContentRuntimeStatus(scope: {
    tabId: number;
    frameId: number;
    runtimeGeneration: number;
    domainURL?: string;
  }): void {
    if (!Number.isFinite(scope.runtimeGeneration) || scope.runtimeGeneration <= 0) {
      return;
    }
    const key = this.getContentRuntimeKey(scope.tabId, scope.frameId);
    this.contentRuntimes.set(key, {
      key,
      tabId: scope.tabId,
      frameId: scope.frameId,
      runtimeGeneration: scope.runtimeGeneration,
      domain: normalizeDomain(scope.domainURL),
      updatedAt: this.now(),
    });
    this.pruneContentRuntimes(this.now());
  }

  clearEvents(): void {
    this.events = [];
    this.lastEventAt.clear();
    this.moduleSources.clear();
  }

  getSnapshot(): ObservabilitySnapshot {
    this.pruneContentRuntimes(this.now());
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
      contentRuntimes: [...this.contentRuntimes.values()]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((runtime) => ({
          tabId: runtime.tabId,
          frameId: runtime.frameId,
          runtimeGeneration: runtime.runtimeGeneration,
          domain: runtime.domain,
          updatedAt: runtime.updatedAt,
        })),
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

  pruneStaleState(): void {
    this.pruneContentRuntimes(this.now());
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
      ...this.remotelyRegisteredModules.keys(),
      ...this.moduleSources.keys(),
    ]);
    return [...allModules]
      .sort((left, right) => left.localeCompare(right))
      .map((moduleId) => {
        const override =
          this.config.moduleOverrides[moduleId as keyof typeof this.config.moduleOverrides];
        const sources = new Set<ObservabilityEvent["source"]>([
          ...(this.moduleSources.get(moduleId) || new Set<ObservabilityEvent["source"]>()),
          ...(this.remotelyRegisteredModules.get(moduleId) ||
            new Set<ObservabilityEvent["source"]>()),
        ]);
        return {
          moduleId,
          enabled: typeof override?.enabled === "boolean" ? override.enabled : this.config.enabled,
          level: override?.level || this.config.defaultLevel,
          hasOverride: Boolean(override && Object.keys(override).length > 0),
          override: override || null,
          sources: [...sources],
          registered:
            loggerRegisteredModules.has(moduleId) ||
            this.remotelyRegisteredModules.has(moduleId) ||
            this.moduleSources.has(moduleId),
          lastEventAt: this.lastEventAt.get(moduleId) || null,
        };
      });
  }

  private getContentRuntimeKey(tabId: number, frameId: number): string {
    return `${tabId}:${frameId}`;
  }

  private pruneContentRuntimes(now: number): void {
    for (const [key, runtime] of this.contentRuntimes.entries()) {
      if (now - runtime.updatedAt > CONTENT_RUNTIME_TTL_MS) {
        this.contentRuntimes.delete(key);
      }
    }
    if (this.contentRuntimes.size <= MAX_CONTENT_RUNTIMES) {
      return;
    }
    const staleFirst = [...this.contentRuntimes.values()].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
    for (const runtime of staleFirst.slice(MAX_CONTENT_RUNTIMES)) {
      this.contentRuntimes.delete(runtime.key);
    }
  }
}
