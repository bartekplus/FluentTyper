import { mod } from "./fakeLibPresage.js";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";

function createHandler(
  textExpansions: Array<[string, string]>,
  overrides: { minWordLengthToPredict?: number; prefixOnlyMode?: boolean } = {},
) {
  const handler = new PresageHandler(mod);
  handler.setConfig({
    numSuggestions: 5,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: false,
    autoCapitalize: false,
    textExpansions: textExpansions as unknown as Array<[string, object]>,
    prefixOnlyMode: false,
    timeFormat: "",
    dateFormat: "",
    userDictionaryList: [],
    ...overrides,
  });
  return handler;
}

const expansions: Array<[string, string]> = [
  ["address", "123 Main Street"],
  ["adv", "advice"],
  ["sig", "Best, Bart"],
];

describe("PresageHandler snippet suggestions (#366)", () => {
  test("inserts prefix matches after the top word, shortest shortcut first", async () => {
    mod.PresageCallback.predictions = ["add", "adding"];
    await expect(createHandler(expansions).runPrediction("ad", "", "en_US")).resolves.toMatchObject(
      {
        predictions: ["add", "advice", "123 Main Street", "adding"],
      },
    );
  });

  test("fuzzy matches in-order characters unless prefix-only mode is on", async () => {
    mod.PresageCallback.predictions = ["adrift"];
    await expect(
      createHandler(expansions).runPrediction("adr", "", "en_US"),
    ).resolves.toMatchObject({
      predictions: ["adrift", "123 Main Street"],
    });
    await expect(
      createHandler(expansions, { prefixOnlyMode: true }).runPrediction("adr", "", "en_US"),
    ).resolves.toMatchObject({ predictions: ["adrift"] });
  });

  test("typo matches are one edit from the shortcut start, tokens of 4+ letters only", async () => {
    mod.PresageCallback.predictions = ["asdf"];
    const handler = createHandler([...expansions, ["thx", "Thanks!"]]);
    await expect(handler.runPrediction("asdr", "", "en_US")).resolves.toMatchObject({
      predictions: ["asdf", "123 Main Street"],
    });
    await expect(handler.runPrediction("the", "", "en_US")).resolves.toMatchObject({
      predictions: ["asdf"],
    });
    await expect(
      createHandler(expansions, { prefixOnlyMode: true }).runPrediction("asdr", "", "en_US"),
    ).resolves.toMatchObject({ predictions: ["asdf"] });
  });

  test("ranks prefix, then abbreviation, then typo matches", async () => {
    mod.PresageCallback.predictions = [];
    const handler = createHandler([
      ["adxe", "typo"],
      ["axdre", "abbreviation"],
      ["adreno", "prefix"],
    ]);
    await expect(handler.runPrediction("adre", "", "textExpander")).resolves.toMatchObject({
      predictions: ["prefix", "abbreviation", "typo"],
    });
  });

  test("caps snippets at half the list unless words leave slots empty or the language is Text Expander", async () => {
    const many = Array.from({ length: 10 }, (_, i): [string, string] => [`ad${i}x`, `snip${i}`]);
    mod.PresageCallback.predictions = ["add", "adding", "admin", "adult"];
    await expect(createHandler(many).runPrediction("ad", "", "en_US")).resolves.toMatchObject({
      predictions: ["add", "snip0", "snip1", "adding", "admin"],
    });
    mod.PresageCallback.predictions = ["add"];
    await expect(createHandler(many).runPrediction("ad", "", "en_US")).resolves.toMatchObject({
      predictions: ["add", "snip0", "snip1", "snip2", "snip3"],
    });
    mod.PresageCallback.predictions = [];
    await expect(
      createHandler(many).runPrediction("ad", "", "textExpander"),
    ).resolves.toMatchObject({
      predictions: ["snip0", "snip1", "snip2", "snip3", "snip4"],
    });
  });

  test("respects the min word length to predict setting", async () => {
    mod.PresageCallback.predictions = ["add"];
    await expect(
      createHandler(expansions, { minWordLengthToPredict: 3 }).runPrediction("ad", "", "en_US"),
    ).resolves.toMatchObject({ predictions: [] });
  });

  test("ignores finished words and exact shortcuts", async () => {
    mod.PresageCallback.predictions = ["alpha"];
    const handler = createHandler(expansions);
    await expect(handler.runPrediction("ad ", "", "en_US")).resolves.toMatchObject({
      predictions: ["alpha"],
    });
    await expect(handler.runPrediction("sig", "", "en_US")).resolves.toMatchObject({
      predictions: ["alpha"],
    });
  });

  test("reports the shortcut of each fuzzy snippet, not of exact Presage matches", async () => {
    mod.PresageCallback.predictions = ["Best, Bart", "add"];
    const handler = createHandler(expansions);
    await expect(handler.runPrediction("adr", "", "en_US")).resolves.toEqual({
      predictions: ["Best, Bart", "123 Main Street", "add"],
      snippetShortcuts: [null, "address", null],
    });
    mod.PresageCallback.predictions = ["Best, Bart"];
    await expect(handler.runPrediction("sig", "", "en_US")).resolves.toEqual({
      predictions: ["Best, Bart"],
    });
  });

  test("does not duplicate an expansion Presage already returned", async () => {
    mod.PresageCallback.predictions = ["123 Main Street", "add"];
    await expect(
      createHandler(expansions).runPrediction("addr", "", "en_US"),
    ).resolves.toMatchObject({
      predictions: ["123 Main Street", "add"],
    });
  });
});
