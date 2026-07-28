import { rankPersonalizedCandidates } from "../src/core/domain/personalization/PersonalizationRanker";

describe("PersonalizationRanker", () => {
  const snapshot = {
    en_US: {
      beta: { display: "Beta", score: 2, updatedAtMs: 1_000 },
      gamma: { display: "gamma", score: 3, updatedAtMs: 1_000 },
      tied: { display: "tied", score: 2, updatedAtMs: 1_000 },
    },
    de_DE: {
      alpha: { display: "Alpha", score: 8, updatedAtMs: 1_000 },
    },
  };

  test("promotes eligible candidates by score without mutating input", () => {
    const candidates = ["alpha", "beta", "gamma", "delta"];
    expect(
      rankPersonalizedCandidates({
        candidates,
        language: "en_US",
        snapshot,
        nowMs: 1_000,
      }),
    ).toEqual(["gamma", "beta", "alpha", "delta"]);
    expect(candidates).toEqual(["alpha", "beta", "gamma", "delta"]);
  });

  test("does not promote after only one acceptance", () => {
    expect(
      rankPersonalizedCandidates({
        candidates: ["alpha", "once", "delta"],
        language: "en_US",
        snapshot: {
          en_US: { once: { display: "once", score: 1, updatedAtMs: 1_000 } },
        },
        nowMs: 1_000,
      }),
    ).toEqual(["alpha", "once", "delta"]);
  });

  test("preserves stable ties and unpersonalized order", () => {
    expect(
      rankPersonalizedCandidates({
        candidates: ["alpha", "tied", "beta", "delta"],
        language: "en_US",
        snapshot,
        nowMs: 1_000,
      }),
    ).toEqual(["tied", "beta", "alpha", "delta"]);
  });

  test("keeps pinned exact matches and expansions ahead of personalization", () => {
    expect(
      rankPersonalizedCandidates({
        candidates: ["exact", "gamma", "expansion", "alpha"],
        language: "en_US",
        snapshot,
        nowMs: 1_000,
        pinnedCandidates: new Set(["exact", "expansion"]),
      }),
    ).toEqual(["exact", "expansion", "gamma", "alpha"]);
  });

  test("isolates learned ranking by language", () => {
    expect(
      rankPersonalizedCandidates({
        candidates: ["beta", "alpha"],
        language: "de_DE",
        snapshot,
        nowMs: 1_000,
      }),
    ).toEqual(["alpha", "beta"]);
  });
});
