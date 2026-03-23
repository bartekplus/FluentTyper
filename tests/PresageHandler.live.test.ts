import { readFileSync } from "node:fs";
import libPresageMod from "../src/third_party/libpresage/libpresage.js";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";

function createLiveConfig(textExpansions: Array<[string, string]>) {
  return {
    numSuggestions: 5,
    engineNumSuggestions: 10,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: true,
    autoCapitalize: false,
    prefixOnlyMode: false,
    textExpansions,
    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
  };
}

async function createLiveHandler(): Promise<PresageHandler> {
  const root = process.cwd();
  const Module = await libPresageMod({
    wasmBinary: readFileSync(`${root}/src/third_party/libpresage/libpresage.wasm`),
    locateFile: (name: string) => `${root}/public/third_party/libpresage/${name}`,
  });
  return new PresageHandler(Module);
}

describe("PresageHandler live user dictionary", () => {
  test("custom words appear in suggestions when userDictionaryList is set", async () => {
    // Regression: DefaultDictionaryPredictor was accidentally removed from presage.xml
    // causing custom words to be silently ignored (issue #341).
    const handler = await createLiveHandler();

    handler.setConfig({
      ...createLiveConfig([]),
      userDictionaryList: ["fluenttypertest"],
    });

    const result = await handler.runPrediction("fluenttypert", "", "en_US");
    expect(result.predictions.map((p) => p.trim())).toContain("fluenttypertest");
  });
});

describe("PresageHandler live PREFIX_ONLY_MODE", () => {
  test("without prefix-only mode, predictions include non-prefix matches", async () => {
    const handler = await createLiveHandler();

    handler.setConfig({
      ...createLiveConfig([]),
      prefixOnlyMode: false,
      userDictionaryList: ["helicopter"],
      insertSpaceAfterAutocomplete: false,
    });

    const result = await handler.runPrediction("heli", "", "en_US");
    const words = result.predictions.map((p) => p.trim().toLowerCase());
    // Without prefix-only, spell-correction can return words not starting with "heli"
    expect(words).toContain("helicopter");
    expect(words.some((w) => !w.startsWith("heli"))).toBe(true);
  });

  test("with prefix-only mode, all predictions start with the typed prefix", async () => {
    const handler = await createLiveHandler();

    handler.setConfig({
      ...createLiveConfig([]),
      prefixOnlyMode: true,
      userDictionaryList: ["helicopter"],
      insertSpaceAfterAutocomplete: false,
    });

    const result = await handler.runPrediction("heli", "", "en_US");
    const words = result.predictions.map((p) => p.trim().toLowerCase());
    expect(words.length).toBeGreaterThan(0);
    expect(words).toContain("helicopter");
    for (const word of words) {
      expect(word.startsWith("heli")).toBe(true);
    }
  });

  test("prefix-only mode returns no results for a misspelled word with no prefix matches", async () => {
    const handler = await createLiveHandler();

    handler.setConfig({
      ...createLiveConfig([]),
      prefixOnlyMode: true,
      insertSpaceAfterAutocomplete: false,
    });

    const result = await handler.runPrediction("speling", "", "en_US");
    expect(result.predictions).toEqual([]);
  });
});

describe("PresageHandler live text expansion config refresh", () => {
  test("refreshes duplicate text expansions after runtime config changes", async () => {
    const handler = await createLiveHandler();

    handler.setConfig(createLiveConfig([["asap", "as soon as possible"]]));
    await expect(handler.runPrediction("asap", "", "textExpander")).resolves.toEqual({
      predictions: ["as soon as possible "],
    });

    handler.setConfig(
      createLiveConfig([
        ["asap", "as soon as possible"],
        ["asap", "at some available point"],
      ]),
    );

    const refreshed = await handler.runPrediction("asap", "", "textExpander");

    expect(refreshed.predictions).toHaveLength(2);
    expect(refreshed.predictions).toEqual(
      expect.arrayContaining(["as soon as possible ", "at some available point "]),
    );
  });
});
