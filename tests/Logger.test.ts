import { jest } from "@jest/globals";
import { createLogger } from "../src/core/application/logging/Logger";

type LoggingGlobals = typeof globalThis & {
  __FT_DEV_BUILD__?: boolean;
  __FT_LOG_LEVEL__?: string;
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setOptionalBoolean(loggingGlobals, "__FT_DEV_BUILD__", originalDevBuild);
    setOptionalString(loggingGlobals, "__FT_LOG_LEVEL__", originalLogLevel);
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

  test("supports per-logger minLevel override", () => {
    const logger = createLogger("LoggerCustom", { minLevel: "info" });

    logger.debug("hidden");
    logger.info("visible");

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith("[LoggerCustom] visible");
  });
});
