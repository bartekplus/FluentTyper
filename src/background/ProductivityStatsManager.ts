import { KEY_PRODUCTIVITY_STATS } from "../shared/constants";
import { JsonValue, SettingsManager } from "../shared/settingsManager";
import {
  ContentScriptUsageEventContext,
  DonationPromptAction,
  DonationPromptSummary,
  LanguageUsageSummary,
  ProductivityDashboardStats,
  ProductivityEventSummary,
  ProductivityMetricSummary,
  TopSnippetUsage,
  WeeklyRecapSummary,
} from "../shared/messageTypes";

interface LanguageUsageCounters {
  acceptedSuggestions: number;
  charactersSaved: number;
}

interface SnippetUsageCounters {
  count: number;
  charactersSaved: number;
  charsInserted: number;
  charsTyped: number;
}

interface DailyProductivityState {
  acceptedSuggestions: number;
  charactersSaved: number;
  suggestionsShown: number;
  snippetsExpanded: number;
  charsInsertedFromSnippet: number;
  charsTypedForTrigger: number;
  snippetUsage: Record<string, SnippetUsageCounters>;
  languageUsage: Record<string, LanguageUsageCounters>;
}

interface ProductivityStatsState {
  schemaVersion: 2;
  acceptedSuggestions: number;
  charactersSaved: number;
  suggestionsShown: number;
  snippetsExpanded: number;
  charsInsertedFromSnippet: number;
  charsTypedForTrigger: number;
  snippetUsage: Record<string, SnippetUsageCounters>;
  languageUsage: Record<string, LanguageUsageCounters>;
  daily: Record<string, DailyProductivityState>;
  shownMilestones: number[];
  firstValuePromptAcknowledged: boolean;
  lastWeeklyRecapWeek: string | null;
  lastDonationPromptAt: string | null;
  donationSnoozedUntil: string | null;
}

interface AggregatedCounters {
  acceptedSuggestions: number;
  charactersSaved: number;
  suggestionsShown: number;
  snippetsExpanded: number;
  charsInsertedFromSnippet: number;
  charsTypedForTrigger: number;
  snippetUsage: Record<string, SnippetUsageCounters>;
  languageUsage: Record<string, LanguageUsageCounters>;
}

const STATS_SCHEMA_VERSION = 2;
const DONATION_MILESTONE_HOURS = [1, 5, 10, 25];
const DONATION_FIRST_VALUE_ACCEPTS = 20;
const DONATION_FIRST_VALUE_MINUTES = 15;
const DONATION_PROMPT_COOLDOWN_DAYS = 7;
const DONATION_SNOOZE_DAYS = 30;
const WEEKLY_RECAP_REVEAL_HOUR = 8;
const TYPING_CHARACTERS_PER_MINUTE = 240;
const ACCEPTANCE_BONUS_SECONDS = 0.8;
const EQUIVALENT_TASK_MINUTES = 5;
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

function createSnippetCounters(): SnippetUsageCounters {
  return {
    count: 0,
    charactersSaved: 0,
    charsInserted: 0,
    charsTyped: 0,
  };
}

