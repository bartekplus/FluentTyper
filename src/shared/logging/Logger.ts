export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogContext {
  command?: string;
  requestId?: number;
  tabId?: number;
  frameId?: number;
  tributeId?: number;
  [key: string]: unknown;
}

export interface LoggerOptions {
  minLevel?: LogLevel;
}

function resolveDefaultMinLevel(): LogLevel {
  const maybeGlobal = globalThis as {
    __FT_DEV_BUILD__?: boolean;
    __FT_E2E_BUILD__?: boolean;
  };
  const isDev = Boolean(maybeGlobal.__FT_DEV_BUILD__);
  const isE2E = Boolean(maybeGlobal.__FT_E2E_BUILD__);
  return isDev || isE2E ? "debug" : "warn";
}

export class Logger {
  private readonly scope: string;
  private minLevel: LogLevel;

  constructor(scope: string, options: LoggerOptions = {}) {
    this.scope = scope;
    this.minLevel = options.minLevel || resolveDefaultMinLevel();
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
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
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.canLog(level)) {
      return;
    }

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
