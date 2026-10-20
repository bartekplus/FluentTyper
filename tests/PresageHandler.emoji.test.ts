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

  test("puts emoji first when asked, above an exact dictionary word", async () => {
    mod.PresageCallback.predictions = ["fire", "fireplace"];
    const { predictions } = await predict("fire", { emojiFirst: true });
    expect(predictions[0]).toBe("🔥");
    expect(predictions).toContain("fire");
  });

  test("works in every language, not only English", async () => {
    mod.PresageCallback.predictions = ["fire"];
    const { predictions } = await predict("fire", {}, "pl_PL");
    expect(predictions).toContain("🔥");
  });
});
