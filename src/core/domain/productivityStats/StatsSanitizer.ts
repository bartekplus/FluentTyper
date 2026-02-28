import { DONATION_MILESTONE_HOURS, STATS_SCHEMA_VERSION } from "./constants";
import type {
  DailyProductivityState,
  LanguageUsageCounters,
  ProductivityStatsState,
  SnippetUsageCounters,
} from "./types";

export class StatsSanitizer {
  isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

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
    if (typeof value !== "string") {
      return "";
    }
    return value.trim().toLocaleLowerCase().slice(0, 80);
  }

  normalizeLanguageKey(value: unknown): string {
    if (typeof value !== "string") {
      return "unknown";
    }
    const normalized = value.trim();
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
      acceptedSuggestions: 0,
      charactersSaved: 0,
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
    };
  }

  sanitizeLanguageUsageMap(
    value: unknown,
  ): Record<string, LanguageUsageCounters> {
    if (!this.isObjectRecord(value)) {
      return {};
    }

    const sanitized: Record<string, LanguageUsageCounters> = {};
    for (const [language, counters] of Object.entries(value)) {
      const normalizedLanguage = this.normalizeLanguageKey(language);
      if (!this.isObjectRecord(counters)) {
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

  sanitizeSnippetUsageMap(
    value: unknown,
  ): Record<string, SnippetUsageCounters> {
    if (!this.isObjectRecord(value)) {
      return {};
    }

    const sanitized: Record<string, SnippetUsageCounters> = {};
    for (const [key, rawValue] of Object.entries(value)) {
      const normalizedKey = this.normalizeSnippetKey(key);
      if (!normalizedKey) {
        continue;
      }

      let counters: SnippetUsageCounters | null = null;
      if (typeof rawValue === "number") {
        const count = this.clampCount(rawValue);
        if (count > 0) {
          counters = {
            count,
            charactersSaved: 0,
            charsInserted: 0,
            charsTyped: 0,
          };
        }
      } else if (this.isObjectRecord(rawValue)) {
        const count = this.clampCount(rawValue.count);
        const charactersSaved = this.clampCount(rawValue.charactersSaved);
        const charsInserted = this.clampCount(rawValue.charsInserted);
        const charsTyped = this.clampCount(rawValue.charsTyped);
        if (
          count > 0 ||
          charactersSaved > 0 ||
          charsInserted > 0 ||
          charsTyped > 0
        ) {
          counters = {
            count,
            charactersSaved,
            charsInserted,
            charsTyped,
          };
        }
      }

      if (counters) {
        sanitized[normalizedKey] = counters;
      }
    }

    return sanitized;
  }

  sanitizeDailyMap(value: unknown): Record<string, DailyProductivityState> {
    if (!this.isObjectRecord(value)) {
      return {};
    }

    const sanitized: Record<string, DailyProductivityState> = {};
    for (const [dateKey, entry] of Object.entries(value)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !this.isObjectRecord(entry)) {
        continue;
      }

      const acceptedSuggestions = this.clampCount(entry.acceptedSuggestions);
      const charactersSaved = this.clampCount(entry.charactersSaved);
      const suggestionsShown = this.clampCount(entry.suggestionsShown);
      const snippetsExpanded = this.clampCount(entry.snippetsExpanded);
      const charsInsertedFromSnippet = this.clampCount(
        entry.charsInsertedFromSnippet,
      );
      const charsTypedForTrigger = this.clampCount(entry.charsTypedForTrigger);
      const snippetUsage = this.sanitizeSnippetUsageMap(entry.snippetUsage);
      const languageUsage = this.sanitizeLanguageUsageMap(entry.languageUsage);

      if (
        acceptedSuggestions === 0 &&
        charactersSaved === 0 &&
        suggestionsShown === 0 &&
        snippetsExpanded === 0 &&
        charsInsertedFromSnippet === 0 &&
        charsTypedForTrigger === 0 &&
        Object.keys(snippetUsage).length === 0 &&
        Object.keys(languageUsage).length === 0
      ) {
        continue;
      }

      sanitized[dateKey] = {
        acceptedSuggestions,
        charactersSaved,
        suggestionsShown,
        snippetsExpanded,
        charsInsertedFromSnippet,
        charsTypedForTrigger,
        snippetUsage,
        languageUsage,
      };
    }

    return sanitized;
  }

  sanitizeStatsState(value: unknown): ProductivityStatsState {
    if (!this.isObjectRecord(value)) {
      return this.createDefaultStatsState();
    }

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
        typeof value.lastWeeklyRecapWeek === "string"
          ? value.lastWeeklyRecapWeek
          : null,
      lastDonationPromptAt: this.parseIsoDate(value.lastDonationPromptAt)
        ? (value.lastDonationPromptAt as string)
        : null,
      donationSnoozedUntil: this.parseIsoDate(value.donationSnoozedUntil)
        ? (value.donationSnoozedUntil as string)
        : null,
    };
  }
}
