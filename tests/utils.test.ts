import { jest, spyOn } from "bun:test";
import {
  SETTINGS_DOMAIN_BLACKLIST,
  addDomainToList,
  blockUnBlockDomain,
  getDomain,
  isDomainOnList,
  isEnabledForDomain,
  isNumber,
  isWhiteSpace,
  removeDomainFromList,
} from "../src/core/application/domain-utils";
import { getDeepActiveElement, isInDocument } from "../src/core/application/dom-utils";
import { checkLastError } from "../src/core/application/transport-utils";
import { memorySettings } from "./support/fakeSettings";

function domainListSettings(domainList: unknown[]) {
  return memorySettings({ [SETTINGS_DOMAIN_BLACKLIST]: domainList });
}

describe("shared utils domain list handling", () => {
  test("isDomainOnList matches exact normalized host and not regex-like false positives", async () => {
    const settings = domainListSettings(["example.com"]);

    await expect(isDomainOnList(settings, "https://EXAMPLE.com/path")).resolves.toBe(true);
    await expect(isDomainOnList(settings, "exampleXcom")).resolves.toBe(false);
  });

  test("isDomainOnList ignores invalid entries and still matches valid hosts", async () => {
    const settings = domainListSettings(["[", "localhost"]);

    await expect(isDomainOnList(settings, "localhost")).resolves.toBe(true);
  });

  test("addDomainToList stores normalized host and ignores invalid host input", async () => {
    const settings = domainListSettings([]);
    const { store: state } = settings;
    const setMock = spyOn(settings, "set");

    await addDomainToList(settings, "https://Example.COM/path?a=1");
    expect(state[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["example.com"]);
    expect(setMock).toHaveBeenCalledTimes(1);

    await addDomainToList(settings, "[");
    expect(state[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["example.com"]);
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  test("addDomainToList handles host:port/path input by keeping host only", async () => {
    const settings = domainListSettings([]);
    const { store: state } = settings;

    await addDomainToList(settings, "localhost:8080/path");
    expect(state[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["localhost"]);
  });

  test("removeDomainFromList removes only exact normalized host match", async () => {
    const settings = domainListSettings([
      "example.com",
      "exampleXcom",
      "https://LOCALHOST:8080/path",
    ]);
    const { store: state } = settings;

    await removeDomainFromList(settings, "exampleXcom");
    expect(state[SETTINGS_DOMAIN_BLACKLIST]).toEqual([
      "example.com",
      "https://LOCALHOST:8080/path",
    ]);

    await removeDomainFromList(settings, "localhost");
    expect(state[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["example.com"]);
  });

  test("removeDomainFromList matches entries stored as URL by host", async () => {
    const settings = domainListSettings(["https://LOCALHOST/path"]);
    const { store: state } = settings;
    const getMock = spyOn(settings, "get");

    await removeDomainFromList(settings, "localhost");
    expect(state[SETTINGS_DOMAIN_BLACKLIST]).toEqual([]);
    expect(getMock).toHaveBeenCalledWith(SETTINGS_DOMAIN_BLACKLIST);
  });
});

describe("shared utils DOM helpers", () => {
  test("isInDocument returns false for detached nodes and true only while attached", () => {
    const element = document.createElement("div");
    expect(isInDocument(element)).toBe(false);

    document.body.appendChild(element);
    expect(isInDocument(element)).toBe(true);

    element.remove();
    expect(isInDocument(element)).toBe(false);
  });

  // Regression: document.contains() does not pierce shadow boundaries;
  // isInDocument must walk the shadow host chain instead.
  test("isInDocument returns true for an element inside an attached open shadow root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("input");
    shadow.appendChild(inner);

    // Verify that document.contains() is the naive approach that would fail:
    expect(document.contains(inner)).toBe(false);
    // The shadow-aware helper must return true:
    expect(isInDocument(inner)).toBe(true);

    host.remove();
  });

  test("isInDocument returns false when the shadow host is removed from the document", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("input");
    shadow.appendChild(inner);
    expect(isInDocument(inner)).toBe(true);

    host.remove();
    expect(isInDocument(inner)).toBe(false);
  });

  test("isInDocument returns true for a doubly-nested shadow tree", () => {
    const outerHost = document.createElement("div");
    document.body.appendChild(outerHost);
    const outerShadow = outerHost.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    outerShadow.appendChild(innerHost);
    const innerShadow = innerHost.attachShadow({ mode: "open" });
    const deepInput = document.createElement("input");
    innerShadow.appendChild(deepInput);

    expect(isInDocument(deepInput)).toBe(true);

    outerHost.remove();
    expect(isInDocument(deepInput)).toBe(false);
  });

  test("getDeepActiveElement returns document.body when nothing is focused", () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(getDeepActiveElement(document)).toBe(document.body);
  });

  test("getDeepActiveElement returns light-DOM focused element", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(getDeepActiveElement(document)).toBe(input);
    input.remove();
  });

  test("getDeepActiveElement pierces open shadow root to find focused element", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    shadow.appendChild(input);
    input.focus();
    expect(getDeepActiveElement(document)).toBe(input);
    host.remove();
  });
});

describe("shared utils domain enablement", () => {
  test("getDomain extracts hostname and returns undefined for invalid input", () => {
    expect(getDomain("https://example.com/path")).toBe("example.com");
    expect(getDomain("[" as unknown as string)).toBeUndefined();
  });

  test("isEnabledForDomain applies blacklist and whitelist rules", async () => {
    const blackList = memorySettings({
      enable: true,
      domainListMode: "blackList",
      [SETTINGS_DOMAIN_BLACKLIST]: ["blocked.example"],
    });
    const whiteList = memorySettings({
      enable: true,
      domainListMode: "whiteList",
      [SETTINGS_DOMAIN_BLACKLIST]: ["allowed.example"],
    });

    await expect(isEnabledForDomain(blackList, "https://blocked.example")).resolves.toBe(false);
    await expect(isEnabledForDomain(blackList, "https://other.example")).resolves.toBe(true);
    await expect(isEnabledForDomain(whiteList, "https://allowed.example")).resolves.toBe(true);
    await expect(isEnabledForDomain(whiteList, "https://other.example")).resolves.toBe(false);
  });

  test("isEnabledForDomain defaults global enablement to true when unset", async () => {
    const settings = memorySettings({
      domainListMode: "blackList",
      [SETTINGS_DOMAIN_BLACKLIST]: [],
    });

    await expect(isEnabledForDomain(settings, "https://example.com")).resolves.toBe(true);
  });

  test("blockUnBlockDomain delegates to add/remove based on mode and action", async () => {
    const blackList = memorySettings({
      domainListMode: "blackList",
      [SETTINGS_DOMAIN_BLACKLIST]: ["remove.example"],
    });
    await blockUnBlockDomain(blackList, "add.example", true);
    await blockUnBlockDomain(blackList, "remove.example", false);
    expect(blackList.store[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["add.example"]);

    const whiteList = memorySettings({
      domainListMode: "whiteList",
      [SETTINGS_DOMAIN_BLACKLIST]: ["remove.example"],
    });
    await blockUnBlockDomain(whiteList, "remove.example", true);
    await blockUnBlockDomain(whiteList, "add.example", false);
    expect(whiteList.store[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["add.example"]);
  });

  test("character helpers correctly classify input", () => {
    expect(isWhiteSpace("\n")).toBe(true);
    expect(isWhiteSpace("a")).toBe(false);
    expect(isNumber("4.2")).toBe(true);
    expect(isNumber("a1b2")).toBe(true);
    expect(isNumber("abc")).toBe(false);
    expect(isNumber("١٢٣")).toBe(true); // Arabic-Indic
    expect(isNumber("۱۲")).toBe(true); // Persian
    expect(isNumber("ك١")).toBe(false);
  });
});

describe("checkLastError", () => {
  const baseChrome = globalThis.chrome;

  afterEach(() => {
    jest.restoreAllMocks();
    globalThis.chrome = baseChrome;
  });

  test("logs runtime message and handles missing runtime safely", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    (globalThis as { chrome: unknown }).chrome = {
      runtime: { lastError: { message: "boom" } },
    };
    checkLastError();
    expect(logSpy).toHaveBeenCalledWith("Runtime error:", "boom");

    (globalThis as { chrome: unknown }).chrome = {};
    checkLastError();
    expect(errorSpy).toHaveBeenCalled();
  });
});
