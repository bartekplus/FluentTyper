import { mod } from "./fakeLibPresage.js";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";
import type { PredictionConfig } from "../src/adapters/chrome/background/PredictionOrchestrator";
import { predictionConfig } from "./support/predictionConfig";

function createConfig(overrides: Partial<PredictionConfig> = {}) {
  return predictionConfig({ numSuggestions: 2, personalizationEnabled: false, ...overrides });
}

describe("PresageHandler personalized candidate pool", () => {
  test("disabled mode preserves the baseline ordered result exactly", async () => {
    mod.PresageCallback.predictions = ["alpha", "beta", "gamma"];
    const handler = new PresageHandler(mod, {
      getPersonalizationSnapshot: () => ({
        en_US: {
          gamma: { display: "gamma", score: 10, updatedAtMs: 1_000 },
        },
      }),
      now: () => 1_000,
    });
    handler.setConfig(createConfig({ personalizationEnabled: false }));

    await expect(handler.runPrediction("a", "", "en_US")).resolves.toEqual({
      predictions: ["alpha", "beta"],
    });
  });

  test("promotes a learned candidate from below the visible cutoff", async () => {
    mod.PresageCallback.predictions = ["alpha", "beta", "gamma", "garden"];
    const snapshotProvider = jest.fn(() => ({
      en_US: {
        gamma: { display: "gamma", score: 3, updatedAtMs: 1_000 },
      },
    }));
    const handler = new PresageHandler(mod, {
      getPersonalizationSnapshot: snapshotProvider,
      now: () => 1_000,
    });
    handler.setConfig(createConfig({ personalizationEnabled: true }));

    await expect(handler.runPrediction("a", "", "en_US")).resolves.toEqual({
      predictions: ["gamma", "alpha"],
    });
    expect(snapshotProvider).toHaveBeenCalledTimes(1);
  });

  // The exact match is the current word only: inside a sentence it goes first, after a space
  // nothing is pinned.
  test.each([
    [true, "alpha", ["gamma", "beta", "alpha"], ["alpha", "gamma"]],
    [true, "the alpha", ["gamma", "beta", "alpha"], ["alpha", "gamma"]],
    [false, "the act", ["action", "act", "actor"], ["act", "action"]],
    [false, "act ", ["now", "act", "the"], ["now", "act"]],
  ])(
    "keeps exact matches pinned ahead of learned candidates (personalized %p, %p)",
    async (personalizationEnabled, input, predictions, expected) => {
      mod.PresageCallback.predictions = predictions;
      const handler = new PresageHandler(mod, {
        getPersonalizationSnapshot: () => ({
          en_US: {
            gamma: { display: "gamma", score: 5, updatedAtMs: 1_000 },
          },
        }),
        now: () => 1_000,
      });
      handler.setConfig(createConfig({ personalizationEnabled }));

      await expect(handler.runPrediction(input, "", "en_US")).resolves.toEqual({
        predictions: expected,
      });
    },
  );

  test("leaves configured text expansion ordering untouched", async () => {
    mod.PresageCallback.predictions = ["expansion output", "gamma", "alpha"];
    const snapshotProvider = jest.fn(() => ({
      en_US: {
        gamma: { display: "gamma", score: 5, updatedAtMs: 1_000 },
      },
    }));
    const handler = new PresageHandler(mod, {
      getPersonalizationSnapshot: snapshotProvider,
      now: () => 1_000,
    });
    handler.setConfig(
      createConfig({
        personalizationEnabled: true,
        textExpansions: [["asap", "expansion output" as unknown as object]],
      }),
    );

    await expect(handler.runPrediction("asap", "", "en_US")).resolves.toEqual({
      predictions: ["expansion output", "gamma"],
    });
    expect(snapshotProvider).not.toHaveBeenCalled();
  });

  test("keeps capitalization and spacing transformations after ranking", async () => {
    mod.PresageCallback.predictions = ["alpha", "gamma"];
    const handler = new PresageHandler(mod, {
      getPersonalizationSnapshot: () => ({
        en_US: {
          gamma: { display: "gamma", score: 5, updatedAtMs: 1_000 },
        },
      }),
      now: () => 1_000,
    });
    handler.setConfig(
      createConfig({
        personalizationEnabled: true,
        insertSpaceAfterAutocomplete: true,
        autoCapitalize: true,
      }),
    );

    await expect(handler.runPrediction("A", "", "en_US")).resolves.toEqual({
      predictions: ["Gamma ", "Alpha "],
    });
  });
});
