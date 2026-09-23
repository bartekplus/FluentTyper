import { CandidateRanker } from "../src/adapters/chrome/background/webllm/CandidateRanker";

const rank = (predictions: string[], fragment: string, limit: number) =>
  new CandidateRanker().postProcessPredictions(
    predictions,
    { mode: "complete_or_correct", fragment },
    limit,
  );

describe("CandidateRanker", () => {
  test("ranks exact match, then prefix completions, then corrections, deduping case-insensitively", () => {
    expect(rank(["super", "supper", "sup", "Superb", "soup", "sup"], "sup", 10)).toEqual([
      "sup",
      "super",
      "supper",
      "Superb",
      "soup",
    ]);
    expect(rank(["amazing", "amusing", "amazon", "Amazing", "banana"], "amazgi", 10)).toEqual([
      "amazing",
      "amazon",
    ]);
  });

  test("keeps input order for equal scores and respects the limit", () => {
    expect(rank(["supe", "supa", "supi"], "sup", 2)).toEqual(["supe", "supa"]);
  });

  test("falls back to normalized input when no candidate matches the fragment", () => {
    expect(rank([" xyz ", "abc", "XYZ"], "hello", 10)).toEqual(["xyz", "abc"]);
  });

  test("next-word mode only normalizes and truncates", () => {
    expect(
      new CandidateRanker().postProcessPredictions(
        ["b", " a ", "B", ""],
        { mode: "next_word", fragment: "" },
        2,
      ),
    ).toEqual(["b", "a"]);
  });
});
