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

describe("PredictionManager resource recovery", () => {
  test("concurrent dictionary requests share a load and reuse the loaded module", async () => {
    let complete: (value: PresageModule) => void = () => {};
    let loads = 0;
    const manager = new PredictionManager({
      loadPresage: () => {
        loads++;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    });
    const words = [{ word: "the", before: "" }];
    const first = manager.lookupSpelling("en_US", words);
    const second = manager.lookupSpelling("pl_PL", words);
    expect(loads).toBe(1);
    complete(mod as unknown as PresageModule);
    await Promise.all([first, second]);
    await manager.lookupSpelling("en_US", words);
    expect(loads).toBe(1);
  });

  test("failed resources remain failed until an explicit dictionary request retries", async () => {
    let loads = 0;
    const manager = new PredictionManager({
      loadPresage: async () => {
        loads++;
        if (loads === 1) throw new Error("corrupt local resource");
        return mod as unknown as PresageModule;
      },
    });
    await expect(manager.initialize()).rejects.toThrow("Failed to initialize");
    await expect(manager.initialize()).rejects.toThrow("Failed to initialize");
    expect(loads).toBe(1);
    await expect(
      manager.lookupSpelling("en_US", [{ word: "the", before: "" }]),
    ).resolves.toHaveLength(1);
    expect(loads).toBe(2);
  });
});
