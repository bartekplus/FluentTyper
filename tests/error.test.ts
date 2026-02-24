import { jest } from "@jest/globals";
import { getErrorMessage, logError } from "../src/shared/error";

describe("shared error helpers", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns message from Error instances", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  test("stringifies plain objects", () => {
    expect(getErrorMessage({ code: 42, reason: "invalid" })).toBe(
      '{"code":42,"reason":"invalid"}',
    );
  });

  test("falls back to String() when JSON stringify fails", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(getErrorMessage(circular)).toBe("[object Object]");
  });

  test("logError writes context and forwards original error", () => {
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("network");

    logError("SyncJob", error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[SyncJob] Error: network",
      error,
    );
  });
});
