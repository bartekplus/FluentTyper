import { ConfigAssembler } from "../src/adapters/chrome/background/config/ConfigAssembler";
import type { SettingsManager } from "../src/core/application/settingsManager";

function createSettingsManagerMock(seed: Record<string, unknown>): SettingsManager {
  return {
    get: async (key: string) => seed[key] as never,
    getRaw: async (key: string) => seed[key] as never,
    set: async () => undefined,
    setRaw: async () => undefined,
  } as unknown as SettingsManager;
}

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
  const assembler = new ConfigAssembler(createSettingsManagerMock(seed), { isDevBuild });
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
        await new ConfigAssembler(createSettingsManagerMock(seed), {
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
    const assembler = new ConfigAssembler(createSettingsManagerMock(seed), { isDevBuild: false });
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
    const assembler = new ConfigAssembler(createSettingsManagerMock(seed), { isDevBuild: false });
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
    const assembler = new ConfigAssembler(createSettingsManagerMock(seed), { isDevBuild: false });
    const context = (await assembler.assembleBackgroundPageSetConfig()).context;
    expect(context.liveGrammarProposals).toBe(expected);
  }
});
