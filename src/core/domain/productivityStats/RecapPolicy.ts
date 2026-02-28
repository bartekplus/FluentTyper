import type { WeeklyRecapSummary } from "@core/domain/messageTypes";
import {
  DONATION_MILESTONE_HOURS,
  EQUIVALENT_TASK_MINUTES,
  WEEKLY_RECAP_REVEAL_HOUR,
} from "./constants";
import { StatsAggregator } from "./StatsAggregator";
import { StatsSanitizer } from "./StatsSanitizer";
import type { DailyProductivityState, ProductivityStatsState } from "./types";

export class RecapPolicy {
  constructor(
    private readonly sanitizer: StatsSanitizer,
    private readonly aggregator: StatsAggregator,
  ) {}

  summarizeWeek(
    daily: Record<string, DailyProductivityState>,
    weekStart: Date,
  ): WeeklyRecapSummary {
    const weekEnd = this.sanitizer.addDays(weekStart, 6);
    const aggregated = this.aggregator.aggregateRange(daily, weekStart, weekEnd);
    const beforeWeek = this.aggregator.aggregateThroughDate(
      daily,
      this.sanitizer.addDays(weekStart, -1),
    );
    const throughWeek = this.aggregator.aggregateThroughDate(daily, weekEnd);

    const beforeWeekHours =
      this.aggregator.estimateMinutesSaved(
        beforeWeek.acceptedSuggestions,
        beforeWeek.charactersSaved,
      ) / 60;
    const throughWeekHours =
      this.aggregator.estimateMinutesSaved(
        throughWeek.acceptedSuggestions,
        throughWeek.charactersSaved,
      ) / 60;

    const milestonesCrossedHours = DONATION_MILESTONE_HOURS.filter(
      (milestone) => beforeWeekHours < milestone && throughWeekHours >= milestone,
    );

    const estimatedMinutesSaved = this.aggregator.estimateMinutesSaved(
      aggregated.acceptedSuggestions,
      aggregated.charactersSaved,
    );
    const topSnippet = this.aggregator.getTopSnippets(aggregated.snippetUsage, 1)[0] || null;

    return {
      weekKey: this.sanitizer.toLocalDateKey(weekStart),
      acceptedSuggestions: aggregated.acceptedSuggestions,
      charactersSaved: aggregated.charactersSaved,
      estimatedMinutesSaved,
      topSnippet,
      milestonesCrossedHours,
      equivalentTasks: Math.max(
        0,
        Math.round(estimatedMinutesSaved / EQUIVALENT_TASK_MINUTES),
      ),
    };
  }

  shouldShowWeeklyRecap(
    state: ProductivityStatsState,
    weeklyRecap: WeeklyRecapSummary,
    now: Date,
  ): boolean {
    if (
      weeklyRecap.acceptedSuggestions <= 0 ||
      state.lastWeeklyRecapWeek === weeklyRecap.weekKey
    ) {
      return false;
    }

    const currentWeekStart = this.sanitizer.getWeekStart(now);
    const expectedRecapWeekKey = this.sanitizer.toLocalDateKey(
      this.sanitizer.addDays(currentWeekStart, -7),
    );
    if (weeklyRecap.weekKey !== expectedRecapWeekKey) {
      return false;
    }

    const revealAt = new Date(
      currentWeekStart.getFullYear(),
      currentWeekStart.getMonth(),
      currentWeekStart.getDate(),
      WEEKLY_RECAP_REVEAL_HOUR,
      0,
      0,
      0,
    );

    return now >= revealAt;
  }
}
