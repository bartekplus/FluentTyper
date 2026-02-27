import { mergePredictions } from "../src/background/PredictionMerger";

describe("mergePredictions", () => {
  test("returns empty for non-positive limit", () => {
    expect(mergePredictions(["one"], ["two"], 0)).toEqual([]);
  });

  test("interleaves Presage and AI with 2:1 ratio", () => {
    const result = mergePredictions(
      ["alpha", "beta", "charlie", "delta"],
      ["xray", "yankee", "zulu"],
      6,
    );

    expect(result).toEqual([
      "alpha",
      "beta",
      "xray",
      "charlie",
      "delta",
      "yankee",
    ]);
  });

  test("deduplicates case-insensitive and NBSP variants", () => {
    const result = mergePredictions(
      ["Alpha", "Beta\xA0", "Gamma"],
      [" alpha ", "beta", "Delta"],
      5,
    );

    expect(result).toEqual(["Alpha", "Beta\xA0", "Gamma", "Delta"]);
  });

  test("fills remaining slots from AI when Presage runs out", () => {
    const result = mergePredictions(["one"], ["two", "three"], 3);
    expect(result).toEqual(["one", "two", "three"]);
  });

  test("returns empty when there are no candidates", () => {
    const result = mergePredictions([], [], 4);
    expect(result).toEqual([]);
  });

  test("drops empty normalized candidates and respects hard limit", () => {
    const result = mergePredictions(["one", "two", "three"], ["   ", "four"], 1);
    expect(result).toEqual(["one"]);
  });
});
