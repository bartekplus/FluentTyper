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
        constructor(
          _cb: unknown,
          public path: string,
        ) {}
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

  describe("review spelling lookups", () => {
    /** A fake engine where each prediction takes `costMs` on an injected clock. */
    function timedEngine(costMs: number) {
      let clock = 0;
      const config = jest.fn();
      const pastStreams: string[] = [];
      let callback: { pastStream: string } | undefined;
      const module = {
        PresageCallback: {
          implement: jest.fn((cb: { pastStream: string }) => {
            callback = cb;
            return cb;
          }),
        },
        Presage: class {
          config = config;
          predictWithProbability() {
            pastStreams.push(callback!.pastStream);
            clock += costMs;
            // "known" comes back as itself; any other word gets a correction.
            const word = callback!.pastStream.split(" ").at(-1)!;
            const predictions = word === "known" ? ["known"] : ["was", "way"];
            return {
              size: () => predictions.length,
              get: (index: number) => ({ prediction: predictions[index] }),
            };
          }
        },
        FS: { writeFile: jest.fn() },
      } as unknown as PresageModule;
      const engine = new PresageEngine(
        module,
        { numSuggestions: 3, prefixOnlyMode: true },
        "en_US",
      );
      return { engine, config, pastStreams, now: () => clock, callback: () => callback! };
    }
    const words = [
      { word: "wa", before: "Where " },
      { word: "known", before: "" },
      { word: "wa", before: "" },
      { word: "wa", before: "" },
    ];

    test("without a budget every word is answered", () => {
      const { engine } = timedEngine(30);
      expect(engine.lookupWords(words)).toEqual([
        ["was", "way"],
        null,
        ["was", "way"],
        ["was", "way"],
      ]);
    });

    test("no word is started once the budget is spent; the typing config is restored", () => {
      const { engine, config, pastStreams, now, callback } = timedEngine(30);
      config.mockClear();
      // 30 ms per word, 40 ms budget: the second word starts at 30, the third would at 60.
      expect(engine.lookupWords(words, { budgetMs: 40, now })).toEqual([["was", "way"], null]);
      expect(pastStreams).toEqual(["Where wa", "known"]);
      expect(callback().pastStream).toBe("");
      expect(config.mock.calls.slice(-2)).toEqual([
        ["Presage.Selector.SUGGESTIONS", "3"],
        ["Presage.ContextTracker.PREFIX_ONLY_MODE", "yes"],
      ]);
      // The first word is always answered, so every request makes progress.
      expect(engine.lookupWords(words, { budgetMs: 0, now })).toEqual([["was", "way"]]);
    });

    test("a failing lookup still restores the typing config", () => {
      const { engine, config, now } = timedEngine(1);
      config.mockClear();
      const failing = () => {
        throw new Error("clock failed");
      };
      expect(() =>
        engine.lookupWords(words, {
          budgetMs: 10,
          now: () => (now() > 0 ? failing() : now()),
        }),
      ).toThrow("clock failed");
      expect(config.mock.calls.slice(-2)).toEqual([
        ["Presage.Selector.SUGGESTIONS", "3"],
        ["Presage.ContextTracker.PREFIX_ONLY_MODE", "yes"],
      ]);
    });
  });
});
