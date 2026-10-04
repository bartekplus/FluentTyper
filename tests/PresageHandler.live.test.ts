import { createLiveConfig, createLiveHandler, runPrediction } from "./support/presageLive";

describe("PresageHandler live user dictionary", () => {
  test("custom words appear in suggestions when userDictionaryList is set", async () => {
    // Regression: DefaultDictionaryPredictor was accidentally removed from presage.xml
    // causing custom words to be silently ignored (issue #341).
    const handler = await createLiveHandler();

    handler.setConfig({
      ...createLiveConfig([]),
      userDictionaryList: ["fluenttypertest"],
    });

    const result = await runPrediction(handler, "fluenttypert", "", "en_US");
    expect(result.predictions.map((p) => p.trim())).toContain("fluenttypertest");
  });
});

describe("PresageHandler live text expansion config refresh", () => {
  test("refreshes duplicate text expansions after runtime config changes", async () => {
    const handler = await createLiveHandler();

    handler.setConfig(createLiveConfig([["asap", "as soon as possible"]]));
    await expect(runPrediction(handler, "asap", "", "textExpander")).resolves.toEqual({
      predictions: ["as soon as possible "],
    });

    handler.setConfig(
      createLiveConfig([
        ["asap", "as soon as possible"],
        ["asap", "at some available point"],
      ]),
    );

    const refreshed = await runPrediction(handler, "asap", "", "textExpander");

    expect(refreshed.predictions).toHaveLength(2);
    expect(refreshed.predictions).toEqual(
      expect.arrayContaining(["as soon as possible ", "at some available point "]),
    );
  });
});

describe("PresageHandler live personalized ranking", () => {
  test("promotes an existing tenth Presage candidate before the visible cutoff", async () => {
    const handler = await createLiveHandler({
      getPersonalizationSnapshot: () => ({
        en_US: {
          through: { display: "through", score: 3, updatedAtMs: 1_000 },
        },
      }),
      now: () => 1_000,
    });
    handler.setConfig({
      ...createLiveConfig([]),
      numSuggestions: 3,
      insertSpaceAfterAutocomplete: false,
      personalizationEnabled: true,
    });

    const result = await runPrediction(handler, "th", "", "en_US");

    expect(result.predictions).toEqual(["through", "the", "that"]);
  });
});
