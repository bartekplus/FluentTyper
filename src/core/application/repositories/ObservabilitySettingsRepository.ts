import {
  DEFAULT_OBSERVABILITY_DEFAULT_LEVEL,
  DEFAULT_OBSERVABILITY_ENABLED,
} from "@core/domain/constants";
import {
  isLogLevel,
  isObservabilityModuleId,
  type LogLevel,
  type ObservabilityConfig,
  type ObservabilityModuleOverride,
} from "@core/domain/observability";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

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

function sanitizeModuleOverrides(value: unknown): ObservabilityConfig["moduleOverrides"] {
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

export interface ObservabilitySettingsSnapshot {
  enabled: boolean;
  defaultLevel: LogLevel;
  moduleOverrides: ObservabilityConfig["moduleOverrides"];
}

export class ObservabilitySettingsRepository extends SettingsRepositoryBase {
  async getSnapshot(): Promise<ObservabilitySettingsSnapshot> {
    const [enabled, defaultLevel, moduleOverrides] = await Promise.all([
      this.getField("observabilityEnabled"),
      this.getField("observabilityDefaultLevel"),
      this.getField("observabilityModuleOverrides"),
    ]);

    return {
      enabled: typeof enabled === "boolean" ? enabled : DEFAULT_OBSERVABILITY_ENABLED,
      defaultLevel: isLogLevel(defaultLevel)
        ? defaultLevel
        : (DEFAULT_OBSERVABILITY_DEFAULT_LEVEL as LogLevel),
      moduleOverrides: sanitizeModuleOverrides(moduleOverrides),
    };
  }
}
