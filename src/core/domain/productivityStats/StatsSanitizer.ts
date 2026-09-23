import { isObjectRecord } from "@core/domain/guards";
import { DONATION_MILESTONE_HOURS, STATS_SCHEMA_VERSION } from "./constants";
import type {
  DailyProductivityState,
  LanguageUsageCounters,
  ProductivityStatsState,
  SnippetUsageCounters,
} from "./types";

export class StatsSanitizer {
  clampCount(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.round(value));
  }

  roundMetric(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.round(Math.max(0, value) * 10) / 10;
  }

  normalizeSnippetKey(value: unknown): string {
    return (typeof value === "string" ? value.trim() : "").toLocaleLowerCase().slice(0, 80);
  }

  normalizeLanguageKey(value: unknown): string {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      return "unknown";
    }
    return normalized.slice(0, 32);
  }

  parseIsoDate(value: unknown): Date | null {
    if (typeof value !== "string") {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  toLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  startOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  addDays(date: Date, days: number): Date {
    const next = this.startOfLocalDay(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  addDaysFromDateTime(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  getWeekStart(date: Date): Date {
    const start = this.startOfLocalDay(date);
    const day = start.getDay();
    const dayOffset = day === 0 ? -6 : 1 - day;
    return this.addDays(start, dayOffset);
  }

  createSnippetCounters(): SnippetUsageCounters {
    return {
      count: 0,
      charactersSaved: 0,
      charsInserted: 0,
      charsTyped: 0,
    };
  }

  createDailyState(): DailyProductivityState {
    return {
      acceptedSuggestions: 0,
      charactersSaved: 0,
      suggestionsShown: 0,
      snippetsExpanded: 0,
      charsInsertedFromSnippet: 0,
      charsTypedForTrigger: 0,
      snippetUsage: {},
      languageUsage: {},
    };
  }

  createDefaultStatsState(): ProductivityStatsState {
    return {
      schemaVersion: STATS_SCHEMA_VERSION,
      ...this.createDailyState(),
      daily: {},
      shownMilestones: [],
      firstValuePromptAcknowledged: false,
      lastWeeklyRecapWeek: null,
      lastDonationPromptAt: null,
      donationSnoozedUntil: null,
    };
  }

  sanitizeLanguageUsageMap(value: unknown): Record<string, LanguageUsageCounters> {
    if (!isObjectRecord(value)) {
      return {};
    }

    const sanitized: Record<string, LanguageUsageCounters> = {};
    for (const [language, counters] of Object.entries(value)) {
      const normalizedLanguage = this.normalizeLanguageKey(language);
      if (!isObjectRecord(counters)) {
        continue;
      }
      const acceptedSuggestions = this.clampCount(counters.acceptedSuggestions);
      const charactersSaved = this.clampCount(counters.charactersSaved);
      if (acceptedSuggestions === 0 && charactersSaved === 0) {
        continue;
      }
      sanitized[normalizedLanguage] = {
        acceptedSuggestions,
        charactersSaved,
      };
    }

    return sanitized;
  }

  sanitizeSnippetUsageMap(value: unknown): Record<string, SnippetUsageCounters> {
    if (!isObjectRecord(value)) {
      return {};
    }

    const sanitized: Record<string, SnippetUsageCounters> = {};
    for (const [key, rawValue] of Object.entries(value)) {
      const normalizedKey = this.normalizeSnippetKey(key);
      if (!normalizedKey) {
        continue;
      }

      // A bare number carries only the use count.
      const counters: SnippetUsageCounters =
        typeof rawValue === "number"
          ? { ...this.createSnippetCounters(), count: this.clampCount(rawValue) }
          : isObjectRecord(rawValue)
            ? {
                count: this.clampCount(rawValue.count),
                charactersSaved: this.clampCount(rawValue.charactersSaved),
                charsInserted: this.clampCount(rawValue.charsInserted),
                charsTyped: this.clampCount(rawValue.charsTyped),
              }
            : this.createSnippetCounters();
      if (Object.values(counters).some((counter) => counter > 0)) {
        sanitized[normalizedKey] = counters;
      }
    }

    return sanitized;
  }

  sanitizeDailyMap(value: unknown): Record<string, DailyProductivityState> {
    if (!isObjectRecord(value)) {
      return {};
    }

    const sanitized: Record<string, DailyProductivityState> = {};
    for (const [dateKey, entry] of Object.entries(value)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !isObjectRecord(entry)) {
        continue;
      }

      const day: DailyProductivityState = {
        acceptedSuggestions: this.clampCount(entry.acceptedSuggestions),
        charactersSaved: this.clampCount(entry.charactersSaved),
        suggestionsShown: this.clampCount(entry.suggestionsShown),
        snippetsExpanded: this.clampCount(entry.snippetsExpanded),
        charsInsertedFromSnippet: this.clampCount(entry.charsInsertedFromSnippet),
        charsTypedForTrigger: this.clampCount(entry.charsTypedForTrigger),
        snippetUsage: this.sanitizeSnippetUsageMap(entry.snippetUsage),
        languageUsage: this.sanitizeLanguageUsageMap(entry.languageUsage),
      };
      const { snippetUsage, languageUsage, ...counts } = day;
      if (
        Object.values(counts).some((count) => count > 0) ||
        Object.keys(snippetUsage).length > 0 ||
        Object.keys(languageUsage).length > 0
      ) {
        sanitized[dateKey] = day;
      }
    }

    return sanitized;
  }

  sanitizeStatsState(value: unknown): ProductivityStatsState {
    if (!isObjectRecord(value)) {
      return this.createDefaultStatsState();
    }

    const lastDonationPromptAt = this.parseIsoDate(value.lastDonationPromptAt);
    const donationSnoozedUntil = this.parseIsoDate(value.donationSnoozedUntil);

    return {
      schemaVersion: STATS_SCHEMA_VERSION,
      acceptedSuggestions: this.clampCount(value.acceptedSuggestions),
      charactersSaved: this.clampCount(value.charactersSaved),
      suggestionsShown: this.clampCount(value.suggestionsShown),
      snippetsExpanded: this.clampCount(value.snippetsExpanded),
      charsInsertedFromSnippet: this.clampCount(value.charsInsertedFromSnippet),
      charsTypedForTrigger: this.clampCount(value.charsTypedForTrigger),
      snippetUsage: this.sanitizeSnippetUsageMap(value.snippetUsage),
      languageUsage: this.sanitizeLanguageUsageMap(value.languageUsage),
      daily: this.sanitizeDailyMap(value.daily),
      shownMilestones: Array.isArray(value.shownMilestones)
        ? value.shownMilestones
            .map((milestone) => this.clampCount(milestone))
            .filter((milestone) => DONATION_MILESTONE_HOURS.includes(milestone))
        : [],
      firstValuePromptAcknowledged: value.firstValuePromptAcknowledged === true,
      lastWeeklyRecapWeek:
        typeof value.lastWeeklyRecapWeek === "string" ? value.lastWeeklyRecapWeek : null,
      lastDonationPromptAt: lastDonationPromptAt ? (value.lastDonationPromptAt as string) : null,
      donationSnoozedUntil: donationSnoozedUntil ? (value.donationSnoozedUntil as string) : null,
    };
  }
}
