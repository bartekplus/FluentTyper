import { afterEach, mock, spyOn } from "bun:test";
import { mod } from "./fakeLibPresage.js";
import * as disabledRuntime from "../src/adapters/chrome/background/webllm-disabled-runtime";
import type { PredictionConfig } from "../src/adapters/chrome/background/PredictionOrchestrator";
import type { PresageModule } from "../src/adapters/chrome/background/PresageTypes";

// The WebLLM runtime is the build's disabled stub; Presage is the fake engine.
void mock.module("@mlc-ai/web-llm", () => disabledRuntime);

const { PredictionManager } = await import("../src/adapters/chrome/background/PredictionManager");
const { WebLLMPredictor } = await import("../src/adapters/chrome/background/WebLLMPredictor");

const SENTINEL = "sentinel-7f3a private words";

/** Every legacy AI switch on, as an old dev profile might have stored it. */
const STALE_AI_CONFIG: PredictionConfig = {
  numSuggestions: 5,
  minWordLengthToPredict: 0,
  insertSpaceAfterAutocomplete: false,
  autoCapitalize: false,
  textExpansions: [],
  prefixOnlyMode: false,
  timeFormat: "",
  dateFormat: "",
  userDictionaryList: [],
  aiPredictorEnabled: true,
  aiModelId: "Qwen3-1.7B-q4f16_1-MLC",
  debugAIPredictorEnabled: true,
  debugPresagePredictorEnabled: true,
};

async function runWithStaleAiSettings(isDevBuild: boolean) {
  const predict = spyOn(WebLLMPredictor.prototype, "predict").mockResolvedValue([]);
  const preload = spyOn(WebLLMPredictor.prototype, "preload").mockResolvedValue(undefined);
  const manager = new PredictionManager({
    isDevBuild,
    loadPresage: async () => mod as unknown as PresageModule,
  });
  await manager.initialize();
  manager.setConfig(STALE_AI_CONFIG);
  await manager.runPrediction(`${SENTINEL} th`, "", "en_US", undefined, { traceId: "t1" });
  return { manager, predict, preload };
}

describe("AI autocomplete separation (PredictionManager routing)", () => {
  afterEach(() => {
    mock.restore();
  });

  test("production never calls the AI predictor, whatever is stored", async () => {
    const { predict, preload } = await runWithStaleAiSettings(false);
    expect(predict).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();
  });

  test("production debug snapshot carries no typed text", async () => {
    const { manager } = await runWithStaleAiSettings(false);
    const snapshot = manager.getPredictorDebugSnapshot();
    expect(snapshot.traces).toEqual([]);
    expect(snapshot.runtime.webllm.lastPredictInput).toBeNull();
    expect(snapshot.runtime.webllm.lastRawOutputPreview).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("sentinel-7f3a");
  });

  test("development routes to the AI predictor only when its switch is on", async () => {
    const { manager, predict, preload } = await runWithStaleAiSettings(true);
    expect(preload).toHaveBeenCalled();
    expect(predict).toHaveBeenCalled();
    // Dev traces keep text for the predictor debug dashboard.
    expect(JSON.stringify(manager.getPredictorDebugSnapshot().traces)).toContain("sentinel-7f3a");

    predict.mockClear();
    manager.setConfig({ ...STALE_AI_CONFIG, aiPredictorEnabled: false });
    await manager.runPrediction("th", "", "en_US");
    expect(predict).not.toHaveBeenCalled();
  });
});
