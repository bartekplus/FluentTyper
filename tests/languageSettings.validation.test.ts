import "./setup";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { Store } from "../src/core/application/storage/Store.js";
import {
  KEY_AUTO_LANGUAGE_SITE_PRIORS,
  KEY_ENABLED_LANGUAGES,
  KEY_FALLBACK_LANGUAGE,
  KEY_LANGUAGE,
  KEY_SITE_PROFILES,
} from "../src/core/domain/constants";
import { validateLanguageSettings } from "../src/ui/options/settings.js";
import { acquireDomGlobalLock } from "./support/domGlobalLock";

type SettingsMap = Record<string, unknown>;
const baseChrome = (globalThis as unknown as { chrome: unknown }).chrome;
let releaseDomGlobalLock: (() => void) | null = null;

class MockControl {
  readonly calls: Array<{ value: unknown; silent: boolean }> = [];

  set(value: unknown, silent = false): this {
    this.calls.push({ value, silent });
    return this;
  }
}

function createStore(values: SettingsMap): Store {
  return {
    get(name: string) {
      return Promise.resolve(values[name]);
    },
    set(name: string, value: unknown) {
      values[name] = value;
      return Promise.resolve();
    },
  } as Store;
}

describe("validateLanguageSettings", () => {
  beforeEach(async () => {
    releaseDomGlobalLock = await acquireDomGlobalLock();
    (
      globalThis.chrome as typeof chrome & {
        runtime: typeof chrome.runtime & { sendMessage: ReturnType<typeof jest.fn> };
      }
    ).runtime.sendMessage = jest.fn();
  });

  afterEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = baseChrome;
    releaseDomGlobalLock?.();
    releaseDomGlobalLock = null;
  });

  test("sanitizes invalid primary/fallback languages and prunes site profiles that use removed languages", async () => {
    const values: SettingsMap = {
      [KEY_ENABLED_LANGUAGES]: ["de_DE"],
      [KEY_LANGUAGE]: "auto_detect",
      [KEY_FALLBACK_LANGUAGE]: "fr_FR",
      [KEY_SITE_PROFILES]: {
        "docs.example": { language: "fr_FR" },
        "wiki.example": { language: "de_DE" },
      },
    };
    const registry = {
      [KEY_ENABLED_LANGUAGES]: new MockControl(),
      [KEY_LANGUAGE]: new MockControl(),
      [KEY_FALLBACK_LANGUAGE]: new MockControl(),
    } as never;

    await validateLanguageSettings(registry, createStore(values));

    expect(values[KEY_LANGUAGE]).toBe("de_DE");
    expect(values[KEY_FALLBACK_LANGUAGE]).toBe("de_DE");
    expect(values[KEY_SITE_PROFILES]).toEqual({
      "wiki.example": { language: "de_DE" },
    });

    expect((registry[KEY_LANGUAGE] as unknown as MockControl).calls).toEqual([
      { value: "de_DE", silent: true },
    ]);
    expect((registry[KEY_FALLBACK_LANGUAGE] as unknown as MockControl).calls).toEqual([
      { value: "de_DE", silent: true },
    ]);
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("normalizes enabled language order and preserves auto-detect only when multiple languages remain", async () => {
    const values: SettingsMap = {
      [KEY_ENABLED_LANGUAGES]: ["pt_BR", "bogus", "en_US"],
      [KEY_LANGUAGE]: "auto_detect",
      [KEY_FALLBACK_LANGUAGE]: "pt_BR",
      [KEY_AUTO_LANGUAGE_SITE_PRIORS]: {
        "example.com": {
          pt_BR: 0.8,
          de_DE: 0.5,
        },
      },
      [KEY_SITE_PROFILES]: {},
    };
    const registry = {
      [KEY_ENABLED_LANGUAGES]: new MockControl(),
      [KEY_LANGUAGE]: new MockControl(),
      [KEY_FALLBACK_LANGUAGE]: new MockControl(),
    } as never;

    await validateLanguageSettings(registry, createStore(values));

    expect(values[KEY_ENABLED_LANGUAGES]).toEqual(["en_US", "pt_BR"]);
    expect(values[KEY_LANGUAGE]).toBe("auto_detect");
    expect(values[KEY_FALLBACK_LANGUAGE]).toBe("pt_BR");
    expect(values[KEY_AUTO_LANGUAGE_SITE_PRIORS]).toEqual({
      "example.com": {
        pt_BR: 0.8,
      },
    });
    expect((registry[KEY_ENABLED_LANGUAGES] as unknown as MockControl).calls).toEqual([
      { value: ["en_US", "pt_BR"], silent: true },
    ]);
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });
});
