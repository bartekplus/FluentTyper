import { CoreSettingsRepository } from "../src/core/application/repositories/CoreSettingsRepository";
import { LocalAiSettingsRepository } from "../src/core/application/repositories/LocalAiSettingsRepository";
import type { PreferredTerminology } from "../src/core/domain/grammar/review/preferredTerminology";
import { memorySettings } from "./support/fakeSettings";

describe("CoreSettingsRepository", () => {
  test("user dictionary adds accept one word only and never lose a concurrent add", async () => {
    const slow = () => new Promise((resolve) => setTimeout(resolve, 5));
    const repository = new CoreSettingsRepository(memorySettings({}, { delay: slow }));

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

  test.each([
    ["isEnabled", {}, true],
    ["getPreferNativeAutocomplete", {}, true],
    ["getShowReviewButton", {}, true],
    ["getShowReviewButton", { showReviewButton: false }, false],
    ["getLiveGrammarProposals", {}, true],
    ["getLiveGrammarProposals", { liveGrammarProposals: false }, false],
    ["getCodeMode", {}, false],
    ["getAutocompleteOnEnter", {}, true],
    ["getAutocompleteOnTab", {}, true],
    ["getPrefixOnlyMode", {}, false],
    ["getPersonalizationEnabled", {}, false],
    ["getPersonalizationEnabled", { personalizationEnabled: true }, true],
    ["getNumSuggestions", {}, 5],
    ["getNumSuggestions", { numSuggestions: 3.4 }, 3],
    ["getNumSuggestions", { numSuggestions: 25 }, 10],
  ] as const)("%s with %o resolves to %p", async (getter, seed, expected) => {
    await expect(new CoreSettingsRepository(memorySettings(seed))[getter]()).resolves.toBe(
      expected,
    );
  });

  test("keeps legacy [shortcut, string] entries for runtime compatibility", async () => {
    const repository = new CoreSettingsRepository(
      memorySettings({
        textExpansions: [
          ["asap", "as soon as possible"],
          ["brb", "be right back"],
        ],
      }),
    );

    // The declared type says object, but legacy string bodies pass through at runtime.
    await expect<Promise<unknown>>(repository.getTextExpansions()).resolves.toEqual([
      ["asap", "as soon as possible"],
      ["brb", "be right back"],
    ]);
  });

  test("keeps object entries and filters invalid rows", async () => {
    const repository = new CoreSettingsRepository(
      memorySettings({
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
    new LocalAiSettingsRepository(memorySettings(seed));
  const consent = {
    modelId: "gemma-4-E4B-it-onnx-q4f16@843f250f",
    tier: "standard" as const,
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
    const settings = memorySettings();
    const writer = new LocalAiSettingsRepository(settings);

    await writer.setLocalAiReviewConsent(consent as never);
    await writer.setLocalAiSetupOfferDismissed(true);
    expect(settings.store).toEqual({
      localAiReviewConsent: consent,
      localAiSetupOfferDismissed: true,
    });
    await expect(writer.getLocalAiSetupOfferDismissed()).resolves.toBe(true);

    await writer.setLocalAiReviewConsent(null);
    await expect(writer.getLocalAiReviewConsent()).resolves.toBeNull();
  });
});

test("Review rule preferences serialize concurrent card choices without storing text or changing typing", async () => {
  const settings = memorySettings(
    { enabledGrammarRules: { commaPeriodSpacing: false } },
    { delay: () => Promise.resolve() },
  );
  const repository = new CoreSettingsRepository(settings);
  expect(await repository.getReviewRuleOverrides()).toEqual({});
  for (const id of [
    "reviewLocalAi",
    "reviewSpelling",
    "autoBracketClose",
    "I opened the the report.",
    "__proto__",
  ])
    expect(await repository.disableReviewRule(id)).toBe(false);
  expect(
    await Promise.all([
      repository.disableReviewRule("englishRepeatedWords"),
      repository.disableReviewRule("englishThenThan"),
    ]),
  ).toEqual([true, true]);
  expect(settings.store).toEqual({
    enabledGrammarRules: { commaPeriodSpacing: false },
    reviewRuleOverrides: { englishRepeatedWords: false, englishThenThan: false },
  });
});

test("preferred terminology reads validated settings without changing other preferences", async () => {
  const settings = memorySettings({
    userDictionaryList: ["custom"],
    textExpansions: [["sig", "My name"]],
  });
  const { store } = settings;
  const repository = new CoreSettingsRepository(settings);
  const empty: PreferredTerminology = { version: 1, enabled: false, entries: [] };
  expect(await repository.getPreferredTerminology()).toEqual(empty);
  store.preferredTerminology = { enabled: true, entries: [{ source: "broken" }] };
  expect(await repository.getPreferredTerminology()).toEqual(empty);
  const valid: PreferredTerminology = {
    version: 1,
    enabled: true,
    entries: [
      {
        id: "acme",
        source: "Acme Suite",
        replacement: "Acme Workspace",
        casePolicy: "exact",
        explanation: "Our preferred name.",
        language: "en_US",
        scope: "all-prose",
        enabled: true,
      },
    ],
  };
  store.preferredTerminology = valid;
  expect(await repository.getPreferredTerminology()).toEqual(valid);
  expect(store.userDictionaryList).toEqual(["custom"]);
  expect(store.textExpansions).toEqual([["sig", "My name"]]);
  store.preferredTerminology = empty;
  expect(await repository.getPreferredTerminology()).toEqual(empty);
});
