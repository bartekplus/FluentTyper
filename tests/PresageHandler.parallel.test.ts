import { jest } from "bun:test";
import type { PresageModule } from "../src/adapters/chrome/background/PresageTypes";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";
import type { PredictionConfig } from "../src/adapters/chrome/background/PredictionOrchestrator";
import { PredictionOrchestrator } from "../src/adapters/chrome/background/PredictionOrchestrator";

function createConfig(overrides: Partial<PredictionConfig> = {}): PredictionConfig {
  return {
    numSuggestions: 6,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: false,
    autoCapitalize: false,
    prefixOnlyMode: false,
    textExpansions: [],

    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
    ...overrides,
  };
}

function createFakeModule(predictionsRef: { current: string[] }): PresageModule {
  const callback = {
    pastStream: "",
    get_past_stream() {
      return this.pastStream;
    },
    get_future_stream() {
      return "";
    },
  };

  return {
    PresageCallback: {
      implement: () => callback,
    },
    Presage: class {
      constructor() {}
      config() {}
      predictWithProbability() {
        return {
          size: () => predictionsRef.current.length,
          get: (idx: number) => ({
            prediction: predictionsRef.current[idx],
            probability: 1,
          }),
        };
      }
    },
    FS: { writeFile: jest.fn() },
  } as unknown as PresageModule;
}

function createFakeModuleWithSpy(predictionsRef: { current: string[] }): {
  module: PresageModule;
  predictWithProbability: ReturnType<typeof jest.fn>;
} {
  const callback = {
    pastStream: "",
    get_past_stream() {
      return this.pastStream;
    },
    get_future_stream() {
      return "";
    },
  };

  const predictWithProbability = jest.fn(() => ({
    size: () => predictionsRef.current.length,
    get: (idx: number) => ({
      prediction: predictionsRef.current[idx],
      probability: 1,
    }),
  }));

  return {
    module: {
      PresageCallback: {
        implement: () => callback,
      },
      Presage: class {
        constructor() {}
        config() {}
        predictWithProbability() {
          return predictWithProbability();
        }
      },
      FS: { writeFile: jest.fn() },
    } as unknown as PresageModule,
    predictWithProbability,
  };
}

describe("PredictionOrchestrator Presage path", () => {
  test("returns Presage predictions", async () => {
    const predictionsRef = { current: ["alpha", "beta"] };
    const presageHandler = new PresageHandler(createFakeModule(predictionsRef));
    const orchestrator = new PredictionOrchestrator(presageHandler);
    orchestrator.setConfig(createConfig());

    const result = await orchestrator.runPrediction("a", "", "en_US");

    expect(result.predictions).toEqual(["alpha", "beta"]);
  });

  test("keeps predictions when grammar settings are enabled", async () => {
    const predictionsRef = { current: ["world", "word"] };
    const module = createFakeModule(predictionsRef);
    const presageHandler = new PresageHandler(module);
    presageHandler.setConfig(
      createConfig({
        minWordLengthToPredict: 1,
        autoCapitalize: true,
        enabledGrammarRules: ["capitalizeFirstLetter"],
      }),
    );

    const result = await presageHandler.runPrediction("w", "", "en_US");

    expect(result.predictions.length).toBeGreaterThan(0);
  });

  test("re-expands random variables on every call", async () => {
    const predictionsRef = { current: ["${random:alpha|beta}"] };
    const { module, predictWithProbability } = createFakeModuleWithSpy(predictionsRef);
    const presageHandler = new PresageHandler(module);
    presageHandler.setConfig(createConfig());

    const randomSpy = jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.99);

    const firstResult = await presageHandler.runPrediction("rsales", "", "en_US");
    const secondResult = await presageHandler.runPrediction("rsales", "", "en_US");

    expect(firstResult.predictions).toEqual(["alpha"]);
    expect(secondResult.predictions).toEqual(["beta"]);
    expect(predictWithProbability).toHaveBeenCalledTimes(2);
    expect(randomSpy).toHaveBeenCalledTimes(2);
  });
});
