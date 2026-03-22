import {
  DEFAULT_OBSERVABILITY_CONFIG,
  isLogLevel,
  type LogLevel,
  type ObservabilityConfig,
  type ObservabilityEvent,
} from "@core/domain/observability";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogContext {
  traceId?: string;
  command?: string;
  requestId?: number;
  tabId?: number;
  frameId?: number;
  suggestionId?: number;
  [key: string]: unknown;
}

export interface LoggerOptions {
  minLevel?: LogLevel;
}

type ObservabilitySink = (event: ObservabilityEvent) => void;

interface LoggerRuntimeGlobals {
  __FT_DEV_BUILD__?: boolean;
  __FT_LOG_LEVEL__?: string;
  __FT_OBSERVABILITY_CONFIG__?: ObservabilityConfig;
  __FT_OBSERVABILITY_SINK__?: ObservabilitySink;
  __FT_OBSERVABILITY_SOURCE__?: ObservabilityEvent["source"];
  __FT_OBSERVABILITY_REGISTERED_MODULES__?: Set<string>;
  __FT_OBSERVABILITY_SEQUENCE__?: number;
}

function getLoggingGlobals(): LoggerRuntimeGlobals {
  return globalThis as LoggerRuntimeGlobals;
}

function resolveDefaultMinLevel(): LogLevel {
  const globals = getLoggingGlobals();
  const explicitLogLevel = globals.__FT_LOG_LEVEL__;
  if (isLogLevel(explicitLogLevel)) {
    return explicitLogLevel;
  }
  return globals.__FT_DEV_BUILD__ ? "debug" : "warn";
}

function getGlobalObservabilityConfig(): ObservabilityConfig {
  const globals = getLoggingGlobals();
  if (globals.__FT_OBSERVABILITY_CONFIG__) {
    return globals.__FT_OBSERVABILITY_CONFIG__;
  }
  return {
    ...DEFAULT_OBSERVABILITY_CONFIG,
    defaultLevel: resolveDefaultMinLevel(),
  };
}

function getGlobalObservabilitySource(): ObservabilityEvent["source"] {
  const globals = getLoggingGlobals();
  return globals.__FT_OBSERVABILITY_SOURCE__ || "background";
}

function nextObservabilitySequence(): number {
  const globals = getLoggingGlobals();
  const nextValue = (globals.__FT_OBSERVABILITY_SEQUENCE__ || 0) + 1;
  globals.__FT_OBSERVABILITY_SEQUENCE__ = nextValue;
  return nextValue;
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

function sanitizeContext(context?: LogContext): Record<string, unknown> | undefined {
  if (!context) {
    return undefined;
  }
  const metadataKeys = new Set(["traceId", "requestId", "tabId", "frameId", "suggestionId"]);
  const details = Object.fromEntries(
    Object.entries(context).filter(([key]) => !metadataKeys.has(key)),
  );
  return Object.keys(details).length > 0 ? details : undefined;
}

export function setGlobalObservabilityRuntime(options: {
  config?: ObservabilityConfig;
  sink?: ObservabilitySink;
  source?: ObservabilityEvent["source"];
}): void {
  const globals = getLoggingGlobals();
  if (options.config) {
    globals.__FT_OBSERVABILITY_CONFIG__ = cloneConfig(options.config);
  }
  if ("sink" in options) {
    globals.__FT_OBSERVABILITY_SINK__ = options.sink;
  }
  if (options.source) {
    globals.__FT_OBSERVABILITY_SOURCE__ = options.source;
  }
}

export function getRegisteredObservabilityModules(): string[] {
  return [...(getLoggingGlobals().__FT_OBSERVABILITY_REGISTERED_MODULES__ || new Set<string>())];
}

export function registerObservabilityModule(scope: string): void {
  const globals = getLoggingGlobals();
  if (!globals.__FT_OBSERVABILITY_REGISTERED_MODULES__) {
    globals.__FT_OBSERVABILITY_REGISTERED_MODULES__ = new Set<string>();
  }
  globals.__FT_OBSERVABILITY_REGISTERED_MODULES__.add(scope);
}

export function resetGlobalObservabilityRuntime(): void {
  const globals = getLoggingGlobals();
  delete globals.__FT_OBSERVABILITY_CONFIG__;
  delete globals.__FT_OBSERVABILITY_SINK__;
  delete globals.__FT_OBSERVABILITY_SOURCE__;
  delete globals.__FT_OBSERVABILITY_REGISTERED_MODULES__;
  delete globals.__FT_OBSERVABILITY_SEQUENCE__;
}

export class Logger {
  private readonly scope: string;
  private explicitMinLevel?: LogLevel;

  constructor(scope: string, options: LoggerOptions = {}) {
    this.scope = scope;
    this.explicitMinLevel = options.minLevel;
    registerObservabilityModule(scope);
  }

  setMinLevel(level: LogLevel): void {
    this.explicitMinLevel = level;
  }

  debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log("error", message, context);
  }

  private resolveEffectiveMinLevel(): LogLevel {
    if (this.explicitMinLevel) {
      return this.explicitMinLevel;
    }
    const config = getGlobalObservabilityConfig();
    const moduleOverride =
      config.moduleOverrides[this.scope as keyof typeof config.moduleOverrides];
    if (moduleOverride?.level) {
      return moduleOverride.level;
    }
    return config.defaultLevel || resolveDefaultMinLevel();
  }

  private isEnabled(): boolean {
    const config = getGlobalObservabilityConfig();
    if (!config.enabled) {
      return false;
    }
    const moduleOverride =
      config.moduleOverrides[this.scope as keyof typeof config.moduleOverrides];
    if (typeof moduleOverride?.enabled === "boolean") {
      return moduleOverride.enabled;
    }
    return true;
  }

  private canLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.resolveEffectiveMinLevel()];
  }

  private emitEvent(level: LogLevel, message: string, context?: LogContext): void {
    const sink = getLoggingGlobals().__FT_OBSERVABILITY_SINK__;
    if (!sink) {
      return;
    }
    sink({
      id: `${this.scope}-${Date.now()}-${nextObservabilitySequence()}`,
      timestampMs: Date.now(),
      source: getGlobalObservabilitySource(),
      moduleId: this.scope,
      level,
      message,
      traceId: typeof context?.traceId === "string" ? context.traceId : undefined,
      requestId: typeof context?.requestId === "number" ? context.requestId : undefined,
      tabId: typeof context?.tabId === "number" ? context.tabId : undefined,
      frameId: typeof context?.frameId === "number" ? context.frameId : undefined,
      suggestionId: typeof context?.suggestionId === "number" ? context.suggestionId : undefined,
      context: sanitizeContext(context),
    });
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.isEnabled() || !this.canLog(level)) {
      return;
    }

    this.emitEvent(level, message, context);

    const prefix = `[${this.scope}]`;
    if (context && Object.keys(context).length > 0) {
      console[level](`${prefix} ${message}`, context);
      return;
    }
    console[level](`${prefix} ${message}`);
  }
}

export function createLogger(scope: string, options?: LoggerOptions): Logger {
  return new Logger(scope, options);
}
