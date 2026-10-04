import type { SettingsManager } from "@core/application/settingsManager";
import type {
  ContentScriptUsageEventContext,
  DonationPromptAction,
  ProductivityDashboardStats,
  ProductivityEventSummary,
} from "@core/domain/messageTypes";
import * as donationPromptPolicy from "@core/domain/productivityStats/DonationPromptPolicy";
import * as recapPolicy from "@core/domain/productivityStats/RecapPolicy";
import * as aggregator from "@core/domain/productivityStats/StatsAggregator";
import type { SnippetUsageUpdate } from "@core/domain/productivityStats/StatsAggregator";
import * as sanitizer from "@core/domain/productivityStats/StatsSanitizer";
import { serialQueue } from "@core/domain/serialQueue";
import { createLogger } from "@core/application/logging/Logger";
import type {
  DailyProductivityState,
  ProductivityStatsState,
} from "@core/domain/productivityStats/types";

const logger = createLogger("ProductivityStatsService");

function eventSummary({
  suggestionsShown,
  snippetsExpanded,
  charsInsertedFromSnippet,
  charsTypedForTrigger,
}: ProductivityEventSummary): ProductivityEventSummary {
  return { suggestionsShown, snippetsExpanded, charsInsertedFromSnippet, charsTypedForTrigger };
}

export class ProductivityStatsService {
  private readonly mutationQueue = serialQueue();
  private snippetShortcuts: Set<string> = new Set<string>();
  private readonly now: () => Date;

  constructor(
    private readonly settingsManager: SettingsManager,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now || (() => new Date());
  }

  private getTodayBucket(
    state: ProductivityStatsState,
    now: Date,
  ): { todayKey: string; todayBucket: DailyProductivityState } {
    const todayKey = sanitizer.toLocalDateKey(now);
    return {
      todayKey,
      todayBucket: state.daily[todayKey] || sanitizer.createDailyState(),
    };
  }

  private recordSnippetUsage(
    state: ProductivityStatsState,
    todayBucket: DailyProductivityState,
    snippetKey: string,
    update: SnippetUsageUpdate,
  ): void {
    aggregator.incrementSnippetUsageCounter(state.snippetUsage, snippetKey, update);
    aggregator.incrementSnippetUsageCounter(todayBucket.snippetUsage, snippetKey, update);
  }

  setSnippetShortcuts(textExpansions: unknown): void {
    if (!Array.isArray(textExpansions)) {
      this.snippetShortcuts = new Set<string>();
      return;
    }

    const shortcuts = textExpansions
      .map((entry) => (Array.isArray(entry) ? sanitizer.normalizeSnippetKey(entry[0]) : ""))
      .filter((shortcut) => shortcut.length > 0);
    this.snippetShortcuts = new Set(shortcuts);
  }

  async recordUsageEvent(event: ContentScriptUsageEventContext): Promise<void> {
    logger.debug("Recording productivity usage event", {
      eventType: event.eventType,
      language: "language" in event ? event.language : undefined,
    });
    await this.enqueueMutation((state) => {
      const { todayKey, todayBucket } = this.getTodayBucket(state, this.now());

      switch (event.eventType) {
        case "suggestion_shown": {
          const suggestionCount = sanitizer.clampCount(event.suggestionCount);
          if (suggestionCount <= 0) {
            break;
          }
          state.suggestionsShown += suggestionCount;
          todayBucket.suggestionsShown += suggestionCount;
          break;
        }

        case "suggestion_accepted": {
          const typedTextLength = sanitizer.clampCount(event.typedTextLength);
          const insertedTextLength = sanitizer.clampCount(event.insertedTextLength);
          const charactersSaved = Math.max(0, insertedTextLength - typedTextLength);
          const language = sanitizer.normalizeLanguageKey(event.language);

          state.acceptedSuggestions += 1;
          state.charactersSaved += charactersSaved;
          aggregator.addLanguageUsageCounters(state.languageUsage, language, 1, charactersSaved);
          aggregator.addLanguageUsageCounters(
            todayBucket.languageUsage,
            language,
            1,
            charactersSaved,
          );

          todayBucket.acceptedSuggestions += 1;
          todayBucket.charactersSaved += charactersSaved;
          break;
        }

        case "snippet_expanded": {
          const normalizedSnippetKey = sanitizer.normalizeSnippetKey(event.triggerText);
          if (!normalizedSnippetKey || !this.snippetShortcuts.has(normalizedSnippetKey)) {
            break;
          }

          const typedTextLength = sanitizer.clampCount(event.typedTextLength);
          const insertedTextLength = sanitizer.clampCount(event.insertedTextLength);
          const charactersSaved = Math.max(0, insertedTextLength - typedTextLength);

          state.snippetsExpanded += 1;
          todayBucket.snippetsExpanded += 1;
          this.recordSnippetUsage(state, todayBucket, normalizedSnippetKey, {
            countDelta: 1,
            charsSavedDelta: charactersSaved,
          });
          break;
        }

        case "chars_inserted_from_snippet":
        case "chars_typed_for_trigger": {
          const normalizedSnippetKey = sanitizer.normalizeSnippetKey(event.triggerText);
          const amount = sanitizer.clampCount(event.amount);
          if (
            !normalizedSnippetKey ||
            amount <= 0 ||
            !this.snippetShortcuts.has(normalizedSnippetKey)
          ) {
            break;
          }

          const [stateField, deltaKey] =
            event.eventType === "chars_inserted_from_snippet"
              ? (["charsInsertedFromSnippet", "charsInsertedDelta"] as const)
              : (["charsTypedForTrigger", "charsTypedDelta"] as const);
          state[stateField] += amount;
          todayBucket[stateField] += amount;
          this.recordSnippetUsage(state, todayBucket, normalizedSnippetKey, {
            [deltaKey]: amount,
          });
          break;
        }
      }

      state.daily[todayKey] = todayBucket;
      aggregator.pruneDailyBuckets(state.daily);
    });
  }

