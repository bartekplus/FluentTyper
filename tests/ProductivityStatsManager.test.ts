import { jest } from "@jest/globals";
import { ProductivityStatsManager } from "../src/background/ProductivityStatsManager";
import { SettingsManager } from "../src/shared/settingsManager";
import { KEY_PRODUCTIVITY_STATS } from "../src/shared/constants";

function createSettingsManagerMock(
  seed: Record<string, unknown> = {},
): SettingsManager {
  const state: Record<string, unknown> = { ...seed };
  return {
    get: jest.fn(async (key: string) => state[key] as never),
    set: jest.fn(async (key: string, value: unknown) => {
      state[key] = value;
    }),
  } as unknown as SettingsManager;
}

describe("ProductivityStatsManager", () => {
  test("records accepted suggestions and snippet usage", async () => {
    const settingsManager = createSettingsManagerMock();
    const manager = new ProductivityStatsManager(settingsManager, {
      now: () => new Date("2026-02-11T10:00:00"),
    });
    manager.setSnippetShortcuts([["brb", {}]]);

    await manager.recordSuggestionAccepted({
      eventType: "suggestion_accepted",
      triggerText: "brb",
      typedTextLength: 3,
      insertedTextLength: 15,
    });

    const stats = await manager.getDashboardStats();
    expect(stats.lifetime.acceptedSuggestions).toBe(1);
    expect(stats.lifetime.charactersSaved).toBe(12);
    expect(stats.topSnippets).toEqual([{ snippet: "brb", count: 1 }]);
  });

  test("exposes and acknowledges weekly recap visibility", async () => {
    const settingsManager = createSettingsManagerMock({
      [KEY_PRODUCTIVITY_STATS]: {
        schemaVersion: 1,
        acceptedSuggestions: 3,
        charactersSaved: 60,
        snippetUsage: {},
        daily: {
          "2026-02-03": {
            acceptedSuggestions: 3,
            charactersSaved: 60,
            snippetUsage: {},
          },
        },
        shownMilestones: [],
        lastWeeklyRecapWeek: null,
      },
    });
    const manager = new ProductivityStatsManager(settingsManager, {
      now: () => new Date("2026-02-11T10:00:00"),
    });

    const beforeAck = await manager.getDashboardStats();
    expect(beforeAck.weeklyRecap.weekKey).toBe("2026-02-02");
    expect(beforeAck.shouldShowWeeklyRecap).toBe(true);

    await manager.acknowledgeWeeklyRecap(beforeAck.weeklyRecap.weekKey);

    const afterAck = await manager.getDashboardStats();
    expect(afterAck.shouldShowWeeklyRecap).toBe(false);
  });

  test("returns and acknowledges donation milestone prompts", async () => {
    const settingsManager = createSettingsManagerMock({
      [KEY_PRODUCTIVITY_STATS]: {
        schemaVersion: 1,
        acceptedSuggestions: 0,
        charactersSaved: 15000,
        snippetUsage: {},
        daily: {},
        shownMilestones: [],
        lastWeeklyRecapWeek: null,
      },
    });
    const manager = new ProductivityStatsManager(settingsManager);

    const firstRead = await manager.getDashboardStats();
    expect(firstRead.donationPrompt?.milestoneHours).toBe(1);

    await manager.acknowledgeDonationMilestone(1);

    const secondRead = await manager.getDashboardStats();
    expect(secondRead.donationPrompt).toBeNull();
  });
});
