import { mod } from "./fakeLibPresage.js";
import { PredictionManager } from "../src/adapters/chrome/background/PredictionManager";
import type { PredictionConfig } from "../src/adapters/chrome/background/PredictionOrchestrator";
import type { PresageModule } from "../src/adapters/chrome/background/PresageTypes";

const SENTINEL = "sentinel-7f3a private words";

const CONFIG: PredictionConfig = {
  numSuggestions: 5,
  minWordLengthToPredict: 0,
  insertSpaceAfterAutocomplete: false,
  autoCapitalize: false,
  textExpansions: [],
  prefixOnlyMode: false,
  timeFormat: "",
  dateFormat: "",
  userDictionaryList: [],
  debugPresagePredictorEnabled: true,
};

async function runPrediction(isDevBuild: boolean) {
  const manager = new PredictionManager({
    isDevBuild,
    loadPresage: async () => mod as unknown as PresageModule,
  });
  await manager.initialize();
  manager.setConfig(CONFIG);
  await manager.runPrediction(`${SENTINEL} th`, "", "en_US", undefined, { traceId: "t1" });
  return manager;
}

describe("PredictionManager debug traces", () => {
  test("production debug snapshot carries no typed text", async () => {
    const snapshot = (await runPrediction(false)).getPredictorDebugSnapshot();
    expect(snapshot.traces).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain("sentinel-7f3a");
  });

  test("development traces keep text for the predictor debug dashboard", async () => {
    const snapshot = (await runPrediction(true)).getPredictorDebugSnapshot();
    expect(JSON.stringify(snapshot.traces)).toContain("sentinel-7f3a");
  });
});