  async getDashboardStats(): Promise<ProductivityDashboardStats> {
    await this.mutationQueue(() => Promise.resolve());
    const state = await this.loadState();
    const now = this.now();

    const { todayBucket } = this.getTodayBucket(state, now);
    const today = aggregator.metricsFromCounters(
      todayBucket.acceptedSuggestions,
      todayBucket.charactersSaved,
    );

    const last7Range = aggregator.aggregateRange(state.daily, sanitizer.addDays(now, -6), now);
    const last7Days = aggregator.metricsFromCounters(
      last7Range.acceptedSuggestions,
      last7Range.charactersSaved,
    );

    const lifetime = aggregator.metricsFromCounters(
      state.acceptedSuggestions,
      state.charactersSaved,
    );

    const perLanguageLifetime = aggregator.getLanguageSummaries(state.languageUsage);
    const perLanguageLast7Days = aggregator.getLanguageSummaries(last7Range.languageUsage);
    const topSnippets = aggregator.getTopSnippets(state.snippetUsage, 5);
    const last7DaysTrend = aggregator.getLast7DayTrend(state.daily, now);

    const currentWeekStart = sanitizer.getWeekStart(now);
    const previousWeekStart = sanitizer.addDays(currentWeekStart, -7);
    const currentWeek = recapPolicy.summarizeWeek(state, currentWeekStart);
    const previousWeek = recapPolicy.summarizeWeek(state, previousWeekStart);

    const weekOverWeekDeltaPct =
      previousWeek.estimatedMinutesSaved > 0
        ? Math.round(
            ((currentWeek.estimatedMinutesSaved - previousWeek.estimatedMinutesSaved) /
              previousWeek.estimatedMinutesSaved) *
              100,
          )
        : null;

    const shouldShowWeeklyRecapCard = recapPolicy.shouldShowWeeklyRecap(state, previousWeek, now);

    return {
      today,
      last7Days,
      lifetime,
      lifetimeEvents: eventSummary(state),
      last7DaysEvents: eventSummary(last7Range),
      last7DaysTrend,
      perLanguageLifetime,
      perLanguageLast7Days,
      topSnippets,
      weekOverWeekDeltaPct,
      milestoneProgress: aggregator.getMilestoneProgress(lifetime.estimatedMinutesSaved),
      weeklyRecap: previousWeek,
      shouldShowWeeklyRecap: shouldShowWeeklyRecapCard,
      donationPrompt: donationPromptPolicy.toDonationPrompt(
        state,
        lifetime,
        now,
        previousWeek,
        shouldShowWeeklyRecapCard,
      ),
    };
  }

  async acknowledgeWeeklyRecap(weekKey: string): Promise<void> {
    if (!weekKey) {
      return;
    }

    await this.enqueueMutation((state) => {
      state.lastWeeklyRecapWeek = weekKey;
    });
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

    await this.enqueueMutation((state) => {
      donationPromptPolicy.applyAction(
        state,
        normalizedPromptId,
        action,
        milestoneHours,
        this.now(),
      );
    });
  }

  async resetStats(): Promise<void> {
    logger.warn("Resetting productivity stats");
    await this.mutationQueue(async () => {
      const { donationPromptsDisabled } = await this.loadState();
      await this.saveState({
        ...sanitizer.createDefaultStatsState(),
        donationPromptsDisabled,
      });
    });
  }

  private async enqueueMutation(
    mutation: (state: ProductivityStatsState) => Promise<void> | void,
  ): Promise<void> {
    await this.mutationQueue(async () => {
      const state = await this.loadState();
      await mutation(state);
      await this.saveState(state);
    });
  }

  private async loadState(): Promise<ProductivityStatsState> {
    return sanitizer.sanitizeStatsState(await this.settingsManager.getRaw("productivityStats"));
  }

  private async saveState(state: ProductivityStatsState): Promise<void> {
    await this.settingsManager.set("productivityStats", state);
  }
}
