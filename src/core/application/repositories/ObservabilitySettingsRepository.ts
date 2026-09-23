import {
  DEFAULT_OBSERVABILITY_DEFAULT_LEVEL,
  DEFAULT_OBSERVABILITY_ENABLED,
} from "@core/domain/constants";
import {
  isLogLevel,
  sanitizeObservabilityModuleOverrides,
  type LogLevel,
  type ObservabilityConfig,
} from "@core/domain/observability";
import { SettingsRepositoryBase } from "./SettingsRepositoryBase";

interface ObservabilitySettingsSnapshot {
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
      defaultLevel: isLogLevel(defaultLevel) ? defaultLevel : DEFAULT_OBSERVABILITY_DEFAULT_LEVEL,
      moduleOverrides: sanitizeObservabilityModuleOverrides(moduleOverrides),
    };
  }
}
