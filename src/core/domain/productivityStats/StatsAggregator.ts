import type {
  LanguageUsageSummary,
  ProductivityDashboardStats,
  ProductivityMetricSummary,
  TopSnippetUsage,
} from "@core/domain/messageTypes";
import { clamp } from "@core/domain/guards";
import {
  ACCEPTANCE_BONUS_SECONDS,
  DONATION_MILESTONE_HOURS,
  MAX_DAILY_BUCKETS,
  TYPING_CHARACTERS_PER_MINUTE,
} from "./constants";
import * as sanitizer from "./StatsSanitizer";
import type { DailyProductivityState, LanguageUsageCounters, SnippetUsageCounters } from "./types";

export interface SnippetUsageUpdate {
  countDelta?: number;
  charsSavedDelta?: number;
  charsInsertedDelta?: number;
  charsTypedDelta?: number;
}

export function addLanguageUsageCounters(
  usageMap: Record<string, LanguageUsageCounters>,
  language: string,
  acceptedSuggestions: number,
  charactersSaved: number,
): void {
  usageMap[language] ??= { acceptedSuggestions: 0, charactersSaved: 0 };
  usageMap[language].acceptedSuggestions += acceptedSuggestions;
  usageMap[language].charactersSaved += charactersSaved;
}

export function estimateMinutesSaved(acceptedSuggestions: number, charactersSaved: number): number {
  const typingMinutes = charactersSaved / TYPING_CHARACTERS_PER_MINUTE;
  const acceptanceMinutes = (acceptedSuggestions * ACCEPTANCE_BONUS_SECONDS) / 60;
  return sanitizer.roundMetric(typingMinutes + acceptanceMinutes);
}

export function metricsFromCounters(
  acceptedSuggestions: number,
  charactersSaved: number,
): ProductivityMetricSummary {
  return {
    acceptedSuggestions,
    charactersSaved,
    estimatedMinutesSaved: estimateMinutesSaved(acceptedSuggestions, charactersSaved),
  };
}

export function incrementSnippetUsageCounter(
  usageMap: Record<string, SnippetUsageCounters>,
  snippet: string,
  update: SnippetUsageUpdate,
): void {
  usageMap[snippet] ??= sanitizer.createSnippetCounters();
  usageMap[snippet].count += update.countDelta || 0;
  usageMap[snippet].charactersSaved += update.charsSavedDelta || 0;
  usageMap[snippet].charsInserted += update.charsInsertedDelta || 0;
  usageMap[snippet].charsTyped += update.charsTypedDelta || 0;
}

