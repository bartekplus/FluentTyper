import { afterEach, describe, expect, test } from "bun:test";
import { mod } from "./fakeLibPresage.js";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";
import { predictionConfig, runPrediction } from "./support/predictionConfig";

function predict(
  text: string,
  overrides: { emojiSuggestions?: boolean; emojiFirst?: boolean; numSuggestions?: number } = {},
  lang = "en_US",
) {
  const handler = new PresageHandler(mod);
  handler.setConfig(predictionConfig({ emojiSuggestions: true, ...overrides }));
  return runPrediction(handler, text, "", lang);
}

afterEach(() => {
  mod.PresageCallback.predictions = [];
});

describe("PresageHandler emoji suggestions (#504)", () => {
  test("shows no emoji when the setting is off", async () => {
    mod.PresageCallback.predictions = ["fire", "fireplace"];
    await expect(predict("fire", { emojiSuggestions: false })).resolves.toEqual({
      predictions: ["fire", "fireplace"],
    });
  });

  test("puts emoji after the words and keeps them inside the suggestion count", async () => {
    mod.PresageCallback.predictions = ["fire", "fireplace", "firewall"];
    const { predictions, snippetShortcuts } = await predict("fire", { numSuggestions: 3 });
    expect(predictions).toHaveLength(3);
    expect(predictions.slice(0, 1)).toEqual(["fire"]);
    expect(predictions.at(-2)).toBe("🔥");
    expect(snippetShortcuts?.slice(0, 1)).toEqual([null]);
    expect(snippetShortcuts?.at(-2)).toBe("fire");
  });

  test("emoji last never take the only slot from the top word", async () => {
    mod.PresageCallback.predictions = ["fire", "fireplace"];
    await expect(predict("fire", { numSuggestions: 1 })).resolves.toEqual({
      predictions: ["fire"],
    });
    mod.PresageCallback.predictions = [];
    const { predictions } = await predict("fire", { numSuggestions: 1 });
    expect(predictions).toEqual(["🔥"]);
  });

  test("puts emoji first when asked, above an exact dictionary word", async () => {
    mod.PresageCallback.predictions = ["fire", "fireplace"];
    const { predictions } = await predict("fire", { emojiFirst: true });
    expect(predictions[0]).toBe("🔥");
    expect(predictions).toContain("fire");
  });

  test("emoji first keeps the exact word ahead of longer words", async () => {
    mod.PresageCallback.predictions = ["fireplace", "fire", "firewall"];
    const { predictions } = await predict("fire", { emojiFirst: true, numSuggestions: 4 });
    expect(predictions[0]).toBe("🔥");
    expect(predictions.filter((text) => /\p{L}/u.test(text))).toEqual(["fire", "fireplace"]);
  });

  test("a finished word gets no prefix matches: the -> no thermometer", async () => {
    mod.PresageCallback.predictions = ["the", "then", "there"];
    await expect(predict("the")).resolves.toEqual({ predictions: ["the", "then", "there"] });
    mod.PresageCallback.predictions = ["pizza"];
    const { predictions } = await predict("piz");
    expect(predictions).toContain("🍕");
  });

  test("works in every language, not only English", async () => {
    mod.PresageCallback.predictions = ["fire"];
    const { predictions } = await predict("fire", {}, "pl_PL");
    expect(predictions).toContain("🔥");
  });
});
