import { CoreSettingsRepository } from "../src/core/application/repositories/CoreSettingsRepository";
import type { SettingsManager } from "../src/core/application/settingsManager";

function createSettingsManagerMock(seed: Record<string, unknown>): SettingsManager {
  return {
    get: async (key: string) => seed[key] as never,
    set: async () => undefined,
  } as unknown as SettingsManager;
}

describe("CoreSettingsRepository", () => {
  test("defaults enabled to true when the setting is absent", async () => {
    const repository = new CoreSettingsRepository(createSettingsManagerMock({}));

    await expect(repository.isEnabled()).resolves.toBe(true);
  });

  test("defaults preferNativeAutocomplete to true when the setting is absent", async () => {
    const repository = new CoreSettingsRepository(createSettingsManagerMock({}));

    await expect(repository.getPreferNativeAutocomplete()).resolves.toBe(true);
  });

  test("defaults autocompleteOnEnter and autocompleteOnTab to true when absent", async () => {
    const repository = new CoreSettingsRepository(createSettingsManagerMock({}));

    await expect(repository.getAutocompleteOnEnter()).resolves.toBe(true);
    await expect(repository.getAutocompleteOnTab()).resolves.toBe(true);
  });

  test("keeps legacy [shortcut, string] entries for runtime compatibility", async () => {
    const repository = new CoreSettingsRepository(
      createSettingsManagerMock({
        textExpansions: [
          ["asap", "as soon as possible"],
          ["brb", "be right back"],
        ],
      }),
    );

    await expect(repository.getTextExpansions()).resolves.toEqual([
      ["asap", "as soon as possible"],
      ["brb", "be right back"],
    ]);
  });

  test("defaults prefixOnlyMode to false when the setting is absent", async () => {
    const repository = new CoreSettingsRepository(createSettingsManagerMock({}));
    await expect(repository.getPrefixOnlyMode()).resolves.toBe(false);
  });

  test("keeps object entries and filters invalid rows", async () => {
    const repository = new CoreSettingsRepository(
      createSettingsManagerMock({
        textExpansions: [
          ["idk", { phrase: "I don't know" }],
          ["ttyl", { phrase: "talk to you later", priority: 1 }],
          ["x", ["not", "valid"]],
          [123, { phrase: "bad key type" }],
          ["missing"],
        ],
      }),
    );

    await expect(repository.getTextExpansions()).resolves.toEqual([
      ["idk", { phrase: "I don't know" }],
      ["ttyl", { phrase: "talk to you later", priority: 1 }],
    ]);
  });
});
