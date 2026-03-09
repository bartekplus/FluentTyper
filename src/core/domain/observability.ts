export type LogLevel = "debug" | "info" | "warn" | "error";

export const OBSERVABILITY_MODULE_IDS = [
  "BackgroundServiceWorker",
  "PredictionManager",
  "PredictionOrchestrator",
  "PresageHandler",
  "WebLLMPredictor",
  "EngineLifecycleService",
  "MessageRouter",
  "CommandRouter",
  "LanguageDetector",
  "ProductivityStatsManager",
  "ContentMessageHandler",
  "ContentRuntimeController",
  "HostChangeWatcher",
  "SuggestionPredictionCoordinator",
  "SuggestionManagerRuntime",
  "SuggestionTextEditService",
  "FluentTyperContentScript",
  "OptionsObservability",
  "RuntimeTestHooks",
] as const;

export type ObservabilityModuleId = (typeof OBSERVABILITY_MODULE_IDS)[number];

export interface ObservabilityModuleOverride {
  enabled?: boolean;
  level?: LogLevel;
}

export interface ObservabilityConfig {
  enabled: boolean;
  defaultLevel: LogLevel;
  moduleOverrides: Partial<Record<ObservabilityModuleId, ObservabilityModuleOverride>>;
}

export interface ObservabilityEventContext {
  [key: string]: unknown;
}

export interface ObservabilityEvent {
  id: string;
  timestampMs: number;
  source: "background" | "content_script" | "options";
  moduleId: string;
  level: LogLevel;
  message: string;
  traceId?: string;
  requestId?: number;
  tabId?: number;
  frameId?: number;
  suggestionId?: number;
  context?: ObservabilityEventContext;
}

export interface ObservabilityModuleState {
  moduleId: string;
  enabled: boolean;
  level: LogLevel;
  hasOverride: boolean;
  override: ObservabilityModuleOverride | null;
  sources: Array<ObservabilityEvent["source"]>;
  registered: boolean;
  lastEventAt: number | null;
}

export interface ObservabilityContentRuntimeStatus {
  tabId: number;
  frameId: number;
  runtimeGeneration: number;
  domain: string | null;
  updatedAt: number;
}

export interface ObservabilityAutoLanguageRuntimeStatus {
  tabId: number;
  frameId: number;
  runtimeGeneration: number;
  domain: string | null;
  updatedAt: number;
}

export interface ObservabilitySummary {
  totalEvents: number;
  eventsByLevel: Record<LogLevel, number>;
  eventsBySource: Record<ObservabilityEvent["source"], number>;
}

export interface ObservabilitySnapshot {
  generatedAtMs: number;
  devBuild: boolean;
  available: boolean;
  reason?: "dev_build_required";
  config: ObservabilityConfig;
  modules: ObservabilityModuleState[];
  summary: ObservabilitySummary;
  events: ObservabilityEvent[];
  predictor: Record<string, unknown> | null;
  contentRuntimes: ObservabilityContentRuntimeStatus[];
  autoLanguageRuntimes: ObservabilityAutoLanguageRuntimeStatus[];
}

export function isLogLevel(value: unknown): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

export function isObservabilityModuleId(value: unknown): value is ObservabilityModuleId {
  return (
    typeof value === "string" && OBSERVABILITY_MODULE_IDS.includes(value as ObservabilityModuleId)
  );
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  enabled: true,
  defaultLevel: "debug",
  moduleOverrides: {},
};
