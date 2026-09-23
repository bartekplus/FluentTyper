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

type ObservabilityModuleId = (typeof OBSERVABILITY_MODULE_IDS)[number];

export interface ObservabilityModuleOverride {
  enabled?: boolean;
  level?: LogLevel;
}

export interface ObservabilityConfig {
  enabled: boolean;
  defaultLevel: LogLevel;
  moduleOverrides: Partial<Record<ObservabilityModuleId, ObservabilityModuleOverride>>;
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
  context?: Record<string, unknown>;
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
  predictor: unknown;
  contentRuntimes: ObservabilityContentRuntimeStatus[];
  autoLanguageRuntimes: ObservabilityContentRuntimeStatus[];
}

export function isLogLevel(value: unknown): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function isObservabilityModuleId(value: unknown): value is ObservabilityModuleId {
  return (
    typeof value === "string" && OBSERVABILITY_MODULE_IDS.includes(value as ObservabilityModuleId)
  );
}

function sanitizeModuleOverride(value: unknown): ObservabilityModuleOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const override: ObservabilityModuleOverride = {};
  if (typeof record.enabled === "boolean") {
    override.enabled = record.enabled;
  }
  if (isLogLevel(record.level)) {
    override.level = record.level;
  }
  return Object.keys(override).length > 0 ? override : null;
}

export function sanitizeObservabilityModuleOverrides(
  value: unknown,
): ObservabilityConfig["moduleOverrides"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: ObservabilityConfig["moduleOverrides"] = {};
  for (const [moduleId, overrideValue] of Object.entries(value as Record<string, unknown>)) {
    if (!isObservabilityModuleId(moduleId)) {
      continue;
    }
    const override = sanitizeModuleOverride(overrideValue);
    if (override) {
      result[moduleId] = override;
    }
  }
  return result;
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  enabled: true,
  defaultLevel: "debug",
  moduleOverrides: {},
};
