import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  KEY_AUTO_LANGUAGE_SITE_PRIORS,
  KEY_ENABLED_LANGUAGES,
  KEY_FALLBACK_LANGUAGE,
  KEY_LANGUAGE,
  KEY_SITE_PROFILES,
} from "../src/core/domain/constants";
import { validateLanguageSettings } from "../src/ui/options/settings.js";
import { memorySettings } from "./support/fakeSettings";
import { fakeRegistry } from "./support/settingsFakes";

const baseChrome: unknown = { runtime: {} };

describe("validateLanguageSettings", () => {
  beforeEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = baseChrome;
    (
      globalThis.chrome as typeof chrome & {
        runtime: typeof chrome.runtime & { sendMessage: ReturnType<typeof jest.fn> };
      }
    ).runtime.sendMessage = jest.fn();
  });

  afterEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = baseChrome;
  });

  test("sanitizes invalid primary/fallback languages and prunes site profiles that use removed languages", async () => {
    const store = memorySettings({
      [KEY_ENABLED_LANGUAGES]: ["de_DE"],
      [KEY_LANGUAGE]: "auto_detect",
      [KEY_FALLBACK_LANGUAGE]: "fr_FR",
      [KEY_SITE_PROFILES]: {
        "docs.example": { language: "fr_FR" },
        "wiki.example": { language: "de_DE" },
      },
    });
    const values = store.store;
    const registry = fakeRegistry({ ...values });

    await validateLanguageSettings(registry, store as never);

    expect(values[KEY_LANGUAGE]).toBe("de_DE");
    expect(values[KEY_FALLBACK_LANGUAGE]).toBe("de_DE");
    expect(values[KEY_SITE_PROFILES]).toEqual({
      "wiki.example": { language: "de_DE" },
    });

    expect(registry[KEY_LANGUAGE].calls).toEqual([{ value: "de_DE", silent: true }]);
    expect(registry[KEY_FALLBACK_LANGUAGE].calls).toEqual([{ value: "de_DE", silent: true }]);
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("normalizes enabled language order and preserves auto-detect only when multiple languages remain", async () => {
    const store = memorySettings({
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
    });
    const values = store.store;
    const registry = fakeRegistry({ ...values });

    await validateLanguageSettings(registry, store as never);

    expect(values[KEY_ENABLED_LANGUAGES]).toEqual(["en_US", "pt_BR"]);
    expect(values[KEY_LANGUAGE]).toBe("auto_detect");
    expect(values[KEY_FALLBACK_LANGUAGE]).toBe("pt_BR");
    expect(values[KEY_AUTO_LANGUAGE_SITE_PRIORS]).toEqual({
      "example.com": {
        pt_BR: 0.8,
      },
    });
    expect(registry[KEY_ENABLED_LANGUAGES].calls).toEqual([
      { value: ["en_US", "pt_BR"], silent: true },
    ]);
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });
});