export function aggregateRange(
  daily: Record<string, DailyProductivityState>,
  start: Date,
  end: Date,
): DailyProductivityState {
  const counters = sanitizer.createDailyState();

  const cursor = sanitizer.startOfLocalDay(start);
  const endKey = sanitizer.toLocalDateKey(end);

  while (sanitizer.toLocalDateKey(cursor) <= endKey) {
    const dayKey = sanitizer.toLocalDateKey(cursor);
    const entry = daily[dayKey];
    if (entry) {
      counters.acceptedSuggestions += entry.acceptedSuggestions;
      counters.charactersSaved += entry.charactersSaved;
      counters.suggestionsShown += entry.suggestionsShown;
      counters.snippetsExpanded += entry.snippetsExpanded;
      counters.charsInsertedFromSnippet += entry.charsInsertedFromSnippet;
      counters.charsTypedForTrigger += entry.charsTypedForTrigger;

      for (const [snippet, snippetCounters] of Object.entries(entry.snippetUsage)) {
        incrementSnippetUsageCounter(counters.snippetUsage, snippet, {
          countDelta: snippetCounters.count,
          charsSavedDelta: snippetCounters.charactersSaved,
          charsInsertedDelta: snippetCounters.charsInserted,
          charsTypedDelta: snippetCounters.charsTyped,
        });
      }

      for (const [language, values] of Object.entries(entry.languageUsage)) {
        addLanguageUsageCounters(
          counters.languageUsage,
          language,
          values.acceptedSuggestions,
          values.charactersSaved,
        );
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return counters;
}

/** The totals of the daily buckets after `date`. */
export function aggregateAfterDate(
  daily: Record<string, DailyProductivityState>,
  date: Date,
): Pick<DailyProductivityState, "acceptedSuggestions" | "charactersSaved"> {
  let acceptedSuggestions = 0;
  let charactersSaved = 0;
  const dateKey = sanitizer.toLocalDateKey(date);

  for (const [entryKey, entry] of Object.entries(daily)) {
    if (entryKey <= dateKey) {
      continue;
    }
    acceptedSuggestions += entry.acceptedSuggestions;
    charactersSaved += entry.charactersSaved;
  }

  return {
    acceptedSuggestions,
    charactersSaved,
  };
}

export function getTopSnippets(
  usageMap: Record<string, SnippetUsageCounters>,
  limit: number,
): TopSnippetUsage[] {
  return Object.entries(usageMap)
    .map(([snippet, counters]) => ({
      snippet,
      count: counters.count,
      charactersSaved: counters.charactersSaved,
      estimatedMinutesSaved: estimateMinutesSaved(counters.count, counters.charactersSaved),
    }))
    .sort(
      (left, right) =>
        right.estimatedMinutesSaved - left.estimatedMinutesSaved ||
        right.count - left.count ||
        left.snippet.localeCompare(right.snippet),
    )
    .slice(0, limit);
}

export function getLanguageSummaries(
  usageMap: Record<string, LanguageUsageCounters>,
): LanguageUsageSummary[] {
  return Object.entries(usageMap)
    .map(([language, counters]) => ({
      language,
      acceptedSuggestions: counters.acceptedSuggestions,
      charactersSaved: counters.charactersSaved,
      estimatedMinutesSaved: estimateMinutesSaved(
        counters.acceptedSuggestions,
        counters.charactersSaved,
      ),
    }))
    .sort(
      (left, right) =>
        right.estimatedMinutesSaved - left.estimatedMinutesSaved ||
        right.acceptedSuggestions - left.acceptedSuggestions ||
        left.language.localeCompare(right.language),
    );
}

export function getLast7DayTrend(
  daily: Record<string, DailyProductivityState>,
  now: Date,
): ProductivityDashboardStats["last7DaysTrend"] {
  const points: ProductivityDashboardStats["last7DaysTrend"] = [];
  const start = sanitizer.addDays(now, -6);
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const dayDate = sanitizer.addDays(start, dayOffset);
    const dayKey = sanitizer.toLocalDateKey(dayDate);
    const entry = daily[dayKey] || sanitizer.createDailyState();
    points.push({
      dateKey: dayKey,
      acceptedSuggestions: entry.acceptedSuggestions,
      charactersSaved: entry.charactersSaved,
      estimatedMinutesSaved: estimateMinutesSaved(entry.acceptedSuggestions, entry.charactersSaved),
    });
  }

  return points;
}

export function pruneDailyBuckets(daily: Record<string, DailyProductivityState>): void {
  const keys = Object.keys(daily).sort();
  if (keys.length <= MAX_DAILY_BUCKETS) {
    return;
  }

  for (const key of keys.slice(0, keys.length - MAX_DAILY_BUCKETS)) {
    delete daily[key];
  }
}

export function getMilestoneProgress(
  lifetimeMinutesSaved: number,
): ProductivityDashboardStats["milestoneProgress"] {
  const lifetimeHoursSaved = sanitizer.roundMetric(lifetimeMinutesSaved / 60);
  const highestDefinedMilestone = DONATION_MILESTONE_HOURS[DONATION_MILESTONE_HOURS.length - 1];
  // Past the highest milestone, every 5 hours is a step.
  const previousMilestoneHours =
    lifetimeHoursSaved >= highestDefinedMilestone
      ? Math.max(highestDefinedMilestone, Math.floor(lifetimeHoursSaved / 5) * 5)
      : [...DONATION_MILESTONE_HOURS]
          .reverse()
          .find((milestone) => lifetimeHoursSaved >= milestone) || 0;
  const nextMilestoneHours =
    DONATION_MILESTONE_HOURS.find((milestone) => lifetimeHoursSaved < milestone) ??
    previousMilestoneHours + 5;

  const progressRaw =
    ((lifetimeHoursSaved - previousMilestoneHours) /
      (nextMilestoneHours - previousMilestoneHours)) *
    100;
  const progressPct = clamp(Math.round(progressRaw), 0, 100);

  return {
    previousMilestoneHours,
    nextMilestoneHours,
    progressPct,
    lifetimeHoursSaved,
  };
}
