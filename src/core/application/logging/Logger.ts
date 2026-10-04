import { isDevBuild } from "@core/domain/constants";
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

interface LogContext {
  traceId?: string;
  command?: string;
  requestId?: number;
  tabId?: number;
  frameId?: number;
  suggestionId?: number;
  [key: string]: unknown;
}

type ObservabilitySink = (event: ObservabilityEvent) => void;

interface LoggerRuntimeGlobals {
  __FT_OBSERVABILITY_CONFIG__?: ObservabilityConfig;
  __FT_OBSERVABILITY_SINK__?: ObservabilitySink;
  __FT_OBSERVABILITY_SOURCE__?: ObservabilityEvent["source"];
  __FT_OBSERVABILITY_REGISTERED_MODULES__?: Set<string>;
  __FT_OBSERVABILITY_SEQUENCE__?: number;
}

const globals = globalThis as LoggerRuntimeGlobals;

// Use the bare identifier: the build `define` replaces it, but not `globalThis.__FT_LOG_LEVEL__`.
function resolveDefaultMinLevel(): LogLevel {
  const explicitLogLevel = typeof __FT_LOG_LEVEL__ === "undefined" ? undefined : __FT_LOG_LEVEL__;
  if (isLogLevel(explicitLogLevel)) {
    return explicitLogLevel;
  }
  return isDevBuild() ? "debug" : "warn";
}

function getGlobalObservabilityConfig(): ObservabilityConfig {
  if (globals.__FT_OBSERVABILITY_CONFIG__) {
    return globals.__FT_OBSERVABILITY_CONFIG__;
  }
  return {
    ...DEFAULT_OBSERVABILITY_CONFIG,
    defaultLevel: resolveDefaultMinLevel(),
  };
}

function nextObservabilitySequence(): number {
  const nextValue = (globals.__FT_OBSERVABILITY_SEQUENCE__ || 0) + 1;
  globals.__FT_OBSERVABILITY_SEQUENCE__ = nextValue;
  return nextValue;
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
  if (options.config) {
    globals.__FT_OBSERVABILITY_CONFIG__ = structuredClone(options.config);
  }
  if ("sink" in options) {
    globals.__FT_OBSERVABILITY_SINK__ = options.sink;
  }
  if (options.source) {
    globals.__FT_OBSERVABILITY_SOURCE__ = options.source;
  }
}

export function getRegisteredObservabilityModules(): string[] {
  return [...(globals.__FT_OBSERVABILITY_REGISTERED_MODULES__ ?? [])];
}

function registerObservabilityModule(scope: string): void {
  (globals.__FT_OBSERVABILITY_REGISTERED_MODULES__ ??= new Set<string>()).add(scope);
}

/** Dev-build relay: forwards log events to the background and reports registered modules. */
export function installObservabilityRelay(options: {
  source: ObservabilityEvent["source"];
  config?: ObservabilityConfig;
  eventCommand: string;
  modulesCommand: string;
}): void {
  const send = (message: { command: string; context: Record<string, unknown> }): void => {
    try {
      void chrome.runtime.sendMessage(message)?.catch(() => undefined);
    } catch {
      // Ignore runtime disconnects during page teardown.
    }
  };
  setGlobalObservabilityRuntime({
    config: options.config,
    source: options.source,
    sink: (event) => send({ command: options.eventCommand, context: { event } }),
  });
  send({
    command: options.modulesCommand,
    context: { modules: getRegisteredObservabilityModules() },
  });
}

export function resetGlobalObservabilityRuntime(): void {
  delete globals.__FT_OBSERVABILITY_CONFIG__;
  delete globals.__FT_OBSERVABILITY_SINK__;
  delete globals.__FT_OBSERVABILITY_SOURCE__;
  delete globals.__FT_OBSERVABILITY_REGISTERED_MODULES__;
  delete globals.__FT_OBSERVABILITY_SEQUENCE__;
}

export class Logger {
  private readonly scope: string;
  constructor(scope: string) {
    this.scope = scope;
    registerObservabilityModule(scope);
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

  private canLog(level: LogLevel): boolean {
    const config = getGlobalObservabilityConfig();
    const moduleOverride =
      config.moduleOverrides[this.scope as keyof typeof config.moduleOverrides];
    if (!config.enabled || moduleOverride?.enabled === false) {
      return false;
    }
    const minLevel = moduleOverride?.level || config.defaultLevel || resolveDefaultMinLevel();
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
  }

  private emitEvent(level: LogLevel, message: string, context?: LogContext): void {
    const sink = globals.__FT_OBSERVABILITY_SINK__;
    if (!sink) {
      return;
    }
    sink({
      id: `${this.scope}-${Date.now()}-${nextObservabilitySequence()}`,
      timestampMs: Date.now(),
      source: globals.__FT_OBSERVABILITY_SOURCE__ || "background",
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
    if (!this.canLog(level)) {
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

export function createLogger(scope: string): Logger {
  return new Logger(scope);
}
