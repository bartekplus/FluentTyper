import { jest } from "bun:test";
import type { SettingsManager } from "../src/core/application/settingsManager";

type DomainUtilsModule = typeof import("../src/core/application/domain-utils");
type TransportUtilsModule = typeof import("../src/core/application/transport-utils");

let importNonce = 0;
let domainUtils: DomainUtilsModule;
let transportUtils: TransportUtilsModule;

function freshModulePath(path: string): string {
  importNonce += 1;
  return `${path}?bun_test_nonce_utils_additional=${importNonce}`;
}

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
  beforeEach(async () => {
    domainUtils = await import(freshModulePath("../src/core/application/domain-utils"));
    transportUtils = await import(freshModulePath("../src/core/application/transport-utils"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("getDomain extracts hostname and returns undefined for invalid input", () => {
    expect(domainUtils.getDomain("https://example.com/path")).toBe("example.com");
    expect(domainUtils.getDomain("[" as unknown as string)).toBeUndefined();
  });

  test("isEnabledForDomain applies blacklist and whitelist rules", async () => {
    const domainListKey = domainUtils.SETTINGS_DOMAIN_BLACKLIST;
    const blackListState = {
      enable: true,
      domainListMode: "blackList",
      [domainListKey]: ["blocked.example"],
    };
    const whiteListState = {
      enable: true,
      domainListMode: "whiteList",
      [domainListKey]: ["allowed.example"],
    };

    await expect(
      domainUtils.isEnabledForDomain(createSettings(blackListState), "https://blocked.example"),
    ).resolves.toBe(false);
    await expect(
      domainUtils.isEnabledForDomain(createSettings(blackListState), "https://other.example"),
    ).resolves.toBe(true);
    await expect(
      domainUtils.isEnabledForDomain(createSettings(whiteListState), "https://allowed.example"),
    ).resolves.toBe(true);
    await expect(
      domainUtils.isEnabledForDomain(createSettings(whiteListState), "https://other.example"),
    ).resolves.toBe(false);
  });

  test("isEnabledForDomain defaults global enablement to true when unset", async () => {
    const domainListKey = domainUtils.SETTINGS_DOMAIN_BLACKLIST;
    const state = {
      domainListMode: "blackList",
      [domainListKey]: [],
    };

    await expect(
      domainUtils.isEnabledForDomain(createSettings(state), "https://example.com"),
    ).resolves.toBe(true);
  });

  test("blockUnBlockDomain delegates to add/remove based on mode and action", async () => {
    const domainListKey = domainUtils.SETTINGS_DOMAIN_BLACKLIST;
    const blackListState = {
      domainListMode: "blackList",
      [domainListKey]: ["remove.example"],
    };
    const whiteListState = {
      domainListMode: "whiteList",
      [domainListKey]: ["remove.example"],
    };

    const blackListSettings = createSettings(blackListState);
    await domainUtils.blockUnBlockDomain(blackListSettings, "add.example", true);
    await domainUtils.blockUnBlockDomain(blackListSettings, "remove.example", false);
    expect(blackListState[domainListKey]).toEqual(["add.example"]);

    const whiteListSettings = createSettings(whiteListState);
    await domainUtils.blockUnBlockDomain(whiteListSettings, "remove.example", true);
    await domainUtils.blockUnBlockDomain(whiteListSettings, "add.example", false);
    expect(whiteListState[domainListKey]).toEqual(["add.example"]);
  });

  test("checkLastError logs runtime message and handles missing runtime safely", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    (globalThis as { chrome: unknown }).chrome = {
      runtime: { lastError: { message: "boom" } },
    };
    transportUtils.checkLastError();
    expect(logSpy).toHaveBeenCalledWith("Runtime error:", "boom");

    (globalThis as { chrome: unknown }).chrome = {};
    transportUtils.checkLastError();
    expect(errorSpy).toHaveBeenCalled();
  });

  test("character helpers correctly classify input", () => {
    expect(domainUtils.isWhiteSpace("\n")).toBe(true);
    expect(domainUtils.isWhiteSpace("\n", false)).toBe(false);
    expect(domainUtils.isLetter("Ż")).toBe(true);
    expect(domainUtils.isLetter("1")).toBe(false);
    expect(domainUtils.isNumber("4.2")).toBe(true);
    expect(domainUtils.isNumber("a1b2")).toBe(true);
    expect(domainUtils.isNumber("abc")).toBe(false);
  });
});
