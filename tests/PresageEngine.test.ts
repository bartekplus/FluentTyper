import { jest } from "bun:test";
import type { PresageModule } from "../src/adapters/chrome/background/PresageTypes";
import { PresageEngine } from "../src/adapters/chrome/background/PresageEngine";

describe("PresageEngine", () => {
  test("initializes native Presage with callback/path and suggestion config", () => {
    const callbackImplement = jest.fn((callbackImpl) => callbackImpl);
    const config = jest.fn();

    const module = {
      PresageCallback: { implement: callbackImplement },
      Presage: class {
        constructor(
          _callbackImpl: unknown,
          public path: string,
        ) {}
        config = config;
        predictWithProbability() {
          return {
            size: () => 0,
            get: () => ({ prediction: "" }),
          };
        }
      },
      FS: { writeFile: jest.fn() },
    } as unknown as PresageModule;

    const engine = new PresageEngine(module, { numSuggestions: 3, prefixOnlyMode: false }, "en_US");

    expect(callbackImplement).toHaveBeenCalledTimes(1);
    expect(config).toHaveBeenCalledWith("Presage.Selector.SUGGESTIONS", "3");

    engine.setConfig({ numSuggestions: 7, prefixOnlyMode: false });
    expect(config).toHaveBeenCalledWith("Presage.Selector.SUGGESTIONS", "7");
  });

  test("predict parses JSON predictions and keeps plain string predictions", () => {
    const nativePredictions = [
      { prediction: '"hello"' },
      { prediction: "world" },
      { prediction: "null" },
    ];
    const implement = jest.fn((callbackImpl) => callbackImpl);

    const module = {
      PresageCallback: {
        implement,
      },
      Presage: class {
        config = jest.fn();
        constructor() {}
        predictWithProbability() {
          return {
            size: () => nativePredictions.length,
            get: (index: number) => nativePredictions[index],
          };
        }
      },
      FS: { writeFile: jest.fn() },
    } as unknown as PresageModule;

    const engine = new PresageEngine(module, { numSuggestions: 3, prefixOnlyMode: false }, "en_US");
    const predictions = engine.predict("input text");

    const callbackArg = implement.mock.calls[0]?.[0] as { pastStream: string };
    expect(callbackArg.pastStream).toBe("input text");
    expect(predictions).toEqual(["hello", "world"]);
  });

  test("setConfig calls PREFIX_ONLY_MODE on native presage", () => {
    const config = jest.fn();
    const module = {
      PresageCallback: { implement: jest.fn((cb) => cb) },
      Presage: class {
        constructor(_cb: unknown, public path: string) {}
        config = config;
        predictWithProbability() {
          return { size: () => 0, get: () => ({ prediction: "" }) };
        }
      },
      FS: { writeFile: jest.fn() },
    } as unknown as PresageModule;

    const engine = new PresageEngine(module, { numSuggestions: 3, prefixOnlyMode: false }, "en_US");
    expect(config).toHaveBeenCalledWith("Presage.ContextTracker.PREFIX_ONLY_MODE", "no");

    engine.setConfig({ numSuggestions: 3, prefixOnlyMode: true });
    expect(config).toHaveBeenCalledWith("Presage.ContextTracker.PREFIX_ONLY_MODE", "yes");
  });
});