function createDailyState(): DailyProductivityState {
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

function createDefaultStatsState(): ProductivityStatsState {
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

function sanitizeSnippetUsageMap(
  value: unknown,
): Record<string, SnippetUsageCounters> {
  if (!isObjectRecord(value)) {
    return {};
  }
  const sanitized: Record<string, SnippetUsageCounters> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = normalizeSnippetKey(key);
    if (!normalizedKey) {
      continue;
    }

    let counters: SnippetUsageCounters | null = null;
    if (typeof rawValue === "number") {
      const count = clampCount(rawValue);
      if (count > 0) {
        counters = {
          count,
          charactersSaved: 0,
          charsInserted: 0,
          charsTyped: 0,
        };
      }
    } else if (isObjectRecord(rawValue)) {
      const count = clampCount(rawValue.count);
      const charactersSaved = clampCount(rawValue.charactersSaved);
      const charsInserted = clampCount(rawValue.charsInserted);
      const charsTyped = clampCount(rawValue.charsTyped);
      if (count > 0 || charactersSaved > 0 || charsInserted > 0 || charsTyped > 0) {
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
    const suggestionsShown = clampCount(entry.suggestionsShown);
    const snippetsExpanded = clampCount(entry.snippetsExpanded);
    const charsInsertedFromSnippet = clampCount(entry.charsInsertedFromSnippet);
    const charsTypedForTrigger = clampCount(entry.charsTypedForTrigger);
    const snippetUsage = sanitizeSnippetUsageMap(entry.snippetUsage);
    const languageUsage = sanitizeLanguageUsageMap(entry.languageUsage);
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

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function sanitizeStatsState(value: unknown): ProductivityStatsState {
  if (!isObjectRecord(value)) {
    return createDefaultStatsState();
  }
  const normalized: ProductivityStatsState = {
    schemaVersion: STATS_SCHEMA_VERSION,
    acceptedSuggestions: clampCount(value.acceptedSuggestions),
    charactersSaved: clampCount(value.charactersSaved),
    suggestionsShown: clampCount(value.suggestionsShown),
    snippetsExpanded: clampCount(value.snippetsExpanded),
    charsInsertedFromSnippet: clampCount(value.charsInsertedFromSnippet),
    charsTypedForTrigger: clampCount(value.charsTypedForTrigger),
    snippetUsage: sanitizeSnippetUsageMap(value.snippetUsage),
    languageUsage: sanitizeLanguageUsageMap(value.languageUsage),
    daily: sanitizeDailyMap(value.daily),
    shownMilestones: Array.isArray(value.shownMilestones)
      ? value.shownMilestones
          .map((milestone) => clampCount(milestone))
          .filter((milestone) => DONATION_MILESTONE_HOURS.includes(milestone))
      : [],
    firstValuePromptAcknowledged: value.firstValuePromptAcknowledged === true,
    lastWeeklyRecapWeek:
      typeof value.lastWeeklyRecapWeek === "string"
        ? value.lastWeeklyRecapWeek
        : null,
    lastDonationPromptAt: parseIsoDate(value.lastDonationPromptAt)
      ? (value.lastDonationPromptAt as string)
      : null,
    donationSnoozedUntil: parseIsoDate(value.donationSnoozedUntil)
      ? (value.donationSnoozedUntil as string)
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

function eventsFromCounters(
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

function incrementSnippetUsageCounter(
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
    usageMap[snippet] = createSnippetCounters();
  }
  usageMap[snippet].count += update.countDelta || 0;
  usageMap[snippet].charactersSaved += update.charsSavedDelta || 0;
  usageMap[snippet].charsInserted += update.charsInsertedDelta || 0;
  usageMap[snippet].charsTyped += update.charsTypedDelta || 0;
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

function addDaysFromDateTime(date: Date, days: number): Date {
  const next = new Date(date);
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
    suggestionsShown: 0,
    snippetsExpanded: 0,
    charsInsertedFromSnippet: 0,
    charsTypedForTrigger: 0,
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
        if (!counters.languageUsage[language]) {
          counters.languageUsage[language] = {
            acceptedSuggestions: 0,
            charactersSaved: 0,
          };
        }
        counters.languageUsage[language].acceptedSuggestions +=
          values.acceptedSuggestions;
        counters.languageUsage[language].charactersSaved += values.charactersSaved;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return counters;
}

function getTopSnippets(
  usageMap: Record<string, SnippetUsageCounters>,
  limit: number,
): TopSnippetUsage[] {
  return Object.entries(usageMap)
    .map(([snippet, counters]) => ({
      snippet,
      count: counters.count,
      charactersSaved: counters.charactersSaved,
      estimatedMinutesSaved: estimateMinutesSaved(
        counters.count,
        counters.charactersSaved,
      ),
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
  const beforeWeek = aggregateThroughDate(daily, addDays(weekStart, -1));
  const throughWeek = aggregateThroughDate(daily, weekEnd);
  const beforeWeekHours =
    estimateMinutesSaved(
      beforeWeek.acceptedSuggestions,
      beforeWeek.charactersSaved,
    ) / 60;
  const throughWeekHours =
    estimateMinutesSaved(
      throughWeek.acceptedSuggestions,
      throughWeek.charactersSaved,
    ) / 60;
  const milestonesCrossedHours = DONATION_MILESTONE_HOURS.filter(
    (milestone) => beforeWeekHours < milestone && throughWeekHours >= milestone,
  );
  const estimatedMinutesSaved = estimateMinutesSaved(
    aggregated.acceptedSuggestions,
    aggregated.charactersSaved,
  );
  const topSnippet = getTopSnippets(aggregated.snippetUsage, 1)[0] || null;
  return {
    weekKey: toLocalDateKey(weekStart),
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

function aggregateThroughDate(
  daily: Record<string, DailyProductivityState>,
  endDate: Date,
): Pick<AggregatedCounters, "acceptedSuggestions" | "charactersSaved"> {
  let acceptedSuggestions = 0;
  let charactersSaved = 0;
  const endKey = toLocalDateKey(endDate);
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

function getLast7DayTrend(
  daily: Record<string, DailyProductivityState>,
  now: Date,
): ProductivityDashboardStats["last7DaysTrend"] {
  const points: ProductivityDashboardStats["last7DaysTrend"] = [];
  const start = addDays(now, -6);
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const dayDate = addDays(start, dayOffset);
    const dayKey = toLocalDateKey(dayDate);
    const entry = daily[dayKey] || createDailyState();
    points.push({
      dateKey: dayKey,
      acceptedSuggestions: entry.acceptedSuggestions,
      charactersSaved: entry.charactersSaved,
      estimatedMinutesSaved: estimateMinutesSaved(
        entry.acceptedSuggestions,
        entry.charactersSaved,
      ),
    });
  }
  return points;
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

function getMilestoneProgress(
  lifetimeMinutesSaved: number,
): ProductivityDashboardStats["milestoneProgress"] {
  const lifetimeHoursSaved = roundMetric(lifetimeMinutesSaved / 60);
  const previousMilestoneHours =
    DONATION_MILESTONE_HOURS.filter((milestone) => lifetimeHoursSaved >= milestone)
      .sort((left, right) => right - left)[0] || 0;
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
    denominator > 0
      ? ((lifetimeHoursSaved - previousMilestoneHours) / denominator) * 100
      : 100;
  const progressPct = Math.max(0, Math.min(100, Math.round(progressRaw)));

  return {
    previousMilestoneHours,
    nextMilestoneHours,
    progressPct,
    lifetimeHoursSaved,
  };
}

function toDonationPrompt(
  state: ProductivityStatsState,
  lifetime: ProductivityMetricSummary,
  now: Date,
  weeklyRecap: WeeklyRecapSummary,
  shouldShowWeeklyRecapCard: boolean,
): DonationPromptSummary | null {
  const snoozedUntilDate = parseIsoDate(state.donationSnoozedUntil);
  if (snoozedUntilDate && now < snoozedUntilDate) {
    return null;
  }

  if (shouldShowWeeklyRecapCard) {
    return {
      promptId: `weekly_recap_${weeklyRecap.weekKey}`,
      kind: "weekly_recap",
      source: "weekly_recap",
      milestoneHours:
        weeklyRecap.milestonesCrossedHours[weeklyRecap.milestonesCrossedHours.length - 1] ||
        null,
      message:
        "Your weekly recap is ready. If FluentTyper is saving you time, support development.",
    };
  }

  const lastPromptDate = parseIsoDate(state.lastDonationPromptAt);
  if (lastPromptDate) {
    const cooldownEndsAt = addDaysFromDateTime(
      lastPromptDate,
      DONATION_PROMPT_COOLDOWN_DAYS,
    );
    if (now < cooldownEndsAt) {
      return null;
    }
  }

  if (
    !state.firstValuePromptAcknowledged &&
    (lifetime.acceptedSuggestions >= DONATION_FIRST_VALUE_ACCEPTS ||
      lifetime.estimatedMinutesSaved >= DONATION_FIRST_VALUE_MINUTES)
  ) {
    return {
      promptId: "first_value",
      kind: "first_value",
      source: "lifetime_threshold",
      milestoneHours: null,
      message:
        "You are saving real time already. If this helps your workflow, support FluentTyper.",
    };
  }

  const savedHours = lifetime.estimatedMinutesSaved / 60;
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
    promptId: `milestone_${nextMilestone}`,
    kind: "milestone",
    source: "lifetime_threshold",
    milestoneHours: nextMilestone,
    message: `You just saved your ${ordinal} ${hoursLabel}. Buy the dev a coffee?`,
  };
}

function shouldShowWeeklyRecap(
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

  const currentWeekStart = getWeekStart(now);
  const expectedRecapWeekKey = toLocalDateKey(addDays(currentWeekStart, -7));
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
    await this.recordUsageEvent(event);
  }

  async recordUsageEvent(event: ContentScriptUsageEventContext): Promise<void> {
    await this.enqueueMutation(async (state) => {
      const todayKey = toLocalDateKey(this.now());
      const todayBucket = state.daily[todayKey] || createDailyState();

      switch (event.eventType) {
        case "suggestion_shown": {
          const suggestionCount = clampCount(event.suggestionCount);
          if (suggestionCount <= 0) {
            break;
          }
          state.suggestionsShown += suggestionCount;
          todayBucket.suggestionsShown += suggestionCount;
          break;
        }
        case "suggestion_accepted": {
          const typedTextLength = clampCount(event.typedTextLength);
          const insertedTextLength = clampCount(event.insertedTextLength);
          const charactersSaved = Math.max(0, insertedTextLength - typedTextLength);
          const language = normalizeLanguageKey(event.language);

          state.acceptedSuggestions += 1;
          state.charactersSaved += charactersSaved;
          incrementLanguageUsageCounter(
            state.languageUsage,
            language,
            charactersSaved,
          );

          todayBucket.acceptedSuggestions += 1;
          todayBucket.charactersSaved += charactersSaved;
          incrementLanguageUsageCounter(
            todayBucket.languageUsage,
            language,
            charactersSaved,
          );
          break;
        }
        case "snippet_expanded": {
          const normalizedSnippetKey = normalizeSnippetKey(event.triggerText);
          if (
            !normalizedSnippetKey ||
            !this.snippetShortcuts.has(normalizedSnippetKey)
          ) {
            break;
          }

          const typedTextLength = clampCount(event.typedTextLength);
          const insertedTextLength = clampCount(event.insertedTextLength);
          const charactersSaved = Math.max(0, insertedTextLength - typedTextLength);

          state.snippetsExpanded += 1;
          todayBucket.snippetsExpanded += 1;
          incrementSnippetUsageCounter(state.snippetUsage, normalizedSnippetKey, {
            countDelta: 1,
            charsSavedDelta: charactersSaved,
          });
          incrementSnippetUsageCounter(
            todayBucket.snippetUsage,
            normalizedSnippetKey,
            {
              countDelta: 1,
              charsSavedDelta: charactersSaved,
            },
          );
          break;
        }
        case "chars_inserted_from_snippet": {
          const normalizedSnippetKey = normalizeSnippetKey(event.triggerText);
          const insertedChars = clampCount(event.amount);
          if (
            !normalizedSnippetKey ||
            insertedChars <= 0 ||
            !this.snippetShortcuts.has(normalizedSnippetKey)
          ) {
            break;
          }
          state.charsInsertedFromSnippet += insertedChars;
          todayBucket.charsInsertedFromSnippet += insertedChars;
          incrementSnippetUsageCounter(state.snippetUsage, normalizedSnippetKey, {
            charsInsertedDelta: insertedChars,
          });
          incrementSnippetUsageCounter(
            todayBucket.snippetUsage,
            normalizedSnippetKey,
            {
              charsInsertedDelta: insertedChars,
            },
          );
          break;
        }
        case "chars_typed_for_trigger": {
          const normalizedSnippetKey = normalizeSnippetKey(event.triggerText);
          const typedChars = clampCount(event.amount);
          if (
            !normalizedSnippetKey ||
            typedChars <= 0 ||
            !this.snippetShortcuts.has(normalizedSnippetKey)
          ) {
            break;
          }
          state.charsTypedForTrigger += typedChars;
          todayBucket.charsTypedForTrigger += typedChars;
          incrementSnippetUsageCounter(state.snippetUsage, normalizedSnippetKey, {
            charsTypedDelta: typedChars,
          });
          incrementSnippetUsageCounter(
            todayBucket.snippetUsage,
            normalizedSnippetKey,
            {
              charsTypedDelta: typedChars,
            },
          );
          break;
        }
        default:
          break;
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

    const lifetimeEvents = eventsFromCounters(
      state.suggestionsShown,
      state.snippetsExpanded,
      state.charsInsertedFromSnippet,
      state.charsTypedForTrigger,
    );

    const last7DaysEvents = eventsFromCounters(
      last7Range.suggestionsShown,
      last7Range.snippetsExpanded,
      last7Range.charsInsertedFromSnippet,
      last7Range.charsTypedForTrigger,
    );

    const perLanguageLifetime = getLanguageSummaries(state.languageUsage);
    const perLanguageLast7Days = getLanguageSummaries(last7Range.languageUsage);
    const topSnippets = getTopSnippets(state.snippetUsage, 5);
    const last7DaysTrend = getLast7DayTrend(state.daily, now);

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
    const shouldShowWeeklyRecapCard = shouldShowWeeklyRecap(state, weeklyRecap, now);

    return {
      today,
      last7Days,
      lifetime,
      lifetimeEvents,
      last7DaysEvents,
      last7DaysTrend,
      perLanguageLifetime,
      perLanguageLast7Days,
      topSnippets,
      weekOverWeekDeltaPct,
      milestoneProgress: getMilestoneProgress(lifetime.estimatedMinutesSaved),
      weeklyRecap,
      shouldShowWeeklyRecap: shouldShowWeeklyRecapCard,
      donationPrompt: toDonationPrompt(
        state,
        lifetime,
        now,
        weeklyRecap,
        shouldShowWeeklyRecapCard,
      ),
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
    await this.handleDonationPromptAction(
      `milestone_${clampCount(milestoneHours)}`,
      "supported",
      milestoneHours,
    );
  }

  async handleDonationPromptAction(
    promptId: string,
    action: DonationPromptAction,
    milestoneHours: number | null,
  ): Promise<void> {
    const normalizedPromptId = typeof promptId === "string" ? promptId : "";
    if (!normalizedPromptId) {
      return;
    }

    await this.enqueueMutation(async (state) => {
      const now = this.now();
      state.lastDonationPromptAt = now.toISOString();

      if (action === "shown") {
        return;
      }

      if (action === "snooze") {
        state.donationSnoozedUntil = addDaysFromDateTime(
          now,
          DONATION_SNOOZE_DAYS,
        ).toISOString();
        return;
      }

      state.donationSnoozedUntil = null;
      if (normalizedPromptId === "first_value") {
        state.firstValuePromptAcknowledged = true;
      }

      const milestone = clampCount(milestoneHours);
      if (
        DONATION_MILESTONE_HOURS.includes(milestone) &&
        !state.shownMilestones.includes(milestone)
      ) {
        state.shownMilestones.push(milestone);
        state.shownMilestones.sort((left, right) => left - right);
      }
    });
  }

  async resetStats(): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      await this.saveState(createDefaultStatsState());
    });
    this.mutationQueue = operation.catch((error: unknown) => {
      console.error("Failed to reset productivity stats", error);
    });
    await operation;
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
