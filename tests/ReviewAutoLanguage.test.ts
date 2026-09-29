import { ConfigAssembler } from "../src/adapters/chrome/background/config/ConfigAssembler";
import type { SettingsManager } from "../src/core/application/settingsManager";
import { resolveAutoLanguage } from "../src/core/domain/lang";

describe("resolveAutoLanguage", () => {
  test("maps the identified base code to an enabled language, else the fallback", () => {
    const enabled = ["en_US", "pl_PL"];
    expect(resolveAutoLanguage("en", enabled, "pl_PL")).toBe("en_US");
    expect(resolveAutoLanguage("pl", enabled, "en_US")).toBe("pl_PL");
    // Identified, but not enabled; unidentified; unsupported.
    expect(resolveAutoLanguage("de", enabled, "pl_PL")).toBe("pl_PL");
    expect(resolveAutoLanguage(null, enabled, "pl_PL")).toBe("pl_PL");
    expect(resolveAutoLanguage("ja", enabled, "en_US")).toBe("en_US");
  });
});

describe("set-config for auto-detect", () => {
  const context = async (seed: Record<string, unknown>) =>
    (
      await new ConfigAssembler(
        {
          get: async (key: string) => seed[key] as never,
          getRaw: async (key: string) => seed[key] as never,
          set: async () => undefined,
          setRaw: async () => undefined,
        } as unknown as SettingsManager,
        { isDevBuild: false },
      ).assembleBackgroundPageSetConfig()
    ).context;

  test("carries the enabled languages and a fallback that is one of them", async () => {
    const enabled = ["en_US", "pl_PL"];
    await expect(
      context({ language: "auto_detect", enabled_languages: enabled, fallbackLanguage: "pl_PL" }),
    ).resolves.toMatchObject({
      lang: "auto_detect",
      enabledLanguages: enabled,
      fallbackLanguage: "pl_PL",
    });
    // A fallback that is not enabled falls back to the first enabled language.
    await expect(
      context({ language: "auto_detect", enabled_languages: enabled, fallbackLanguage: "de_DE" }),
    ).resolves.toMatchObject({ fallbackLanguage: "en_US" });
  });
});
