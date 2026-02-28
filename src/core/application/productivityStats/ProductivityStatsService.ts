import type { SettingsManager } from "@core/application/settingsManager";
import type {
  ContentScriptUsageEventContext,
  DonationPromptAction,
  ProductivityDashboardStats,
} from "@core/domain/messageTypes";
import { DonationPromptPolicy } from "@core/domain/productivityStats/DonationPromptPolicy";
import { RecapPolicy } from "@core/domain/productivityStats/RecapPolicy";
import { StatsAggregator } from "@core/domain/productivityStats/StatsAggregator";
import { StatsSanitizer } from "@core/domain/productivityStats/StatsSanitizer";
import type { ProductivityStatsState } from "@core/domain/productivityStats/types";
import { StatsRepository } from "./StatsRepository";

export class ProductivityStatsService {
  private mutationQueue: Promise<void> = Promise.resolve();
  private snippetShortcuts: Set<string> = new Set<string>();
  private readonly now: () => Date;

  private readonly sanitizer: StatsSanitizer;
  private readonly aggregator: StatsAggregator;
  private readonly recapPolicy: RecapPolicy;
  private readonly donationPromptPolicy: DonationPromptPolicy;
  private readonly repository: StatsRepository;

  constructor(settingsManager: SettingsManager, options: { now?: () => Date } = {}) {
    this.sanitizer = new StatsSanitizer();
    this.aggregator = new StatsAggregator(this.sanitizer);
    this.recapPolicy = new RecapPolicy(this.sanitizer, this.aggregator);
    this.donationPromptPolicy = new DonationPromptPolicy(this.sanitizer);
    this.repository = new StatsRepository(settingsManager, this.sanitizer);
    this.now = options.now || (() => new Date());
  }

  setSnippetShortcuts(textExpansions: unknown): void {
    if (!Array.isArray(textExpansions)) {
      this.snippetShortcuts = new Set<string>();
      return;
    }

    const shortcuts = textExpansions
      .map((entry) => (Array.isArray(entry) ? this.sanitizer.normalizeSnippetKey(entry[0]) : ""))
      .filter((shortcut) => shortcut.length > 0);
    this.snippetShortcuts = new Set(shortcuts);
  }

  async recordSuggestionAccepted(event: ContentScriptUsageEventContext): Promise<void> {
    await this.recordUsageEvent(event);
  }

