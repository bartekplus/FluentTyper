import type {
  LanguageUsageSummary,
  ProductivityDashboardStats,
  ProductivityEventSummary,
  ProductivityMetricSummary,
  TopSnippetUsage,
} from "@core/domain/messageTypes";
import {
  ACCEPTANCE_BONUS_SECONDS,
  DONATION_MILESTONE_HOURS,
  MAX_DAILY_BUCKETS,
  TYPING_CHARACTERS_PER_MINUTE,
} from "./constants";
import type { StatsSanitizer } from "./StatsSanitizer";
import type {
  AggregatedCounters,
  DailyProductivityState,
  LanguageUsageCounters,
  SnippetUsageCounters,
} from "./types";

export class StatsAggregator {
  constructor(private readonly sanitizer: StatsSanitizer) {}

  estimateMinutesSaved(acceptedSuggestions: number, charactersSaved: number): number {
    const typingMinutes = charactersSaved / TYPING_CHARACTERS_PER_MINUTE;
    const acceptanceMinutes = (acceptedSuggestions * ACCEPTANCE_BONUS_SECONDS) / 60;
    return this.sanitizer.roundMetric(typingMinutes + acceptanceMinutes);
  }

  metricsFromCounters(
    acceptedSuggestions: number,
    charactersSaved: number,
  ): ProductivityMetricSummary {
    return {
      acceptedSuggestions,
      charactersSaved,
      estimatedMinutesSaved: this.estimateMinutesSaved(acceptedSuggestions, charactersSaved),
    };
  }

  eventsFromCounters(
    suggestionsShown: number,
    snippetsExpanded: number,
    charsInsertedFromSnippet: number,
    charsTypedForTrigger: number,
  ): ProductivityEventSummary {
    return {
      suggestionsShown,
      snippetsExpanded,
      charsInsertedFromSnippet,
      charsTypedForTrigger,
    };
  }

  incrementSnippetUsageCounter(
    usageMap: Record<string, SnippetUsageCounters>,
    snippet: string,
    update: {
      countDelta?: number;
      charsSavedDelta?: number;
      charsInsertedDelta?: number;
      charsTypedDelta?: number;
    },
  ): void {
    if (!usageMap[snippet]) {
      usageMap[snippet] = this.sanitizer.createSnippetCounters();
    }

    usageMap[snippet].count += update.countDelta || 0;
    usageMap[snippet].charactersSaved += update.charsSavedDelta || 0;
    usageMap[snippet].charsInserted += update.charsInsertedDelta || 0;
    usageMap[snippet].charsTyped += update.charsTypedDelta || 0;
  }

  incrementLanguageUsageCounter(
    usageMap: Record<string, LanguageUsageCounters>,
    language: string,
    charactersSaved: number,
  ): void {
    if (!usageMap[language]) {
      usageMap[language] = {
        acceptedSuggestions: 0,
        charactersSaved: 0,
      };
    }

    usageMap[language].acceptedSuggestions += 1;
    usageMap[language].charactersSaved += charactersSaved;
  }

