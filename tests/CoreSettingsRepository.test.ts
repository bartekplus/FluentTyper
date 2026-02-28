import { CoreSettingsRepository } from "../src/core/application/repositories/CoreSettingsRepository";
import type { SettingsManager } from "../src/core/application/settingsManager";

function createSettingsManagerMock(seed: Record<string, unknown>): SettingsManager {
  return {
    get: async (key: string) => seed[key] as never,
    set: async () => undefined,
  } as unknown as SettingsManager;
}

describe("CoreSettingsRepository.getTextExpansions", () => {
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
