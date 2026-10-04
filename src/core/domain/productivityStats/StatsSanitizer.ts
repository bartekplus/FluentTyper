import { isFiniteNumber, isObjectRecord } from "@core/domain/guards";
import { DONATION_MILESTONE_HOURS, STATS_SCHEMA_VERSION } from "./constants";
import type {
  DailyProductivityState,
  LanguageUsageCounters,
  ProductivityStatsState,
  SnippetUsageCounters,
} from "./types";

export function clampCount(value: unknown): number {
  if (!isFiniteNumber(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

export function roundMetric(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(Math.max(0, value) * 10) / 10;
}

export function normalizeSnippetKey(value: unknown): string {
  return (typeof value === "string" ? value.trim() : "").toLocaleLowerCase().slice(0, 80);
}

export function normalizeLanguageKey(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "unknown";
  }
  return normalized.slice(0, 32);
}

export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = startOfLocalDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addDaysFromDateTime(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getWeekStart(date: Date): Date {
  const start = startOfLocalDay(date);
  const day = start.getDay();
  const dayOffset = day === 0 ? -6 : 1 - day;
  return addDays(start, dayOffset);
}

export function createSnippetCounters(): SnippetUsageCounters {
  return {
    count: 0,
    charactersSaved: 0,
    charsInserted: 0,
    charsTyped: 0,
  };
}

export function createDailyState(): DailyProductivityState {
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

export function createDefaultStatsState(): ProductivityStatsState {
  return {
    schemaVersion: STATS_SCHEMA_VERSION,
    ...createDailyState(),
    daily: {},
    shownMilestones: [],
    firstValuePromptAcknowledged: false,
    lastWeeklyRecapWeek: null,
    lastDonationPromptAt: null,
    donationPromptsDisabled: false,
    donationSnoozedUntil: null,
  };
}

export function sanitizeLanguageUsageMap(value: unknown): Record<string, LanguageUsageCounters> {
  if (!isObjectRecord(value)) {
    return {};
  }

  const sanitized: Record<string, LanguageUsageCounters> = {};
  for (const [language, counters] of Object.entries(value)) {
    const normalizedLanguage = normalizeLanguageKey(language);
    if (!isObjectRecord(counters)) {
      continue;
    }
    const acceptedSuggestions = clampCount(counters.acceptedSuggestions);
    const charactersSaved = clampCount(counters.charactersSaved);
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

export function sanitizeSnippetUsageMap(value: unknown): Record<string, SnippetUsageCounters> {
  if (!isObjectRecord(value)) {
    return {};
  }

  const sanitized: Record<string, SnippetUsageCounters> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = normalizeSnippetKey(key);
    if (!normalizedKey) {
      continue;
    }

    // A bare number carries only the use count.
    const counters: SnippetUsageCounters =
      typeof rawValue === "number"
        ? { ...createSnippetCounters(), count: clampCount(rawValue) }
        : isObjectRecord(rawValue)
          ? {
              count: clampCount(rawValue.count),
              charactersSaved: clampCount(rawValue.charactersSaved),
              charsInserted: clampCount(rawValue.charsInserted),
              charsTyped: clampCount(rawValue.charsTyped),
            }
          : createSnippetCounters();
    if (Object.values(counters).some((counter) => counter > 0)) {
      sanitized[normalizedKey] = counters;
    }
  }

  return sanitized;
}

function sanitizeDay(entry: Record<string, unknown>): DailyProductivityState {
  return {
    acceptedSuggestions: clampCount(entry.acceptedSuggestions),
    charactersSaved: clampCount(entry.charactersSaved),
    suggestionsShown: clampCount(entry.suggestionsShown),
    snippetsExpanded: clampCount(entry.snippetsExpanded),
    charsInsertedFromSnippet: clampCount(entry.charsInsertedFromSnippet),
    charsTypedForTrigger: clampCount(entry.charsTypedForTrigger),
    snippetUsage: sanitizeSnippetUsageMap(entry.snippetUsage),
    languageUsage: sanitizeLanguageUsageMap(entry.languageUsage),
  };
}

export function sanitizeDailyMap(value: unknown): Record<string, DailyProductivityState> {
  if (!isObjectRecord(value)) {
    return {};
  }

  const sanitized: Record<string, DailyProductivityState> = {};
  for (const [dateKey, entry] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !isObjectRecord(entry)) {
      continue;
    }

    const day = sanitizeDay(entry);
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

export function sanitizeStatsState(value: unknown): ProductivityStatsState {
  if (!isObjectRecord(value)) {
    return createDefaultStatsState();
  }

  const lastDonationPromptAt = parseIsoDate(value.lastDonationPromptAt);
  const donationSnoozedUntil = parseIsoDate(value.donationSnoozedUntil);

  return {
    schemaVersion: STATS_SCHEMA_VERSION,
    ...sanitizeDay(value),
    daily: sanitizeDailyMap(value.daily),
    shownMilestones: Array.isArray(value.shownMilestones)
      ? value.shownMilestones
          .map((milestone) => clampCount(milestone))
          .filter((milestone) => DONATION_MILESTONE_HOURS.includes(milestone))
      : [],
    firstValuePromptAcknowledged: value.firstValuePromptAcknowledged === true,
    lastWeeklyRecapWeek:
      typeof value.lastWeeklyRecapWeek === "string" ? value.lastWeeklyRecapWeek : null,
    lastDonationPromptAt: lastDonationPromptAt ? (value.lastDonationPromptAt as string) : null,
    donationPromptsDisabled: value.donationPromptsDisabled === true,
    donationSnoozedUntil: donationSnoozedUntil ? (value.donationSnoozedUntil as string) : null,
  };
}
