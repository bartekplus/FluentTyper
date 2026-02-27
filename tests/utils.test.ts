import { jest } from "@jest/globals";
import {
  SETTINGS_DOMAIN_BLACKLIST,
  addDomainToList,
  isInDocument,
  isDomainOnList,
  removeDomainFromList,
} from "../src/core/application/utils";
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

    await expect(
      isDomainOnList(settings, "https://EXAMPLE.com/path"),
    ).resolves.toBe(true);
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
    const { settings, state, getMock } = createSettingsManager([
      "https://LOCALHOST/path",
    ]);

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
});
