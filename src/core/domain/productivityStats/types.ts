export interface LanguageUsageCounters {
  acceptedSuggestions: number;
  charactersSaved: number;
}

export interface SnippetUsageCounters {
  count: number;
  charactersSaved: number;
  charsInserted: number;
  charsTyped: number;
}

export interface DailyProductivityState {
  acceptedSuggestions: number;
  charactersSaved: number;
  suggestionsShown: number;
  snippetsExpanded: number;
  charsInsertedFromSnippet: number;
  charsTypedForTrigger: number;
  snippetUsage: Record<string, SnippetUsageCounters>;
  languageUsage: Record<string, LanguageUsageCounters>;
}

export interface ProductivityStatsState extends DailyProductivityState {
  schemaVersion: 2;
  daily: Record<string, DailyProductivityState>;
  shownMilestones: number[];
  firstValuePromptAcknowledged: boolean;
  lastWeeklyRecapWeek: string | null;
  lastDonationPromptAt: string | null;
  donationSnoozedUntil: string | null;
}
