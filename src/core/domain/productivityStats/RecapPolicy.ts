import type { WeeklyRecapSummary } from "@core/domain/messageTypes";
import {
  DONATION_MILESTONE_HOURS,
  EQUIVALENT_TASK_MINUTES,
  WEEKLY_RECAP_REVEAL_HOUR,
} from "./constants";
import * as aggregator from "./StatsAggregator";
import * as sanitizer from "./StatsSanitizer";
import type { ProductivityStatsState } from "./types";

function estimateHoursSaved(acceptedSuggestions: number, charactersSaved: number): number {
  return aggregator.estimateMinutesSaved(acceptedSuggestions, charactersSaved) / 60;
}

export function summarizeWeek(
  state: Pick<ProductivityStatsState, "daily" | "acceptedSuggestions" | "charactersSaved">,
  weekStart: Date,
): WeeklyRecapSummary {
  const weekEnd = sanitizer.addDays(weekStart, 6);
  const aggregated = aggregator.aggregateRange(state.daily, weekStart, weekEnd);
  // Use the lifetime counters: old daily buckets are pruned, so their sum can be too low.
  const afterWeek = aggregator.aggregateAfterDate(state.daily, weekEnd);
  const throughWeekAccepted = state.acceptedSuggestions - afterWeek.acceptedSuggestions;
  const throughWeekCharacters = state.charactersSaved - afterWeek.charactersSaved;

  const beforeWeekHours = estimateHoursSaved(
    throughWeekAccepted - aggregated.acceptedSuggestions,
    throughWeekCharacters - aggregated.charactersSaved,
  );
  const throughWeekHours = estimateHoursSaved(throughWeekAccepted, throughWeekCharacters);

  const milestonesCrossedHours = DONATION_MILESTONE_HOURS.filter(
    (milestone) => beforeWeekHours < milestone && throughWeekHours >= milestone,
  );

  const estimatedMinutesSaved = aggregator.estimateMinutesSaved(
    aggregated.acceptedSuggestions,
    aggregated.charactersSaved,
  );
  const topSnippet = aggregator.getTopSnippets(aggregated.snippetUsage, 1)[0] || null;

  return {
    weekKey: sanitizer.toLocalDateKey(weekStart),
    acceptedSuggestions: aggregated.acceptedSuggestions,
    charactersSaved: aggregated.charactersSaved,
    estimatedMinutesSaved,
    topSnippet,
    milestonesCrossedHours,
    equivalentTasks: Math.max(0, Math.round(estimatedMinutesSaved / EQUIVALENT_TASK_MINUTES)),
  };
}

export function shouldShowWeeklyRecap(
  state: ProductivityStatsState,
  weeklyRecap: WeeklyRecapSummary,
  now: Date,
): boolean {
  if (weeklyRecap.acceptedSuggestions <= 0 || state.lastWeeklyRecapWeek === weeklyRecap.weekKey) {
    return false;
  }

  const currentWeekStart = sanitizer.getWeekStart(now);
  const expectedRecapWeekKey = sanitizer.toLocalDateKey(sanitizer.addDays(currentWeekStart, -7));
  // Only surface the previous completed week, and only after the local reveal hour.
  if (weeklyRecap.weekKey !== expectedRecapWeekKey) {
    return false;
  }

  const revealAt = new Date(
    currentWeekStart.getFullYear(),
    currentWeekStart.getMonth(),
    currentWeekStart.getDate(),
    WEEKLY_RECAP_REVEAL_HOUR,
  );

  return now >= revealAt;
}
