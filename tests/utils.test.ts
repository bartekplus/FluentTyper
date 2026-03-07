import { jest } from "bun:test";
import {
  SETTINGS_DOMAIN_BLACKLIST,
  addDomainToList,
  isDomainOnList,
  removeDomainFromList,
} from "../src/core/application/domain-utils";
import { getDeepActiveElement, isInDocument } from "../src/core/application/dom-utils";
import type { SettingsManager } from "../src/core/application/settingsManager";

function createSettingsManager(initialDomainList: unknown[]) {
  const state: Record<string, unknown> = {
    [SETTINGS_DOMAIN_BLACKLIST]: initialDomainList,
  };

  const settings = {
    get: jest.fn(async (key: string) => state[key]),
    set: jest.fn(async (key: string, value: unknown) => {
      state[key] = value;
    }),
  };

  return {
    state,
    settings: settings as unknown as SettingsManager,
    getMock: settings.get,
    setMock: settings.set,
  };
}

describe("shared utils domain list handling", () => {
  test("isDomainOnList matches exact normalized host and not regex-like false positives", async () => {
    const { settings } = createSettingsManager(["example.com"]);

    await expect(isDomainOnList(settings, "https://EXAMPLE.com/path")).resolves.toBe(true);
    await expect(isDomainOnList(settings, "exampleXcom")).resolves.toBe(false);
  });

  test("isDomainOnList ignores invalid entries and still matches valid hosts", async () => {
    const { settings } = createSettingsManager(["[", "localhost"]);

    await expect(isDomainOnList(settings, "localhost")).resolves.toBe(true);
  });

  test("addDomainToList stores normalized host and ignores invalid host input", async () => {
    const { settings, state, setMock } = createSettingsManager([]);

    await addDomainToList(settings, "https://Example.COM/path?a=1");
    expect(state[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["example.com"]);
    expect(setMock).toHaveBeenCalledTimes(1);

    await addDomainToList(settings, "[");
    expect(state[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["example.com"]);
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  test("addDomainToList handles host:port/path input by keeping host only", async () => {
    const { settings, state } = createSettingsManager([]);

    await addDomainToList(settings, "localhost:8080/path");
    expect(state[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["localhost"]);
  });

  test("removeDomainFromList removes only exact normalized host match", async () => {
    const { settings, state } = createSettingsManager([
      "example.com",
      "exampleXcom",
      "https://LOCALHOST:8080/path",
    ]);

    await removeDomainFromList(settings, "exampleXcom");
    expect(state[SETTINGS_DOMAIN_BLACKLIST]).toEqual([
      "example.com",
      "https://LOCALHOST:8080/path",
    ]);

    await removeDomainFromList(settings, "localhost");
    expect(state[SETTINGS_DOMAIN_BLACKLIST]).toEqual(["example.com"]);
  });

  test("removeDomainFromList matches entries stored as URL by host", async () => {
    const { settings, state, getMock } = createSettingsManager(["https://LOCALHOST/path"]);

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

  test("getDeepActiveElement returns null when nothing is focused", () => {
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
