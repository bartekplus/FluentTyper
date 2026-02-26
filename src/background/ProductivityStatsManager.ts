import { KEY_PRODUCTIVITY_STATS } from "../shared/constants";
import { JsonValue, SettingsManager } from "../shared/settingsManager";
import {
  ContentScriptUsageEventContext,
  DonationPromptSummary,
  LanguageUsageSummary,
  ProductivityDashboardStats,
  ProductivityMetricSummary,
  TopSnippetUsage,
  WeeklyRecapSummary,
} from "../shared/messageTypes";

interface LanguageUsageCounters {
  acceptedSuggestions: number;
  charactersSaved: number;
}

interface DailyProductivityState {
  acceptedSuggestions: number;
  charactersSaved: number;
  snippetUsage: Record<string, number>;
  languageUsage: Record<string, LanguageUsageCounters>;
}

interface ProductivityStatsState {
  schemaVersion: 1;
  acceptedSuggestions: number;
  charactersSaved: number;
  snippetUsage: Record<string, number>;
  languageUsage: Record<string, LanguageUsageCounters>;
  daily: Record<string, DailyProductivityState>;
  shownMilestones: number[];
  lastWeeklyRecapWeek: string | null;
}

interface AggregatedCounters {
  acceptedSuggestions: number;
  charactersSaved: number;
  snippetUsage: Record<string, number>;
  languageUsage: Record<string, LanguageUsageCounters>;
}

const STATS_SCHEMA_VERSION = 1;
const DONATION_MILESTONE_HOURS = [1, 5, 10, 25];
const TYPING_CHARACTERS_PER_MINUTE = 240;
const ACCEPTANCE_BONUS_SECONDS = 0.8;
const MAX_DAILY_BUCKETS = 400;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(Math.max(0, value) * 10) / 10;
}

function normalizeSnippetKey(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLocaleLowerCase().slice(0, 80);
}

function normalizeLanguageKey(value: unknown): string {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.trim();
  if (!normalized) {
    return "unknown";
  }
  return normalized.slice(0, 32);
}

function createDailyState(): DailyProductivityState {
  return {
    acceptedSuggestions: 0,
    charactersSaved: 0,
    snippetUsage: {},
    languageUsage: {},
  };
}

function createDefaultStatsState(): ProductivityStatsState {
  return {
    schemaVersion: STATS_SCHEMA_VERSION,
    acceptedSuggestions: 0,
    charactersSaved: 0,
    snippetUsage: {},
    languageUsage: {},
    daily: {},
    shownMilestones: [],
    lastWeeklyRecapWeek: null,
  };
}

function sanitizeLanguageUsageMap(
  value: unknown,
): Record<string, LanguageUsageCounters> {
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

function sanitizeUsageMap(value: unknown): Record<string, number> {
  if (!isObjectRecord(value)) {
    return {};
  }
  const sanitized: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    const normalizedKey = normalizeSnippetKey(key);
    if (!normalizedKey) {
      continue;
    }
    const normalizedCount = clampCount(count);
    if (normalizedCount > 0) {
      sanitized[normalizedKey] = normalizedCount;
    }
  }
  return sanitized;
}

function sanitizeDailyMap(
  value: unknown,
): Record<string, DailyProductivityState> {
  if (!isObjectRecord(value)) {
    return {};
  }
  const sanitized: Record<string, DailyProductivityState> = {};
  for (const [dateKey, entry] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !isObjectRecord(entry)) {
      continue;
    }
    const acceptedSuggestions = clampCount(entry.acceptedSuggestions);
    const charactersSaved = clampCount(entry.charactersSaved);
    const snippetUsage = sanitizeUsageMap(entry.snippetUsage);
    const languageUsage = sanitizeLanguageUsageMap(entry.languageUsage);
    if (
      acceptedSuggestions === 0 &&
      charactersSaved === 0 &&
      Object.keys(snippetUsage).length === 0 &&
      Object.keys(languageUsage).length === 0
    ) {
      continue;
    }
    sanitized[dateKey] = {
      acceptedSuggestions,
      charactersSaved,
      snippetUsage,
      languageUsage,
    };
  }
  return sanitized;
}

