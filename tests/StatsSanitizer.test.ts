import { describe, expect, test } from "bun:test";
import { DonationPromptPolicy } from "../src/core/domain/productivityStats/DonationPromptPolicy";
import { RecapPolicy } from "../src/core/domain/productivityStats/RecapPolicy";
import { StatsAggregator } from "../src/core/domain/productivityStats/StatsAggregator";
import { StatsSanitizer } from "../src/core/domain/productivityStats/StatsSanitizer";

describe("StatsSanitizer", () => {
  const sanitizer = new StatsSanitizer();

  test("snippet usage accepts bare counts and drops all-zero or invalid entries", () => {
    expect(
      sanitizer.sanitizeSnippetUsageMap({
        " BRB ": 2.4,
        zero: 0,
        negative: -3,
        text: "5",
        "": 4,
        full: { count: 1, charactersSaved: 10, charsInserted: 12, charsTyped: 2 },
        typedOnly: { charsTyped: 3 },
        empty: { count: 0, charactersSaved: 0 },
      }),
    ).toEqual({
      brb: { count: 2, charactersSaved: 0, charsInserted: 0, charsTyped: 0 },
      full: { count: 1, charactersSaved: 10, charsInserted: 12, charsTyped: 2 },
      typedonly: { count: 0, charactersSaved: 0, charsInserted: 0, charsTyped: 3 },
    });
  });

  test("daily map keeps only dated, non-empty buckets", () => {
    const sanitized = sanitizer.sanitizeDailyMap({
      "not-a-date": { acceptedSuggestions: 3 },
      "2026-01-01": { acceptedSuggestions: 0, snippetUsage: { x: 0 } },
      "2026-01-02": { suggestionsShown: 1 },
      "2026-01-03": { languageUsage: { en_US: { acceptedSuggestions: 1 } } },
      "2026-01-04": { snippetUsage: { hi: 1 } },
      "2026-01-05": "garbage",
    });
    expect(Object.keys(sanitized)).toEqual(["2026-01-02", "2026-01-03", "2026-01-04"]);
    expect(sanitized["2026-01-02"]).toEqual({
      acceptedSuggestions: 0,
      charactersSaved: 0,
      suggestionsShown: 1,
      snippetsExpanded: 0,
      charsInsertedFromSnippet: 0,
      charsTypedForTrigger: 0,
      snippetUsage: {},
      languageUsage: {},
    });
  });
});

describe("StatsAggregator", () => {
  const sanitizer = new StatsSanitizer();
  const aggregator = new StatsAggregator(sanitizer);

  test("top snippets sort by minutes saved, then count, then name", () => {
    const top = aggregator.getTopSnippets(
      {
        b: { count: 2, charactersSaved: 0, charsInserted: 0, charsTyped: 0 },
        a: { count: 2, charactersSaved: 0, charsInserted: 0, charsTyped: 0 },
        big: { count: 1, charactersSaved: 2400, charsInserted: 0, charsTyped: 0 },
        c: { count: 1, charactersSaved: 0, charsInserted: 0, charsTyped: 0 },
      },
      10,
    );
    expect(top.map((entry) => entry.snippet)).toEqual(["big", "a", "b", "c"]);
  });

  test("language summaries sort by minutes saved, then accepts, then name", () => {
    const summaries = aggregator.getLanguageSummaries({
      pl_PL: { acceptedSuggestions: 1, charactersSaved: 0 },
      de_DE: { acceptedSuggestions: 1, charactersSaved: 0 },
      en_US: { acceptedSuggestions: 0, charactersSaved: 2400 },
    });
    expect(summaries.map((entry) => entry.language)).toEqual(["en_US", "de_DE", "pl_PL"]);
  });

  test("pruneDailyBuckets drops the oldest keys beyond the cap", () => {
    const daily: Record<string, ReturnType<StatsSanitizer["createDailyState"]>> = {};
    for (let index = 0; index < 402; index += 1) {
      const date = sanitizer.addDays(new Date(2020, 0, 1), index);
      daily[sanitizer.toLocalDateKey(date)] = sanitizer.createDailyState();
    }
    aggregator.pruneDailyBuckets(daily);
    const keys = Object.keys(daily).sort();
    expect(keys).toHaveLength(400);
    expect(keys[0]).toBe("2020-01-03");
  });

  test("aggregateRange sums counters and usage maps across the range", () => {
    const day = (accepted: number) => ({
      ...sanitizer.createDailyState(),
      acceptedSuggestions: accepted,
      snippetUsage: { hi: { count: 1, charactersSaved: 2, charsInserted: 3, charsTyped: 1 } },
      languageUsage: { en_US: { acceptedSuggestions: accepted, charactersSaved: 5 } },
    });
    const totals = aggregator.aggregateRange(
      { "2026-01-01": day(1), "2026-01-02": day(2), "2026-01-05": day(9) },
      new Date(2026, 0, 1),
      new Date(2026, 0, 3),
    );
    expect(totals.acceptedSuggestions).toBe(3);
    expect(totals.snippetUsage).toEqual({
      hi: { count: 2, charactersSaved: 4, charsInserted: 6, charsTyped: 2 },
    });
    expect(totals.languageUsage).toEqual({
      en_US: { acceptedSuggestions: 3, charactersSaved: 10 },
    });
  });
});

describe("DonationPromptPolicy", () => {
  const sanitizer = new StatsSanitizer();
  const policy = new DonationPromptPolicy(sanitizer);
  const recap = new RecapPolicy(sanitizer, new StatsAggregator(sanitizer));

  test.each([
    [1, "You just saved your 1st hour. Buy the dev a coffee?"],
    [5, "You just saved your 5th hours. Buy the dev a coffee?"],
    [25, "You just saved your 25th hours. Buy the dev a coffee?"],
  ])("milestone %i uses an English ordinal", (hours, message) => {
    const state = {
      ...sanitizer.createDefaultStatsState(),
      firstValuePromptAcknowledged: true,
      shownMilestones: [1, 5, 10, 25].filter((milestone) => milestone < hours),
    };
    const lifetime = {
      acceptedSuggestions: 0,
      charactersSaved: 0,
      estimatedMinutesSaved: hours * 60,
    };
    const weeklyRecap = recap.summarizeWeek({}, new Date(2026, 0, 5));
    expect(policy.toDonationPrompt(state, lifetime, new Date(), weeklyRecap, false)?.message).toBe(
      message,
    );
  });

  test("weekly recap reveals only after the reveal hour on Monday", () => {
    const state = sanitizer.createDefaultStatsState();
    const weeklyRecap = {
      ...recap.summarizeWeek({}, new Date(2026, 0, 5)),
      acceptedSuggestions: 1,
    };
    expect(recap.shouldShowWeeklyRecap(state, weeklyRecap, new Date(2026, 0, 12, 7, 59))).toBe(
      false,
    );
    expect(recap.shouldShowWeeklyRecap(state, weeklyRecap, new Date(2026, 0, 12, 8, 0))).toBe(true);
  });
});
