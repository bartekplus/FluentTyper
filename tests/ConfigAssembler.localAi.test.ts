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

describe("ConfigAssembler AI autocomplete separation", () => {
  test("production never enables AI autocomplete, even with stale legacy settings", async () => {
    const config = await predictionConfig(
      { ...STALE_LEGACY_PREDICTOR, ...LOCAL_AI_REVIEW_SET_UP },
      false,
    );
    expect(config.aiPredictorEnabled).toBe(false);
  });

  test("development keeps AI autocomplete off unless its switch is explicitly on", async () => {
    await expect(predictionConfig({}, true)).resolves.toMatchObject({
      aiPredictorEnabled: false,
    });
    await expect(
      predictionConfig({ ...STALE_LEGACY_PREDICTOR, aiPredictorEnabled: false }, true),
    ).resolves.toMatchObject({ aiPredictorEnabled: false });
    await expect(predictionConfig(STALE_LEGACY_PREDICTOR, true)).resolves.toMatchObject({
      aiPredictorEnabled: true,
    });
  });

  test("Local AI Review setup never feeds prediction routing", async () => {
    const config = await predictionConfig(LOCAL_AI_REVIEW_SET_UP, true);
    expect(config.aiPredictorEnabled).toBe(false);
    expect(JSON.stringify(config)).not.toContain("localAiReview");
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
