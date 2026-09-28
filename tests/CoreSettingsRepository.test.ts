import { CoreSettingsRepository } from "../src/core/application/repositories/CoreSettingsRepository";
import { LocalAiSettingsRepository } from "../src/core/application/repositories/LocalAiSettingsRepository";
import type { SettingsManager } from "../src/core/application/settingsManager";

function createSettingsManagerMock(seed: Record<string, unknown>): SettingsManager {
  return {
    get: async (key: string) => seed[key] as never,
    getRaw: async (key: string) => seed[key] as never,
    set: async () => undefined,
    setRaw: async () => undefined,
  } as unknown as SettingsManager;
}

describe("CoreSettingsRepository", () => {
  test("user dictionary adds accept one word only and never lose a concurrent add", async () => {
    const store: Record<string, unknown> = {};
    const slow = () => new Promise((resolve) => setTimeout(resolve, 5));
    const manager = {
      get: async (key: string) => {
        await slow();
        return store[key] as never;
      },
      getRaw: async (key: string) => store[key] as never,
      set: async (key: string, value: unknown) => {
        await slow();
        store[key] = value;
      },
      setRaw: async () => undefined,
    } as unknown as SettingsManager;
    const repository = new CoreSettingsRepository(manager);

    for (const bad of ["", "two words", "<img>", "a,b", "x".repeat(65), "-dash", "o'"]) {
      await expect(repository.addUserDictionaryWord(bad)).resolves.toBe(false);
    }
    const added = await Promise.all([
      repository.addUserDictionaryWord("teh"),
      repository.addUserDictionaryWord("Zoë"),
      repository.addUserDictionaryWord("rock'n'roll"),
      repository.addUserDictionaryWord("TEH"),
    ]);
    expect(added).toEqual([true, true, true, true]);
    await expect(repository.getUserDictionaryList()).resolves.toEqual([
      "teh",
      "Zoë",
      "rock'n'roll",
    ]);
  });

  test("defaults enabled to true when the setting is absent", async () => {
    const repository = new CoreSettingsRepository(createSettingsManagerMock({}));

    await expect(repository.isEnabled()).resolves.toBe(true);
  });

  test("defaults preferNativeAutocomplete to true when the setting is absent", async () => {
    const repository = new CoreSettingsRepository(createSettingsManagerMock({}));

    await expect(repository.getPreferNativeAutocomplete()).resolves.toBe(true);
  });

  test("shows the in-field Review button unless it is turned off", async () => {
    await expect(
      new CoreSettingsRepository(createSettingsManagerMock({})).getShowReviewButton(),
    ).resolves.toBe(true);
    await expect(
      new CoreSettingsRepository(
        createSettingsManagerMock({ showReviewButton: false }),
      ).getShowReviewButton(),
    ).resolves.toBe(false);
  });

  test("defaults codeMode to false when the setting is absent", async () => {
    const repository = new CoreSettingsRepository(createSettingsManagerMock({}));

    await expect(repository.getCodeMode()).resolves.toBe(false);
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

  test("keeps personalization opt-in", async () => {
    const defaults = new CoreSettingsRepository(createSettingsManagerMock({}));
    const enabled = new CoreSettingsRepository(
      createSettingsManagerMock({ personalizationEnabled: true }),
    );

    await expect(defaults.getPersonalizationEnabled()).resolves.toBe(false);
    await expect(enabled.getPersonalizationEnabled()).resolves.toBe(true);
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

describe("LocalAiSettingsRepository", () => {
  const repository = (seed: Record<string, unknown>) =>
    new LocalAiSettingsRepository(createSettingsManagerMock(seed));
  const consent = {
    modelId: "gemma-4-E4B-it-onnx-q4f16@843f250f",
    tier: "standard",
    at: 1_700_000_000_000,
  };

  test("the preference defaults on; upgrade: an existing explicit false is preserved", async () => {
    await expect(repository({}).getLocalAiReviewEnabled()).resolves.toBe(true);
    await expect(
      repository({ localAiReviewEnabled: false }).getLocalAiReviewEnabled(),
    ).resolves.toBe(false);
    await expect(
      repository({ localAiReviewEnabled: "no" }).getLocalAiReviewEnabled(),
    ).resolves.toBe(true);
  });

  test("tier defaults to standard and rejects unknown values", async () => {
    await expect(repository({}).getLocalAiReviewTier()).resolves.toBe("standard");
    await expect(repository({ localAiReviewTier: "compact" }).getLocalAiReviewTier()).resolves.toBe(
      "compact",
    );
    await expect(repository({ localAiReviewTier: "huge" }).getLocalAiReviewTier()).resolves.toBe(
      "standard",
    );
  });

  test("consent is a validated registry record or null", async () => {
    await expect(repository({}).getLocalAiReviewConsent()).resolves.toBeNull();
    await expect(
      repository({ localAiReviewConsent: consent }).getLocalAiReviewConsent(),
    ).resolves.toEqual(consent);
    for (const invalid of [
      null,
      true,
      "yes",
      [consent],
      { ...consent, modelId: "Unknown-MLC" },
      { ...consent, tier: "compact" },
      { ...consent, at: "now" },
      { modelId: consent.modelId, tier: consent.tier },
    ]) {
      await expect(
        repository({ localAiReviewConsent: invalid }).getLocalAiReviewConsent(),
      ).resolves.toBeNull();
    }
  });

  test("setters write only their own keys; null revokes consent", async () => {
    const store: Record<string, unknown> = {};
    const manager = {
      getRaw: async (key: string) => store[key] as never,
      set: async (key: string, value: unknown) => {
        store[key] = value;
      },
    } as unknown as SettingsManager;
    const writer = new LocalAiSettingsRepository(manager);

    await writer.setLocalAiReviewConsent(consent as never);
    await writer.setLocalAiSetupOfferDismissed(true);
    expect(store).toEqual({ localAiReviewConsent: consent, localAiSetupOfferDismissed: true });
    await expect(writer.getLocalAiSetupOfferDismissed()).resolves.toBe(true);

    await writer.setLocalAiReviewConsent(null);
    await expect(writer.getLocalAiReviewConsent()).resolves.toBeNull();
  });
});
