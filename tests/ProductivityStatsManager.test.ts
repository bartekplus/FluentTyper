import { jest } from "@jest/globals";
import { ProductivityStatsManager } from "../src/background/ProductivityStatsManager";
import { SettingsManager } from "../src/shared/settingsManager";
import { KEY_PRODUCTIVITY_STATS } from "../src/shared/constants";

function createSettingsManagerMock(seed: Record<string, unknown> = {}): {
  manager: SettingsManager;
  state: Record<string, unknown>;
} {
  const state: Record<string, unknown> = { ...seed };
  return {
    state,
    manager: {
      get: jest.fn(async (key: string) => state[key] as never),
      set: jest.fn(async (key: string, value: unknown) => {
        state[key] = value;
      }),
    } as unknown as SettingsManager,
  };
}

describe("ProductivityStatsManager", () => {
  test("records first-class usage events and snippet contribution", async () => {
    const { manager: settingsManager } = createSettingsManagerMock();
    const manager = new ProductivityStatsManager(settingsManager, {
      now: () => new Date("2026-02-11T10:00:00"),
    });
    manager.setSnippetShortcuts([["brb", {}]]);

    await manager.recordUsageEvent({
      eventType: "suggestion_shown",
      suggestionCount: 3,
      language: "en_US",
    });
    await manager.recordUsageEvent({
      eventType: "suggestion_accepted",
      triggerText: "brb",
      typedTextLength: 3,
      insertedTextLength: 15,
      language: "en_US",
    });
    await manager.recordUsageEvent({
      eventType: "snippet_expanded",
      triggerText: "brb",
      typedTextLength: 3,
      insertedTextLength: 15,
      language: "en_US",
    });
    await manager.recordUsageEvent({
      eventType: "chars_inserted_from_snippet",
      amount: 15,
      triggerText: "brb",
      language: "en_US",
    });
    await manager.recordUsageEvent({
      eventType: "chars_typed_for_trigger",
      amount: 3,
      triggerText: "brb",
      language: "en_US",
    });

    const stats = await manager.getDashboardStats();
    expect(stats.lifetime.acceptedSuggestions).toBe(1);
    expect(stats.lifetime.charactersSaved).toBe(12);
    expect(stats.lifetimeEvents.suggestionsShown).toBe(3);
    expect(stats.lifetimeEvents.snippetsExpanded).toBe(1);
    expect(stats.lifetimeEvents.charsInsertedFromSnippet).toBe(15);
    expect(stats.lifetimeEvents.charsTypedForTrigger).toBe(3);
    expect(stats.topSnippets).toEqual([
      {
        snippet: "brb",
        count: 1,
        charactersSaved: 12,
        estimatedMinutesSaved: 0.1,
      },
    ]);
    expect(stats.perLanguageLifetime).toEqual([
      {
        language: "en_US",
        acceptedSuggestions: 1,
        charactersSaved: 12,
        estimatedMinutesSaved: 0.1,
      },
    ]);
  });

  test("shows weekly recap only after Monday morning trigger", async () => {
    const seededState = {
      [KEY_PRODUCTIVITY_STATS]: {
        schemaVersion: 2,
        acceptedSuggestions: 3,
        charactersSaved: 60,
        suggestionsShown: 0,
        snippetsExpanded: 0,
        charsInsertedFromSnippet: 0,
        charsTypedForTrigger: 0,
        snippetUsage: {},
        languageUsage: {},
        daily: {
          "2026-02-10": {
            acceptedSuggestions: 3,
            charactersSaved: 60,
            suggestionsShown: 0,
            snippetsExpanded: 0,
            charsInsertedFromSnippet: 0,
            charsTypedForTrigger: 0,
            snippetUsage: {},
            languageUsage: {},
          },
        },
        shownMilestones: [],
        firstValuePromptAcknowledged: false,
        lastWeeklyRecapWeek: null,
        lastDonationPromptAt: null,
        donationSnoozedUntil: null,
      },
    };

    const early = createSettingsManagerMock(seededState);
    const earlyManager = new ProductivityStatsManager(early.manager, {
      now: () => new Date("2026-02-16T07:00:00"),
    });
    const beforeTrigger = await earlyManager.getDashboardStats();
    expect(beforeTrigger.weeklyRecap.weekKey).toBe("2026-02-09");
    expect(beforeTrigger.shouldShowWeeklyRecap).toBe(false);

    const onTime = createSettingsManagerMock(seededState);
    const onTimeManager = new ProductivityStatsManager(onTime.manager, {
      now: () => new Date("2026-02-16T09:00:00"),
    });
    const afterTrigger = await onTimeManager.getDashboardStats();
    expect(afterTrigger.shouldShowWeeklyRecap).toBe(true);
  });

  test("enforces first-value prompt cooldown and snooze", async () => {
    const { manager: settingsManager, state } = createSettingsManagerMock({
      [KEY_PRODUCTIVITY_STATS]: {
        schemaVersion: 2,
        acceptedSuggestions: 21,
        charactersSaved: 1200,
        suggestionsShown: 0,
        snippetsExpanded: 0,
        charsInsertedFromSnippet: 0,
        charsTypedForTrigger: 0,
        snippetUsage: {},
        languageUsage: {},
        daily: {},
        shownMilestones: [],
        firstValuePromptAcknowledged: false,
        lastWeeklyRecapWeek: null,
        lastDonationPromptAt: null,
        donationSnoozedUntil: null,
      },
    });

    let now = new Date("2026-02-16T09:00:00");
    const manager = new ProductivityStatsManager(settingsManager, {
      now: () => now,
    });

    const firstPrompt = await manager.getDashboardStats();
    expect(firstPrompt.donationPrompt?.promptId).toBe("first_value");

    await manager.handleDonationPromptAction("first_value", "shown", null);
    const duringCooldown = await manager.getDashboardStats();
    expect(duringCooldown.donationPrompt).toBeNull();

    now = new Date("2026-02-25T09:00:00");
    const afterCooldown = await manager.getDashboardStats();
    expect(afterCooldown.donationPrompt?.promptId).toBe("first_value");

    await manager.handleDonationPromptAction("first_value", "snooze", null);
    now = new Date("2026-03-10T09:00:00");
    const duringSnooze = await manager.getDashboardStats();
    expect(duringSnooze.donationPrompt).toBeNull();

    now = new Date("2026-03-30T09:00:00");
    const afterSnooze = await manager.getDashboardStats();
    expect(afterSnooze.donationPrompt?.promptId).toBe("first_value");

    await manager.handleDonationPromptAction("first_value", "supported", null);
    const rawState = state[KEY_PRODUCTIVITY_STATS] as {
      firstValuePromptAcknowledged: boolean;
    };
    expect(rawState.firstValuePromptAcknowledged).toBe(true);
  });

  test("resetStats clears local counters and survives restart", async () => {
    const { manager: settingsManager, state } = createSettingsManagerMock();
    const manager = new ProductivityStatsManager(settingsManager, {
      now: () => new Date("2026-02-11T10:00:00"),
    });
    manager.setSnippetShortcuts([["brb", {}]]);

    await manager.recordUsageEvent({
      eventType: "suggestion_accepted",
      triggerText: "brb",
      typedTextLength: 3,
      insertedTextLength: 9,
      language: "en_US",
    });
    await manager.recordUsageEvent({
      eventType: "snippet_expanded",
      triggerText: "brb",
      typedTextLength: 3,
      insertedTextLength: 9,
      language: "en_US",
    });

    const restarted = new ProductivityStatsManager(settingsManager, {
      now: () => new Date("2026-02-11T10:01:00"),
    });
    expect((await restarted.getDashboardStats()).lifetime.acceptedSuggestions).toBe(1);

    await restarted.resetStats();
    const afterReset = await restarted.getDashboardStats();
    expect(afterReset.lifetime.acceptedSuggestions).toBe(0);
    expect(afterReset.lifetime.charactersSaved).toBe(0);
    expect(afterReset.topSnippets).toEqual([]);

    const persisted = state[KEY_PRODUCTIVITY_STATS] as {
      acceptedSuggestions: number;
      charactersSaved: number;
    };
    expect(persisted.acceptedSuggestions).toBe(0);
    expect(persisted.charactersSaved).toBe(0);
  });

  test("splits trend counters across midnight boundary", async () => {
    const { manager: settingsManager } = createSettingsManagerMock();
    let now = new Date("2026-02-11T23:59:50");
    const manager = new ProductivityStatsManager(settingsManager, {
      now: () => now,
    });

    await manager.recordUsageEvent({
      eventType: "suggestion_accepted",
      triggerText: "abc",
      typedTextLength: 3,
      insertedTextLength: 8,
      language: "en_US",
    });

    now = new Date("2026-02-12T00:00:10");
    await manager.recordUsageEvent({
      eventType: "suggestion_accepted",
      triggerText: "abc",
      typedTextLength: 3,
      insertedTextLength: 9,
      language: "en_US",
    });

    const stats = await manager.getDashboardStats();
    const dayOne = stats.last7DaysTrend.find((entry) => entry.dateKey === "2026-02-11");
    const dayTwo = stats.last7DaysTrend.find((entry) => entry.dateKey === "2026-02-12");
    expect(dayOne?.acceptedSuggestions).toBe(1);
    expect(dayTwo?.acceptedSuggestions).toBe(1);
  });

  test("handles legacy snippet counters and keeps aggregation fast", async () => {
    const daily: Record<string, unknown> = {};
    for (let idx = 0; idx < 365; idx += 1) {
      const date = new Date("2025-01-01T12:00:00");
      date.setDate(date.getDate() + idx);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
        2,
        "0",
      )}-${String(date.getDate()).padStart(2, "0")}`;
      daily[key] = {
        acceptedSuggestions: 2,
        charactersSaved: 20,
        snippetUsage: { brb: 1 },
        languageUsage: {
          en_US: {
            acceptedSuggestions: 2,
            charactersSaved: 20,
          },
        },
      };
    }

    const { manager: settingsManager } = createSettingsManagerMock({
      [KEY_PRODUCTIVITY_STATS]: {
        schemaVersion: 1,
        acceptedSuggestions: 730,
        charactersSaved: 7300,
        snippetUsage: {
          brb: 15,
        },
        languageUsage: {
          en_US: {
            acceptedSuggestions: 730,
            charactersSaved: 7300,
          },
        },
        daily,
        shownMilestones: [],
        lastWeeklyRecapWeek: null,
      },
    });

    const manager = new ProductivityStatsManager(settingsManager, {
      now: () => new Date("2026-02-11T10:00:00"),
    });

    const start = Date.now();
    const stats = await manager.getDashboardStats();
    const elapsedMs = Date.now() - start;

    expect(stats.topSnippets[0]).toEqual(
      expect.objectContaining({
        snippet: "brb",
        count: expect.any(Number),
      }),
    );
    expect(elapsedMs).toBeLessThan(500);
  });
});