function sanitizeStatsState(value: unknown): ProductivityStatsState {
  if (!isObjectRecord(value)) {
    return createDefaultStatsState();
  }
  const normalized: ProductivityStatsState = {
    schemaVersion: STATS_SCHEMA_VERSION,
    acceptedSuggestions: clampCount(value.acceptedSuggestions),
    charactersSaved: clampCount(value.charactersSaved),
    snippetUsage: sanitizeUsageMap(value.snippetUsage),
    languageUsage: sanitizeLanguageUsageMap(value.languageUsage),
    daily: sanitizeDailyMap(value.daily),
    shownMilestones: Array.isArray(value.shownMilestones)
      ? value.shownMilestones
          .map((milestone) => clampCount(milestone))
          .filter((milestone) => DONATION_MILESTONE_HOURS.includes(milestone))
      : [],
    lastWeeklyRecapWeek:
      typeof value.lastWeeklyRecapWeek === "string"
        ? value.lastWeeklyRecapWeek
        : null,
  };
  return normalized;
}

function estimateMinutesSaved(
  acceptedSuggestions: number,
  charactersSaved: number,
): number {
  const typingMinutes = charactersSaved / TYPING_CHARACTERS_PER_MINUTE;
  const acceptanceMinutes = (acceptedSuggestions * ACCEPTANCE_BONUS_SECONDS) / 60;
  return roundMetric(typingMinutes + acceptanceMinutes);
}

function metricsFromCounters(
  acceptedSuggestions: number,
  charactersSaved: number,
): ProductivityMetricSummary {
  return {
    acceptedSuggestions,
    charactersSaved,
    estimatedMinutesSaved: estimateMinutesSaved(
      acceptedSuggestions,
      charactersSaved,
    ),
  };
}

function incrementUsageCounter(
  usageMap: Record<string, number>,
  snippet: string,
): void {
  usageMap[snippet] = (usageMap[snippet] || 0) + 1;
}

