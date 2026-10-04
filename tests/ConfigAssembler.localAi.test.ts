import { ConfigAssembler } from "../src/adapters/chrome/background/config/ConfigAssembler";
import { memorySettings } from "./support/fakeSettings";

const STALE_LEGACY_PREDICTOR = {
  aiPredictorEnabled: true,
  aiModelId: "Qwen3-1.7B-q4f16_1-MLC",
  debugAiPredictorEnabled: true,
  debugPresagePredictorEnabled: true,
};

const LOCAL_AI_REVIEW_SET_UP = {
  localAiReviewEnabled: true,
  localAiReviewTier: "standard",
  localAiReviewConsent: { modelId: "Qwen3-1.7B-q4f16_1-MLC", tier: "standard", at: 1 },
};

async function predictionConfig(seed: Record<string, unknown>, isDevBuild: boolean) {
  const assembler = new ConfigAssembler(memorySettings(seed), { isDevBuild });
  return (await assembler.assemblePredictionRuntimeConfig()).predictionConfig;
}

describe("ConfigAssembler prediction config", () => {
  test("stale legacy AI predictor settings never reach prediction config", async () => {
    for (const isDevBuild of [false, true]) {
      const config = await predictionConfig(
        { ...STALE_LEGACY_PREDICTOR, ...LOCAL_AI_REVIEW_SET_UP },
        isDevBuild,
      );
      expect(JSON.stringify(config)).not.toMatch(/aiPredictor|aiModelId|localAiReview/i);
    }
  });

  test("set-config carries the Local AI Review preference (absent means on)", async () => {
    const context = async (seed: Record<string, unknown>) =>
      (
        await new ConfigAssembler(memorySettings(seed), {
          isDevBuild: false,
        }).assembleBackgroundPageSetConfig()
      ).context;

    await expect(context({})).resolves.toMatchObject({ localAiReviewEnabled: true });
    await expect(context({ localAiReviewEnabled: false })).resolves.toMatchObject({
      localAiReviewEnabled: false,
    });
  });
});

test("preferred terminology reaches Review config only after validation and never the predictor", async () => {
  const valid = {
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
  for (const raw of [valid, undefined, { version: 1, enabled: true, entries: "invalid" }]) {
    const seed = { preferredTerminology: raw };
    const assembler = new ConfigAssembler(memorySettings(seed), { isDevBuild: false });
    const context = (await assembler.assembleBackgroundPageSetConfig()).context;
    expect(context.preferredTerminology).toEqual(
      raw === valid ? valid : { version: 1, enabled: false, entries: [] },
    );
    expect(JSON.stringify(await predictionConfig(seed, false))).not.toContain(
      "preferredTerminology",
    );
    expect(JSON.stringify(await predictionConfig(seed, false))).not.toContain("Acme");
  }
});

test("readability threshold defaults and validation stay outside prediction config and opt-in choices", async () => {
  for (const raw of [undefined, null, "40", 9, 201, 10.5, 10, 35, 200]) {
    const seed = { reviewLongSentenceWords: raw };
    const assembler = new ConfigAssembler(memorySettings(seed), { isDevBuild: false });
    const context = (await assembler.assembleBackgroundPageSetConfig()).context;
    expect(context.reviewLongSentenceWords).toBe(
      typeof raw === "number" && Number.isInteger(raw) && raw >= 10 && raw <= 200 ? raw : 35,
    );
    expect(context.reviewRuleOverrides).toEqual({});
    expect(JSON.stringify(await predictionConfig(seed, false))).not.toContain(
      "reviewLongSentenceWords",
    );
  }
});

test("typing-time grammar proposals reach the page config, on unless turned off", async () => {
  for (const [seed, expected] of [
    [{}, true],
    [{ liveGrammarProposals: false }, false],
  ] as const) {
    const assembler = new ConfigAssembler(memorySettings(seed), { isDevBuild: false });
    const context = (await assembler.assembleBackgroundPageSetConfig()).context;
    expect(context.liveGrammarProposals).toBe(expected);
  }
});

describe("ConfigAssembler.assemblePredictionRuntimeConfig prefixOnlyMode", () => {
  const baseSettings: Record<string, unknown> = {
    language: "en_US",
    enabled_languages: ["en_US"],
    numSuggestions: 5,
    minWordLengthToPredict: 1,
    insertSpaceAfterAutocomplete: true,
    enabledGrammarRules: [],
    textExpansions: [],
    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
    debugPresagePredictorEnabled: true,
    personalizationEnabled: false,
  };

  test.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
  ])(
    "prefixOnlyMode=%p, inlineSuggestion=%p gives %p",
    async (prefixOnlyMode, inline, expected) => {
      const config = await predictionConfig(
        { ...baseSettings, prefixOnlyMode, inline_suggestion: inline },
        false,
      );
      expect(config.prefixOnlyMode).toBe(expected);
    },
  );

  test("passes opt-in personalization state to prediction config", async () => {
    const config = await predictionConfig(
      {
        ...baseSettings,
        prefixOnlyMode: false,
        inline_suggestion: false,
        personalizationEnabled: true,
      },
      false,
    );
    expect(config.personalizationEnabled).toBe(true);
  });
});

describe("set-config for auto-detect", () => {
  const context = async (seed: Record<string, unknown>) =>
    (
      await new ConfigAssembler(memorySettings(seed), {
        isDevBuild: false,
      }).assembleBackgroundPageSetConfig()
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
