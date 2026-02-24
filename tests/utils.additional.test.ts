import { jest } from "@jest/globals";
import {
  SETTINGS_DOMAIN_BLACKLIST,
  blockUnBlockDomain,
  checkLastError,
  countDigits,
  debounce,
  getDomain,
  isEnabledForDomain,
  isLetter,
  isNumber,
  isWhiteSpace,
} from "../src/shared/utils";
import type { SettingsManager } from "../src/shared/settingsManager";

function createSettings(state: Record<string, unknown>) {
  const settings = {
    get: jest.fn(async (key: string) => state[key]),
    set: jest.fn(async (key: string, value: unknown) => {
      state[key] = value;
    }),
  };
  return settings as unknown as SettingsManager;
}

describe("shared utils additional coverage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("getDomain extracts hostname and returns undefined for invalid input", () => {
    expect(getDomain("https://example.com/path")).toBe("example.com");
    expect(getDomain("[" as unknown as string)).toBeUndefined();
  });

  test("isEnabledForDomain applies blacklist and whitelist rules", async () => {
    const blackListState = {
      enable: true,
      domainListMode: "blackList",
      [SETTINGS_DOMAIN_BLACKLIST]: ["blocked.example"],
    };
    const whiteListState = {
      enable: true,
      domainListMode: "whiteList",
      [SETTINGS_DOMAIN_BLACKLIST]: ["allowed.example"],
    };

    await expect(
      isEnabledForDomain(
        createSettings(blackListState),
        "https://blocked.example",
      ),
    ).resolves.toBe(false);
    await expect(
      isEnabledForDomain(
        createSettings(blackListState),
        "https://other.example",
      ),
    ).resolves.toBe(true);
    await expect(
      isEnabledForDomain(
        createSettings(whiteListState),
        "https://allowed.example",
      ),
    ).resolves.toBe(true);
    await expect(
      isEnabledForDomain(
        createSettings(whiteListState),
        "https://other.example",
      ),
    ).resolves.toBe(false);
  });

  test("blockUnBlockDomain delegates to add/remove based on mode and action", async () => {
    const blackListState = {
      domainListMode: "blackList",
      [SETTINGS_DOMAIN_BLACKLIST]: ["remove.example"],
    };
    const whiteListState = {
      domainListMode: "whiteList",
      [SETTINGS_DOMAIN_BLACKLIST]: ["remove.example"],
    };

    const blackListSettings = createSettings(blackListState);
    await blockUnBlockDomain(blackListSettings, "add.example", true);
    await blockUnBlockDomain(blackListSettings, "remove.example", false);
    expect(blackListState[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["add.example"]);

    const whiteListSettings = createSettings(whiteListState);
    await blockUnBlockDomain(whiteListSettings, "remove.example", true);
    await blockUnBlockDomain(whiteListSettings, "add.example", false);
    expect(whiteListState[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["add.example"]);
  });

  test("checkLastError logs runtime message and handles missing runtime safely", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    (globalThis as { chrome: unknown }).chrome = {
      runtime: { lastError: { message: "boom" } },
    };
    checkLastError();
    expect(logSpy).toHaveBeenCalledWith("Runtime error:", "boom");

    (globalThis as { chrome: unknown }).chrome = {};
    checkLastError();
    expect(errorSpy).toHaveBeenCalled();
  });

  test("debounce supports leading+trailing and trailing-only modes", () => {
    jest.useFakeTimers();
    const calls: string[] = [];

    const leadingAndTrailing = debounce(
      (value: string) => calls.push(`lt:${value}`),
      10,
      { leading: true, trailing: true },
    );
    leadingAndTrailing("a");
    leadingAndTrailing("b");
    expect(calls).toEqual(["lt:a"]);
    jest.advanceTimersByTime(10);
    expect(calls).toEqual(["lt:a", "lt:b"]);

    const trailingOnly = debounce(
      (value: string) => calls.push(`t:${value}`),
      10,
      {
        leading: false,
        trailing: true,
      },
    );
    trailingOnly("c");
    expect(calls).toEqual(["lt:a", "lt:b"]);
    jest.advanceTimersByTime(10);
    expect(calls).toEqual(["lt:a", "lt:b", "t:c"]);

    jest.useRealTimers();
  });

  test("character helpers correctly classify input", () => {
    expect(isWhiteSpace("\n")).toBe(true);
    expect(isWhiteSpace("\n", false)).toBe(false);
    expect(isLetter("Ż")).toBe(true);
    expect(isLetter("1")).toBe(false);
    expect(countDigits("ab12c3")).toBe(3);
    expect(isNumber("4.2")).toBe(true);
    expect(isNumber("a1b2")).toBe(true);
    expect(isNumber("abc")).toBe(false);
  });
});