function incrementLanguageUsageCounter(
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

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = startOfLocalDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getWeekStart(date: Date): Date {
  const start = startOfLocalDay(date);
  const day = start.getDay();
  const dayOffset = day === 0 ? -6 : 1 - day;
  return addDays(start, dayOffset);
}

function aggregateRange(
  daily: Record<string, DailyProductivityState>,
  start: Date,
  end: Date,
): AggregatedCounters {
  const counters: AggregatedCounters = {
    acceptedSuggestions: 0,
    charactersSaved: 0,
    snippetUsage: {},
    languageUsage: {},
  };
  const cursor = startOfLocalDay(start);
  const endKey = toLocalDateKey(end);
  while (toLocalDateKey(cursor) <= endKey) {
    const entry = daily[toLocalDateKey(cursor)];
    if (entry) {
      counters.acceptedSuggestions += entry.acceptedSuggestions;
      counters.charactersSaved += entry.charactersSaved;
      for (const [snippet, count] of Object.entries(entry.snippetUsage)) {
        counters.snippetUsage[snippet] =
          (counters.snippetUsage[snippet] || 0) + count;
      }
      for (const [language, values] of Object.entries(entry.languageUsage)) {
        if (!counters.languageUsage[language]) {
          counters.languageUsage[language] = {
            acceptedSuggestions: 0,
            charactersSaved: 0,
          };
        }
        counters.languageUsage[language].acceptedSuggestions +=
          values.acceptedSuggestions;
        counters.languageUsage[language].charactersSaved +=
          values.charactersSaved;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return counters;
}

function getTopSnippets(
  usageMap: Record<string, number>,
  limit: number,
): TopSnippetUsage[] {
  return Object.entries(usageMap)
    .sort((left, right) => {
      if (right[1] === left[1]) {
        return left[0].localeCompare(right[0]);
      }
      return right[1] - left[1];
    })
    .slice(0, limit)
    .map(([snippet, count]) => ({ snippet, count }));
}

function getLanguageSummaries(
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

function summarizeWeek(
  daily: Record<string, DailyProductivityState>,
  weekStart: Date,
): WeeklyRecapSummary {
  const weekEnd = addDays(weekStart, 6);
  const aggregated = aggregateRange(daily, weekStart, weekEnd);
  const topSnippet = getTopSnippets(aggregated.snippetUsage, 1)[0] || null;
  return {
    weekKey: toLocalDateKey(weekStart),
    acceptedSuggestions: aggregated.acceptedSuggestions,
    charactersSaved: aggregated.charactersSaved,
    estimatedMinutesSaved: estimateMinutesSaved(
      aggregated.acceptedSuggestions,
      aggregated.charactersSaved,
    ),
    topSnippet,
  };
}

function pruneDailyBuckets(daily: Record<string, DailyProductivityState>): void {
  const keys = Object.keys(daily).sort();
  if (keys.length <= MAX_DAILY_BUCKETS) {
    return;
  }
  const removeCount = keys.length - MAX_DAILY_BUCKETS;
  for (let index = 0; index < removeCount; index += 1) {
    delete daily[keys[index]];
  }
}

function toDonationPrompt(
  state: ProductivityStatsState,
  lifetimeMinutesSaved: number,
): DonationPromptSummary | null {
  const savedHours = lifetimeMinutesSaved / 60;
  const nextMilestone = DONATION_MILESTONE_HOURS.find(
    (milestone) =>
      savedHours >= milestone && !state.shownMilestones.includes(milestone),
  );
  if (!nextMilestone) {
    return null;
  }
  const hoursLabel = nextMilestone === 1 ? "hour" : "hours";
  const ordinal = toOrdinal(nextMilestone);
  return {
    milestoneHours: nextMilestone,
    message: `You just saved your ${ordinal} ${hoursLabel}. Buy the dev a coffee?`,
  };
}

function toOrdinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`;
  }
  const mod10 = value % 10;
  if (mod10 === 1) {
    return `${value}st`;
  }
  if (mod10 === 2) {
    return `${value}nd`;
  }
  if (mod10 === 3) {
    return `${value}rd`;
  }
  return `${value}th`;
}

export class ProductivityStatsManager {
  private mutationQueue: Promise<void> = Promise.resolve();
  private snippetShortcuts: Set<string> = new Set<string>();
  private readonly now: () => Date;

  constructor(
    private readonly settingsManager: SettingsManager,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now || (() => new Date());
  }

  setSnippetShortcuts(textExpansions: unknown): void {
    if (!Array.isArray(textExpansions)) {
      this.snippetShortcuts = new Set<string>();
      return;
    }
    const shortcuts = textExpansions
      .map((entry) =>
        Array.isArray(entry) ? normalizeSnippetKey(entry[0]) : "",
      )
      .filter((shortcut) => shortcut.length > 0);
    this.snippetShortcuts = new Set(shortcuts);
  }

  async recordSuggestionAccepted(
    event: ContentScriptUsageEventContext,
  ): Promise<void> {
    if (event.eventType !== "suggestion_accepted") {
      return;
    }
    await this.enqueueMutation(async (state) => {
      const typedTextLength = clampCount(event.typedTextLength);
      const insertedTextLength = clampCount(event.insertedTextLength);
      const charactersSaved = Math.max(0, insertedTextLength - typedTextLength);
      const language = normalizeLanguageKey(event.language);

      state.acceptedSuggestions += 1;
      state.charactersSaved += charactersSaved;
      incrementLanguageUsageCounter(state.languageUsage, language, charactersSaved);

      const todayKey = toLocalDateKey(this.now());
      const todayBucket = state.daily[todayKey] || createDailyState();
      todayBucket.acceptedSuggestions += 1;
      todayBucket.charactersSaved += charactersSaved;
      incrementLanguageUsageCounter(
        todayBucket.languageUsage,
        language,
        charactersSaved,
      );

      const normalizedSnippetKey = normalizeSnippetKey(event.triggerText);
      if (
        normalizedSnippetKey &&
        this.snippetShortcuts.has(normalizedSnippetKey)
      ) {
        incrementUsageCounter(state.snippetUsage, normalizedSnippetKey);
        incrementUsageCounter(todayBucket.snippetUsage, normalizedSnippetKey);
      }

      state.daily[todayKey] = todayBucket;
      pruneDailyBuckets(state.daily);
    });
  }

  async getDashboardStats(): Promise<ProductivityDashboardStats> {
    await this.mutationQueue;
    const state = await this.loadState();
    const now = this.now();

    const todayKey = toLocalDateKey(now);
    const todayBucket = state.daily[todayKey] || createDailyState();
    const today = metricsFromCounters(
      todayBucket.acceptedSuggestions,
      todayBucket.charactersSaved,
    );

    const last7Range = aggregateRange(state.daily, addDays(now, -6), now);
    const last7Days = metricsFromCounters(
      last7Range.acceptedSuggestions,
      last7Range.charactersSaved,
    );

    const lifetime = metricsFromCounters(
      state.acceptedSuggestions,
      state.charactersSaved,
    );
    const perLanguageLifetime = getLanguageSummaries(state.languageUsage);
    const perLanguageLast7Days = getLanguageSummaries(last7Range.languageUsage);
    const topSnippets = getTopSnippets(state.snippetUsage, 5);

    const currentWeekStart = getWeekStart(now);
    const previousWeekStart = addDays(currentWeekStart, -7);
    const currentWeek = summarizeWeek(state.daily, currentWeekStart);
    const previousWeek = summarizeWeek(state.daily, previousWeekStart);
    const weeklyRecap = previousWeek;

    const weekOverWeekDeltaPct =
      previousWeek.estimatedMinutesSaved > 0
        ? Math.round(
            ((currentWeek.estimatedMinutesSaved -
              previousWeek.estimatedMinutesSaved) /
              previousWeek.estimatedMinutesSaved) *
              100,
          )
        : null;

    const shouldShowWeeklyRecap =
      weeklyRecap.acceptedSuggestions > 0 &&
      state.lastWeeklyRecapWeek !== weeklyRecap.weekKey;

    return {
      today,
      last7Days,
      lifetime,
      perLanguageLifetime,
      perLanguageLast7Days,
      topSnippets,
      weekOverWeekDeltaPct,
      weeklyRecap,
      shouldShowWeeklyRecap,
      donationPrompt: toDonationPrompt(state, lifetime.estimatedMinutesSaved),
    };
  }

  async acknowledgeWeeklyRecap(weekKey: string): Promise<void> {
    if (!weekKey) {
      return;
    }
    await this.enqueueMutation(async (state) => {
      state.lastWeeklyRecapWeek = weekKey;
    });
  }

  async acknowledgeDonationMilestone(milestoneHours: number): Promise<void> {
    const milestone = clampCount(milestoneHours);
    if (!DONATION_MILESTONE_HOURS.includes(milestone)) {
      return;
    }
    await this.enqueueMutation(async (state) => {
      if (state.shownMilestones.includes(milestone)) {
        return;
      }
      state.shownMilestones.push(milestone);
      state.shownMilestones.sort((left, right) => left - right);
    });
  }

  private async enqueueMutation(
    mutation: (state: ProductivityStatsState) => Promise<void>,
  ): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const state = await this.loadState();
      await mutation(state);
      await this.saveState(state);
    });
    this.mutationQueue = operation.catch((error: unknown) => {
      console.error("Failed to update productivity stats", error);
    });
    return operation;
  }

  private async loadState(): Promise<ProductivityStatsState> {
    const rawState = await this.settingsManager.get(KEY_PRODUCTIVITY_STATS);
    return sanitizeStatsState(rawState);
  }

  private async saveState(state: ProductivityStatsState): Promise<void> {
    await this.settingsManager.set(
      KEY_PRODUCTIVITY_STATS,
      state as unknown as JsonValue,
    );
  }
}
