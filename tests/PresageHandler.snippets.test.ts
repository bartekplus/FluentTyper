import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mod } from "./fakeLibPresage.js";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";
import { TemplateExpander } from "../src/adapters/chrome/background/TemplateExpander";
import { KEY_TEXT_EXPANSIONS } from "../src/core/domain/constants";
import { manifest } from "../src/ui/options/settingsManifest";

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

function predict(handler: PresageHandler, text: string, lang = "en_US") {
  return handler.runPrediction(text, "", lang);
}

const expansions: Array<[string, string]> = [
  ["address", "123 Main Street"],
  ["adv", "advice"],
  ["sig", "Best, Bart"],
];

const defaultExpansions = manifest.settings.find((setting) => setting.name === KEY_TEXT_EXPANSIONS)
  ?.default as Array<[string, string]>;

afterEach(() => {
  mod.PresageCallback.predictions = [];
});

describe("PresageHandler snippet suggestions (#366)", () => {
  test("inserts prefix matches after the top word, shortest shortcut first", async () => {
    mod.PresageCallback.predictions = ["add", "adding"];
    await expect(predict(createHandler(expansions), "ad")).resolves.toEqual({
      predictions: ["add", "advice", "123 Main Street", "adding"],
      snippetShortcuts: [null, "adv", "address", null],
    });
  });

  test("ordinary words never hit the default snippets in a word language", async () => {
    expect(defaultExpansions.length).toBeGreaterThan(10);
    mod.PresageCallback.predictions = ["word"];
    const handler = createHandler(defaultExpansions);
    for (const word of ["date", "time", "came", "calm", "title", "domain", "sales"]) {
      await expect(predict(handler, word)).resolves.toEqual({ predictions: ["word"] });
    }
  });

  test("abbreviation and typo matches only in Text Expander, and not in prefix-only mode", async () => {
    const handler = createHandler(expansions);
    await expect(predict(handler, "adr")).resolves.toEqual({ predictions: [] });
    await expect(predict(handler, "adr", "textExpander")).resolves.toEqual({
      predictions: ["123 Main Street"],
      snippetShortcuts: ["address"],
    });
    await expect(predict(handler, "asdr", "textExpander")).resolves.toEqual({
      predictions: ["123 Main Street"],
      snippetShortcuts: ["address"],
    });
    await expect(
      predict(createHandler(expansions, { prefixOnlyMode: true }), "adr", "textExpander"),
    ).resolves.toEqual({ predictions: [] });
  });

  test("ranks prefix, then abbreviation, then typo matches in Text Expander", async () => {
    const handler = createHandler([
      ["adxe", "typo"],
      ["axdre", "abbreviation"],
      ["adreno", "prefix"],
    ]);
    await expect(predict(handler, "adre", "textExpander")).resolves.toMatchObject({
      predictions: ["prefix", "abbreviation", "typo"],
    });
  });

  test("matches the current word after opening punctuation, the token acceptance replaces", async () => {
    const handler = createHandler(expansions);
    for (const text of ["(ad", "[ad", '"ad', "/ad"]) {
      await expect(predict(handler, text)).resolves.toEqual({
        predictions: ["advice", "123 Main Street"],
        snippetShortcuts: ["adv", "address"],
      });
    }
  });

  test("caps snippets at half the list unless words leave slots empty or the language is Text Expander", async () => {
    const many = Array.from({ length: 10 }, (_, i): [string, string] => [`ad${i}x`, `snip${i}`]);
    mod.PresageCallback.predictions = ["add", "adding", "admin", "adult"];
    await expect(predict(createHandler(many), "ad")).resolves.toMatchObject({
      predictions: ["add", "snip0", "snip1", "adding", "admin"],
    });
    mod.PresageCallback.predictions = ["add"];
    await expect(predict(createHandler(many), "ad")).resolves.toMatchObject({
      predictions: ["add", "snip0", "snip1", "snip2", "snip3"],
    });
    mod.PresageCallback.predictions = [];
    await expect(predict(createHandler(many), "ad", "textExpander")).resolves.toMatchObject({
      predictions: ["snip0", "snip1", "snip2", "snip3", "snip4"],
    });
  });

  test("resolves templates only for the snippets it can show", async () => {
    const many = Array.from({ length: 1000 }, (_, i): [string, string] => [
      `ad${i}x`,
      `snip${i} \${page_title}`,
    ]);
    const handler = createHandler(many);
    const parse = spyOn(TemplateExpander, "parseStringTemplateAsync");
    try {
      await predict(handler, "ad", "textExpander");
      expect(parse).toHaveBeenCalledTimes(5);
    } finally {
      parse.mockRestore();
    }
  });

  test("two shortcuts with the same expansion give one row, labelled with the best match", async () => {
    mod.PresageCallback.predictions = ["add"];
    const handler = createHandler([
      ["address", "X"],
      ["addr", "X"],
    ]);
    await expect(predict(handler, "ad")).resolves.toEqual({
      predictions: ["add", "X"],
      snippetShortcuts: [null, "addr"],
    });
  });

  test("a snippet equal to a Presage word is dropped, the word stays unlabelled, and the budget refills", async () => {
    mod.PresageCallback.predictions = ["add", "adding", "admin", "adult", "adopt"];
    const handler = createHandler([
      ["ad0", "add"],
      ["ad1", "adding"],
      ["address", "123 Main Street"],
    ]);
    await expect(predict(handler, "ad")).resolves.toEqual({
      predictions: ["add", "123 Main Street", "adding", "admin", "adult"],
      snippetShortcuts: [null, "address", null, null, null],
    });
  });

  test("respects the min word length to predict setting", async () => {
    mod.PresageCallback.predictions = ["add"];
    await expect(
      predict(createHandler(expansions, { minWordLengthToPredict: 3 }), "ad"),
    ).resolves.toEqual({ predictions: [] });
  });

  test("ignores finished words and leaves exact shortcuts to Presage, unlabelled", async () => {
    mod.PresageCallback.predictions = ["Best, Bart"];
    const handler = createHandler(expansions);
    await expect(predict(handler, "ad ")).resolves.toEqual({ predictions: ["Best, Bart"] });
    await expect(predict(handler, "sig")).resolves.toEqual({ predictions: ["Best, Bart"] });
  });
});
