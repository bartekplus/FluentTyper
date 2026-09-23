import { jest } from "bun:test";
import {
  createLogger,
  installObservabilityRelay,
  resetGlobalObservabilityRuntime,
  setGlobalObservabilityRuntime,
} from "../src/core/application/logging/Logger";
import {
  sanitizeObservabilityModuleOverrides,
  type ObservabilityConfig,
} from "../src/core/domain/observability";

type LoggingGlobals = typeof globalThis & {
  __FT_DEV_BUILD__?: boolean;
  __FT_LOG_LEVEL__?: string;
  __FT_OBSERVABILITY_CONFIG__?: ObservabilityConfig;
};

function setOptionalBoolean(
  globals: LoggingGlobals,
  key: "__FT_DEV_BUILD__",
  value: boolean | undefined,
): void {
  if (typeof value === "boolean") {
    globals[key] = value;
    return;
  }
  delete globals[key];
}

function setOptionalString(
  globals: LoggingGlobals,
  key: "__FT_LOG_LEVEL__",
  value: string | undefined,
): void {
  if (typeof value === "string") {
    globals[key] = value;
    return;
  }
  delete globals[key];
}

describe("Logger", () => {
  const loggingGlobals = globalThis as LoggingGlobals;
  const originalDevBuild = loggingGlobals.__FT_DEV_BUILD__;
  const originalLogLevel = loggingGlobals.__FT_LOG_LEVEL__;

  beforeEach(() => {
    jest.spyOn(console, "debug").mockImplementation(() => undefined);
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    delete loggingGlobals.__FT_DEV_BUILD__;
    delete loggingGlobals.__FT_LOG_LEVEL__;
    delete loggingGlobals.__FT_OBSERVABILITY_CONFIG__;
    resetGlobalObservabilityRuntime();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setOptionalBoolean(loggingGlobals, "__FT_DEV_BUILD__", originalDevBuild);
    setOptionalString(loggingGlobals, "__FT_LOG_LEVEL__", originalLogLevel);
    resetGlobalObservabilityRuntime();
  });

  test("defaults to warn level in non-dev builds", () => {
    const logger = createLogger("LoggerDefaultProd");

    logger.debug("debug message");
    logger.warn("warn message", { requestId: 17 });

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith("[LoggerDefaultProd] warn message", {
      requestId: 17,
    });
  });

  test("defaults to debug level in dev builds", () => {
    loggingGlobals.__FT_DEV_BUILD__ = true;
    const logger = createLogger("LoggerDev");

    logger.debug("debug enabled");

    expect(console.debug).toHaveBeenCalledWith("[LoggerDev] debug enabled");
  });

  test("respects explicit FT_LOG_LEVEL override", () => {
    loggingGlobals.__FT_DEV_BUILD__ = true;
    loggingGlobals.__FT_LOG_LEVEL__ = "error";
    const logger = createLogger("LoggerOverride");

    logger.warn("warn hidden");
    logger.error("error visible", { command: "CMD_TEST" });

    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("[LoggerOverride] error visible", {
      command: "CMD_TEST",
    });
  });

  test("supports runtime module overrides", () => {
    setGlobalObservabilityRuntime({
      config: {
        enabled: true,
        defaultLevel: "error",
        moduleOverrides: {
          OptionsObservability: {
            enabled: true,
            level: "debug",
          },
        },
      },
    });
    const logger = createLogger("OptionsObservability");

    logger.debug("visible from override");

    expect(console.debug).toHaveBeenCalledWith("[OptionsObservability] visible from override");
  });

  test("suppresses disabled modules from runtime config", () => {
    setGlobalObservabilityRuntime({
      config: {
        enabled: true,
        defaultLevel: "debug",
        moduleOverrides: {
          OptionsObservability: {
            enabled: false,
          },
        },
      },
    });
    const logger = createLogger("OptionsObservability");

    logger.error("hidden");

    expect(console.error).not.toHaveBeenCalled();
  });

  test("installObservabilityRelay reports modules and forwards events with the given commands", () => {
    const globals = globalThis as { chrome?: unknown };
    const originalChrome = globals.chrome;
    const sendMessage = jest.fn(() => Promise.resolve());
    globals.chrome = { runtime: { sendMessage } };
    try {
      const logger = createLogger("RelayModule");
      installObservabilityRelay({
        source: "options",
        config: { enabled: true, defaultLevel: "warn", moduleOverrides: {} },
        eventCommand: "CMD_EVENT",
        modulesCommand: "CMD_MODULES",
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith({
        command: "CMD_MODULES",
        context: { modules: expect.arrayContaining(["RelayModule"]) },
      });

      logger.info("hidden by config");
      logger.warn("relayed");

      expect(sendMessage).toHaveBeenCalledTimes(2);
      expect(sendMessage).toHaveBeenLastCalledWith({
        command: "CMD_EVENT",
        context: {
          event: expect.objectContaining({
            source: "options",
            moduleId: "RelayModule",
            level: "warn",
            message: "relayed",
          }),
        },
      });
    } finally {
      globals.chrome = originalChrome;
    }
  });

  test("sanitizeObservabilityModuleOverrides keeps only known modules with valid fields", () => {
    expect(sanitizeObservabilityModuleOverrides(null)).toEqual({});
    expect(sanitizeObservabilityModuleOverrides([])).toEqual({});
    expect(
      sanitizeObservabilityModuleOverrides({
        UnknownModule: { enabled: true },
        PresageHandler: { enabled: "yes", level: "loud" },
        MessageRouter: [],
        OptionsObservability: { enabled: false, level: "info", extra: 1 },
        LanguageDetector: { level: "error" },
      }),
    ).toEqual({
      OptionsObservability: { enabled: false, level: "info" },
      LanguageDetector: { level: "error" },
    });
  });
});