  async recordUsageEvent(event: ContentScriptUsageEventContext): Promise<void> {
    await this.enqueueMutation(async (state) => {
      const todayKey = this.sanitizer.toLocalDateKey(this.now());
      const todayBucket = state.daily[todayKey] || this.sanitizer.createDailyState();

      switch (event.eventType) {
        case "suggestion_shown": {
          const suggestionCount = this.sanitizer.clampCount(event.suggestionCount);
          if (suggestionCount <= 0) {
            break;
          }
          state.suggestionsShown += suggestionCount;
          todayBucket.suggestionsShown += suggestionCount;
          break;
        }

        case "suggestion_accepted": {
          const typedTextLength = this.sanitizer.clampCount(event.typedTextLength);
          const insertedTextLength = this.sanitizer.clampCount(event.insertedTextLength);
          const charactersSaved = Math.max(0, insertedTextLength - typedTextLength);
          const language = this.sanitizer.normalizeLanguageKey(event.language);

          state.acceptedSuggestions += 1;
          state.charactersSaved += charactersSaved;
          this.aggregator.incrementLanguageUsageCounter(
            state.languageUsage,
            language,
            charactersSaved,
          );

          todayBucket.acceptedSuggestions += 1;
          todayBucket.charactersSaved += charactersSaved;
          this.aggregator.incrementLanguageUsageCounter(
            todayBucket.languageUsage,
            language,
            charactersSaved,
          );
          break;
        }

        case "snippet_expanded": {
          const normalizedSnippetKey = this.sanitizer.normalizeSnippetKey(event.triggerText);
          if (!normalizedSnippetKey || !this.snippetShortcuts.has(normalizedSnippetKey)) {
            break;
          }

          const typedTextLength = this.sanitizer.clampCount(event.typedTextLength);
          const insertedTextLength = this.sanitizer.clampCount(event.insertedTextLength);
          const charactersSaved = Math.max(0, insertedTextLength - typedTextLength);

          state.snippetsExpanded += 1;
          todayBucket.snippetsExpanded += 1;
          this.aggregator.incrementSnippetUsageCounter(state.snippetUsage, normalizedSnippetKey, {
            countDelta: 1,
            charsSavedDelta: charactersSaved,
          });
          this.aggregator.incrementSnippetUsageCounter(
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
          const normalizedSnippetKey = this.sanitizer.normalizeSnippetKey(event.triggerText);
          const insertedChars = this.sanitizer.clampCount(event.amount);
          if (
            !normalizedSnippetKey ||
            insertedChars <= 0 ||
            !this.snippetShortcuts.has(normalizedSnippetKey)
          ) {
            break;
          }

          state.charsInsertedFromSnippet += insertedChars;
          todayBucket.charsInsertedFromSnippet += insertedChars;
          this.aggregator.incrementSnippetUsageCounter(state.snippetUsage, normalizedSnippetKey, {
            charsInsertedDelta: insertedChars,
          });
          this.aggregator.incrementSnippetUsageCounter(
            todayBucket.snippetUsage,
            normalizedSnippetKey,
            {
              charsInsertedDelta: insertedChars,
            },
          );
          break;
        }

        case "chars_typed_for_trigger": {
          const normalizedSnippetKey = this.sanitizer.normalizeSnippetKey(event.triggerText);
          const typedChars = this.sanitizer.clampCount(event.amount);
          if (
            !normalizedSnippetKey ||
            typedChars <= 0 ||
            !this.snippetShortcuts.has(normalizedSnippetKey)
          ) {
            break;
          }

          state.charsTypedForTrigger += typedChars;
          todayBucket.charsTypedForTrigger += typedChars;
          this.aggregator.incrementSnippetUsageCounter(state.snippetUsage, normalizedSnippetKey, {
            charsTypedDelta: typedChars,
          });
          this.aggregator.incrementSnippetUsageCounter(
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
      this.aggregator.pruneDailyBuckets(state.daily);
    });
  }

  async getDashboardStats(): Promise<ProductivityDashboardStats> {
    await this.mutationQueue;
    const state = await this.loadState();
    const now = this.now();

    const todayKey = this.sanitizer.toLocalDateKey(now);
    const todayBucket = state.daily[todayKey] || this.sanitizer.createDailyState();
    const today = this.aggregator.metricsFromCounters(
      todayBucket.acceptedSuggestions,
      todayBucket.charactersSaved,
    );

    const last7Range = this.aggregator.aggregateRange(
      state.daily,
      this.sanitizer.addDays(now, -6),
      now,
    );
    const last7Days = this.aggregator.metricsFromCounters(
      last7Range.acceptedSuggestions,
      last7Range.charactersSaved,
    );

    const lifetime = this.aggregator.metricsFromCounters(
      state.acceptedSuggestions,
      state.charactersSaved,
    );

    const lifetimeEvents = this.aggregator.eventsFromCounters(
      state.suggestionsShown,
      state.snippetsExpanded,
      state.charsInsertedFromSnippet,
      state.charsTypedForTrigger,
    );

    const last7DaysEvents = this.aggregator.eventsFromCounters(
      last7Range.suggestionsShown,
      last7Range.snippetsExpanded,
      last7Range.charsInsertedFromSnippet,
      last7Range.charsTypedForTrigger,
    );

    const perLanguageLifetime = this.aggregator.getLanguageSummaries(state.languageUsage);
    const perLanguageLast7Days = this.aggregator.getLanguageSummaries(last7Range.languageUsage);
    const topSnippets = this.aggregator.getTopSnippets(state.snippetUsage, 5);
    const last7DaysTrend = this.aggregator.getLast7DayTrend(state.daily, now);

    const currentWeekStart = this.sanitizer.getWeekStart(now);
    const previousWeekStart = this.sanitizer.addDays(currentWeekStart, -7);
    const currentWeek = this.recapPolicy.summarizeWeek(state.daily, currentWeekStart);
    const previousWeek = this.recapPolicy.summarizeWeek(state.daily, previousWeekStart);
    const weeklyRecap = previousWeek;

    const weekOverWeekDeltaPct =
      previousWeek.estimatedMinutesSaved > 0
        ? Math.round(
            ((currentWeek.estimatedMinutesSaved - previousWeek.estimatedMinutesSaved) /
              previousWeek.estimatedMinutesSaved) *
              100,
          )
        : null;

    const shouldShowWeeklyRecapCard = this.recapPolicy.shouldShowWeeklyRecap(
      state,
      weeklyRecap,
      now,
    );

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
      milestoneProgress: this.aggregator.getMilestoneProgress(lifetime.estimatedMinutesSaved),
      weeklyRecap,
      shouldShowWeeklyRecap: shouldShowWeeklyRecapCard,
      donationPrompt: this.donationPromptPolicy.toDonationPrompt(
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

    await this.enqueueMutation((state) => {
      state.lastWeeklyRecapWeek = weekKey;
    });
  }

  async acknowledgeDonationMilestone(milestoneHours: number): Promise<void> {
    await this.handleDonationPromptAction(
      `milestone_${this.sanitizer.clampCount(milestoneHours)}`,
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

    await this.enqueueMutation((state) => {
      this.donationPromptPolicy.applyAction(
        state,
        normalizedPromptId,
        action,
        milestoneHours,
        this.now(),
      );
    });
  }

  async resetStats(): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      await this.saveState(this.sanitizer.createDefaultStatsState());
    });

    this.mutationQueue = operation.catch((error: unknown) => {
      console.error("Failed to reset productivity stats", error);
    });
    await operation;
  }

  private async enqueueMutation(
    mutation: (state: ProductivityStatsState) => Promise<void> | void,
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
    return this.repository.loadState();
  }

  private async saveState(state: ProductivityStatsState): Promise<void> {
    await this.repository.saveState(state);
  }
}
