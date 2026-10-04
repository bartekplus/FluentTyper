import { jest } from "bun:test";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";
import { PredictionOrchestrator } from "../src/adapters/chrome/background/PredictionOrchestrator";
import { mod } from "./fakeLibPresage.js";
import { predictionConfig, runPrediction } from "./support/predictionConfig";

describe("PredictionOrchestrator Presage path", () => {
  afterEach(() => {
    mod.PresageCallback.predictions = [];
    jest.restoreAllMocks();
  });

  test("returns Presage predictions", async () => {
    mod.PresageCallback.predictions = ["alpha", "beta"];
    const presageHandler = new PresageHandler(mod);
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(predictionConfig({ numSuggestions: 6 }));

    const result = await orchestrator.runPrediction("a", "", "en_US");

    expect(result.predictions).toEqual(["alpha", "beta"]);
  });

  test("re-expands random variables on every call", async () => {
    mod.PresageCallback.predictions = ["${random:alpha|beta}"];
    const predictWithProbability = jest.spyOn(mod.Presage.prototype, "predictWithProbability");
    const presageHandler = new PresageHandler(mod);
    presageHandler.setConfig(predictionConfig({ numSuggestions: 6 }));

    const randomSpy = jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.99);

    const firstResult = await runPrediction(presageHandler, "rsales", "", "en_US");
    const secondResult = await runPrediction(presageHandler, "rsales", "", "en_US");

    expect(firstResult.predictions).toEqual(["alpha"]);
    expect(secondResult.predictions).toEqual(["beta"]);
    expect(predictWithProbability).toHaveBeenCalledTimes(2);
    expect(randomSpy).toHaveBeenCalledTimes(2);
  });
});