  aggregateRange(
    daily: Record<string, DailyProductivityState>,
    start: Date,
    end: Date,
  ): AggregatedCounters {
    const counters: AggregatedCounters = {
      acceptedSuggestions: 0,
      charactersSaved: 0,
      suggestionsShown: 0,
      snippetsExpanded: 0,
      charsInsertedFromSnippet: 0,
      charsTypedForTrigger: 0,
      snippetUsage: {},
      languageUsage: {},
    };

    const cursor = this.sanitizer.startOfLocalDay(start);
    const endKey = this.sanitizer.toLocalDateKey(end);

    while (this.sanitizer.toLocalDateKey(cursor) <= endKey) {
      const entry = daily[this.sanitizer.toLocalDateKey(cursor)];
      if (entry) {
        counters.acceptedSuggestions += entry.acceptedSuggestions;
        counters.charactersSaved += entry.charactersSaved;
        counters.suggestionsShown += entry.suggestionsShown;
        counters.snippetsExpanded += entry.snippetsExpanded;
        counters.charsInsertedFromSnippet += entry.charsInsertedFromSnippet;
        counters.charsTypedForTrigger += entry.charsTypedForTrigger;

        for (const [snippet, snippetCounters] of Object.entries(entry.snippetUsage)) {
          this.incrementSnippetUsageCounter(counters.snippetUsage, snippet, {
            countDelta: snippetCounters.count,
            charsSavedDelta: snippetCounters.charactersSaved,
            charsInsertedDelta: snippetCounters.charsInserted,
            charsTypedDelta: snippetCounters.charsTyped,
          });
        }

        for (const [language, values] of Object.entries(entry.languageUsage)) {
          if (!counters.languageUsage[language]) {
            counters.languageUsage[language] = {
              acceptedSuggestions: 0,
              charactersSaved: 0,
            };
          }
          counters.languageUsage[language].acceptedSuggestions += values.acceptedSuggestions;
          counters.languageUsage[language].charactersSaved += values.charactersSaved;
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    return counters;
  }

  aggregateThroughDate(
    daily: Record<string, DailyProductivityState>,
    endDate: Date,
  ): Pick<AggregatedCounters, "acceptedSuggestions" | "charactersSaved"> {
    let acceptedSuggestions = 0;
    let charactersSaved = 0;
    const endKey = this.sanitizer.toLocalDateKey(endDate);

    for (const [dateKey, entry] of Object.entries(daily)) {
      if (dateKey > endKey) {
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

  getTopSnippets(usageMap: Record<string, SnippetUsageCounters>, limit: number): TopSnippetUsage[] {
    return Object.entries(usageMap)
      .map(([snippet, counters]) => ({
        snippet,
        count: counters.count,
        charactersSaved: counters.charactersSaved,
        estimatedMinutesSaved: this.estimateMinutesSaved(counters.count, counters.charactersSaved),
      }))
      .sort((left, right) => {
        if (right.estimatedMinutesSaved === left.estimatedMinutesSaved) {
          if (right.count === left.count) {
            return left.snippet.localeCompare(right.snippet);
          }
          return right.count - left.count;
        }
        return right.estimatedMinutesSaved - left.estimatedMinutesSaved;
      })
      .slice(0, limit);
  }

  getLanguageSummaries(usageMap: Record<string, LanguageUsageCounters>): LanguageUsageSummary[] {
    return Object.entries(usageMap)
      .map(([language, counters]) => ({
        language,
        acceptedSuggestions: counters.acceptedSuggestions,
        charactersSaved: counters.charactersSaved,
        estimatedMinutesSaved: this.estimateMinutesSaved(
          counters.acceptedSuggestions,
          counters.charactersSaved,
        ),
      }))
      .sort((left, right) => {
        if (right.estimatedMinutesSaved === left.estimatedMinutesSaved) {
          if (right.acceptedSuggestions === left.acceptedSuggestions) {
            return left.language.localeCompare(right.language);
          }
          return right.acceptedSuggestions - left.acceptedSuggestions;
        }
        return right.estimatedMinutesSaved - left.estimatedMinutesSaved;
      });
  }

  getLast7DayTrend(
    daily: Record<string, DailyProductivityState>,
    now: Date,
  ): ProductivityDashboardStats["last7DaysTrend"] {
    const points: ProductivityDashboardStats["last7DaysTrend"] = [];
    const start = this.sanitizer.addDays(now, -6);
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const dayDate = this.sanitizer.addDays(start, dayOffset);
      const dayKey = this.sanitizer.toLocalDateKey(dayDate);
      const entry = daily[dayKey] || this.sanitizer.createDailyState();
      points.push({
        dateKey: dayKey,
        acceptedSuggestions: entry.acceptedSuggestions,
        charactersSaved: entry.charactersSaved,
        estimatedMinutesSaved: this.estimateMinutesSaved(
          entry.acceptedSuggestions,
          entry.charactersSaved,
        ),
      });
    }

    return points;
  }

  pruneDailyBuckets(daily: Record<string, DailyProductivityState>): void {
    const keys = Object.keys(daily).sort();
    if (keys.length <= MAX_DAILY_BUCKETS) {
      return;
    }

    const removeCount = keys.length - MAX_DAILY_BUCKETS;
    for (let index = 0; index < removeCount; index += 1) {
      delete daily[keys[index]];
    }
  }

  getMilestoneProgress(
    lifetimeMinutesSaved: number,
  ): ProductivityDashboardStats["milestoneProgress"] {
    const lifetimeHoursSaved = this.sanitizer.roundMetric(lifetimeMinutesSaved / 60);
    const previousMilestoneHours =
      DONATION_MILESTONE_HOURS.filter((milestone) => lifetimeHoursSaved >= milestone).sort(
        (left, right) => right - left,
      )[0] || 0;

    let nextMilestoneHours =
      DONATION_MILESTONE_HOURS.find((milestone) => lifetimeHoursSaved < milestone) ||
      Math.max(
        DONATION_MILESTONE_HOURS[DONATION_MILESTONE_HOURS.length - 1] + 5,
        Math.ceil(lifetimeHoursSaved / 5) * 5,
      );

    if (nextMilestoneHours <= previousMilestoneHours) {
      nextMilestoneHours = previousMilestoneHours + 5;
    }

    const denominator = nextMilestoneHours - previousMilestoneHours;
    const progressRaw =
      denominator > 0 ? ((lifetimeHoursSaved - previousMilestoneHours) / denominator) * 100 : 100;
    const progressPct = Math.max(0, Math.min(100, Math.round(progressRaw)));

    return {
      previousMilestoneHours,
      nextMilestoneHours,
      progressPct,
      lifetimeHoursSaved,
    };
  }
}
