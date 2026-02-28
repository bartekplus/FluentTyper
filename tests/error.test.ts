import { jest } from "bun:test";

type ErrorModule = typeof import("../src/core/domain/error");

let importNonce = 0;
let errorModule: ErrorModule;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_error=${importNonce}`;
}

describe("shared error helpers", () => {
  beforeEach(async () => {
    errorModule = await import(freshModulePath("../src/core/domain/error"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns message from Error instances", () => {
    expect(errorModule.getErrorMessage(new Error("boom"))).toBe("boom");
  });

  test("stringifies plain objects", () => {
    expect(errorModule.getErrorMessage({ code: 42, reason: "invalid" })).toBe(
      '{"code":42,"reason":"invalid"}',
    );
  });

  test("falls back to String() when JSON stringify fails", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(errorModule.getErrorMessage(circular)).toBe("[object Object]");
  });

  test("logError writes context and forwards original error", () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("network");

    errorModule.logError("SyncJob", error);

    expect(consoleErrorSpy).toHaveBeenCalledWith("[SyncJob] Error: network", error);
  });

  test("identifies fluent typer config error shape", () => {
    const error = new errorModule.ConfigError("Invalid runtime config", {
      code: "invalid_runtime_config",
    });

    expect(errorModule.isFluentTyperError(error)).toBe(true);
    expect(error.kind).toBe("config");
    expect(error.code).toBe("invalid_runtime_config");
  });
});
