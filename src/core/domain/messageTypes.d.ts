import type {
  ObservabilityConfig,
  ObservabilityEvent,
  ObservabilitySnapshot,
} from "./observability";
import type { PersonalizationEvent } from "./personalization/types";
import type { SuggestionThemeSettings } from "./themeDefaults";

// Context for CMD_BACKGROUND_PAGE_SET_CONFIG
export type SuggestionThemeConfig = SuggestionThemeSettings;

export interface SetConfigContext {
  autocomplete: boolean;
  autocompleteOnEnter: boolean;
  autocompleteOnTab: boolean;
  insertSpaceAfterAutocomplete: boolean;
  selectByDigit: boolean;
  lang: string;
  minWordLengthToPredict: number;
  inline_suggestion: boolean;
  preferNativeAutocomplete: boolean;
  codeMode: boolean;
  enabled: boolean;
  displayLangHeader: boolean;
  enabledGrammarRules: string[];
  userDictionaryList: string[];
  // Theme configuration is reused by settings and options payloads.
  themeConfig?: SuggestionThemeConfig;
  observability?: ObservabilityConfig;
}

export type PredictionInputAction = "insert" | "delete" | "other";

// Context for CMD_BACKGROUND_PAGE_PREDICT_REQ
export interface PredictRequestContext {
  text: string;
  nextChar: string;
  afterCursorTokenSuffix?: string;
  inputAction?: PredictionInputAction;
  lang: string;
  tabId: number;
  frameId: number;
  suggestionId: number;
  requestId: number;
  runtimeGeneration?: number;
  traceId?: string;
  traceStartedAtMs?: number;
}

// Context for CMD_BACKGROUND_PAGE_PREDICT_RESP
export interface PredictResponseContext {
  text: string;
  nextChar: string;
  lang: string;
  tabId: number;
  frameId: number;
  suggestionId: number;
  requestId: number;
  runtimeGeneration?: number;
  traceId?: string;
  traceStartedAtMs?: number;
  predictions: string[];
  snippetShortcuts?: Array<string | null>;
}

// Context for CMD_CONTENT_SCRIPT_PREDICT_REQ
export interface ContentScriptPredictRequestContext {
  /** Per-request code/literal context; suppress sentence casing, not authored capitals. */
  suppressAutoCapitalize?: boolean;
  text: string;
  nextChar: string;
  afterCursorTokenSuffix?: string;
  inputAction?: PredictionInputAction;
  suggestionId: number;
  requestId: number;
  lang: string;
  documentLang?: string;
  runtimeGeneration?: number;
  traceId?: string;
  traceStartedAtMs?: number;
}

export interface ContentScriptRuntimeStatusContext {
  runtimeGeneration: number;
  domainURL?: string;
}

export interface GetAutoLanguageStatusContext {
  tabId?: number;
  frameId?: number;
  runtimeGeneration?: number;
  domainURL?: string;
}

export type ContentScriptUsageEventContext =
  | {
      eventType: "suggestion_accepted" | "snippet_expanded";
      triggerText: string;
      typedTextLength: number;
      insertedTextLength: number;
      language: string;
    }
  | { eventType: "suggestion_shown"; suggestionCount: number; language: string }
  | {
      eventType: "chars_inserted_from_snippet" | "chars_typed_for_trigger";
      amount: number;
      triggerText: string;
      language: string;
    };

export type DonationPromptAction = "shown" | "supported" | "snooze";

export interface PopupAckDonationMilestoneContext {
  promptId: string;
  action: DonationPromptAction;
  milestoneHours: number | null;
}

export interface ProductivityEventSummary {
  suggestionsShown: number;
  snippetsExpanded: number;
  charsInsertedFromSnippet: number;
  charsTypedForTrigger: number;
}

export interface ProductivityMetricSummary {
  acceptedSuggestions: number;
  charactersSaved: number;
  estimatedMinutesSaved: number;
}

export interface TopSnippetUsage {
  snippet: string;
  count: number;
  charactersSaved: number;
  estimatedMinutesSaved: number;
}

export interface LanguageUsageSummary {
  language: string;
  acceptedSuggestions: number;
  charactersSaved: number;
  estimatedMinutesSaved: number;
}

export interface WeeklyRecapSummary {
  weekKey: string;
  acceptedSuggestions: number;
  charactersSaved: number;
  estimatedMinutesSaved: number;
  topSnippet: TopSnippetUsage | null;
  milestonesCrossedHours: number[];
  equivalentTasks: number;
}

export interface MilestoneProgressSummary {
  previousMilestoneHours: number;
  nextMilestoneHours: number;
  progressPct: number;
  lifetimeHoursSaved: number;
}

export interface DailyTrendPoint {
  dateKey: string;
  acceptedSuggestions: number;
  charactersSaved: number;
  estimatedMinutesSaved: number;
}

export interface DonationPromptSummary {
  promptId: string;
  kind: "first_value" | "milestone" | "weekly_recap";
  milestoneHours: number | null;
  message: string;
}

export interface ProductivityDashboardStats {
  today: ProductivityMetricSummary;
  last7Days: ProductivityMetricSummary;
  lifetime: ProductivityMetricSummary;
  lifetimeEvents: ProductivityEventSummary;
  last7DaysEvents: ProductivityEventSummary;
  last7DaysTrend: DailyTrendPoint[];
  perLanguageLifetime: LanguageUsageSummary[];
  perLanguageLast7Days: LanguageUsageSummary[];
  topSnippets: TopSnippetUsage[];
  weekOverWeekDeltaPct: number | null;
  milestoneProgress: MilestoneProgressSummary;
  weeklyRecap: WeeklyRecapSummary;
  shouldShowWeeklyRecap: boolean;
  donationPrompt: DonationPromptSummary | null;
}

// Discriminated union for Message
export type Message =
  | { command: "CMD_BACKGROUND_PAGE_SET_CONFIG"; context: SetConfigContext }
  | {
      command: "CMD_BACKGROUND_PAGE_PREDICT_REQ";
      context: PredictRequestContext;
    }
  | {
      command: "CMD_BACKGROUND_PAGE_PREDICT_RESP";
      context: PredictResponseContext;
    }
  | { command: "CMD_TOGGLE_FT_ACTIVE_TAB" }
  | { command: "CMD_TRIGGER_FT_ACTIVE_TAB" }
  | { command: "CMD_REVIEW_FT_ACTIVE_TAB"; context?: { source?: "command" | "popup" } }
  | {
      command: "CMD_CONTENT_SCRIPT_ADD_TO_DICTIONARY";
      context: { word: string };
    }
  | {
      command: "CMD_CONTENT_SCRIPT_REVIEW_SPELLING";
      context: ReviewSpellingRequestContext;
    }
  | { command: "CMD_GET_HOSTNAME" }
  | {
      command: "CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG";
      context: { lang: string };
    }
  | {
      command: "CMD_CONTENT_SCRIPT_PREDICT_REQ";
      context: ContentScriptPredictRequestContext;
    }
  | {
      command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE";
      context: Record<string, never>;
    }
  | {
      command: "CMD_CONTENT_SCRIPT_GET_CONFIG";
      context: Record<string, never>;
    }
  | { command: "CMD_POPUP_PAGE_ENABLE"; context: Record<string, never> }
  | { command: "CMD_POPUP_PAGE_DISABLE"; context: Record<string, never> }
  | { command: "CMD_STATUS_COMMAND"; context: { enabled: boolean } }
  | {
      command: "CMD_CONTENT_SCRIPT_USAGE_EVENT";
      context: ContentScriptUsageEventContext;
    }
  | {
      command: "CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT";
      context: PersonalizationEvent;
    }
  | {
      command: "CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS";
      context: ContentScriptRuntimeStatusContext;
    }
  | {
      command: "CMD_POPUP_GET_PRODUCTIVITY_STATS";
      context: Record<string, never>;
    }
  | {
      command: "CMD_POPUP_ACK_WEEKLY_RECAP";
      context: { weekKey: string };
    }
  | {
      command: "CMD_POPUP_ACK_DONATION_MILESTONE";
      context: PopupAckDonationMilestoneContext;
    }
  | {
      command: "CMD_OPTIONS_RESET_PRODUCTIVITY_STATS";
      context: Record<string, never>;
    }
  | {
      command: "CMD_OPTIONS_CLEAR_PERSONALIZATION";
      context: Record<string, never>;
    }
  | {
      command: "CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT";
      context: Record<string, never>;
    }
  | {
      command: "CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE";
      context: Record<string, never>;
    }
  | {
      command: "CMD_OPTIONS_GET_OBSERVABILITY_SNAPSHOT";
      context: Record<string, never>;
    }
  | {
      command: "CMD_OPTIONS_CLEAR_OBSERVABILITY_EVENTS";
      context: Record<string, never>;
    }
  | {
      command: "CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT";
      context: { event: ObservabilityEvent };
    }
  | {
      command: "CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_MODULES";
      context: { modules: string[] };
    }
  | {
      command: "CMD_OPTIONS_REPORT_OBSERVABILITY_EVENT";
      context: { event: ObservabilityEvent };
    }
  | {
      command: "CMD_OPTIONS_REPORT_OBSERVABILITY_MODULES";
      context: { modules: string[] };
    }
  | {
      command: "CMD_GET_AUTO_LANGUAGE_STATUS";
      context: GetAutoLanguageStatusContext;
    };
export type ConfigMessage = Extract<Message, { command: "CMD_BACKGROUND_PAGE_SET_CONFIG" }>;
export type PredictRequestMessage = Extract<
  Message,
  { command: "CMD_BACKGROUND_PAGE_PREDICT_REQ" }
>;
export type PredictResponseMessage = Extract<
  Message,
  { command: "CMD_BACKGROUND_PAGE_PREDICT_RESP" }
>;
export type ToggleActiveTabMessage = Extract<Message, { command: "CMD_TOGGLE_FT_ACTIVE_TAB" }>;
export type TriggerActiveTabMessage = Extract<Message, { command: "CMD_TRIGGER_FT_ACTIVE_TAB" }>;
export type ReviewActiveTabMessage = Extract<Message, { command: "CMD_REVIEW_FT_ACTIVE_TAB" }>;
export type ContentScriptAddToDictionaryMessage = Extract<
  Message,
  { command: "CMD_CONTENT_SCRIPT_ADD_TO_DICTIONARY" }
>;
export type ContentScriptReviewSpellingMessage = Extract<
  Message,
  { command: "CMD_CONTENT_SCRIPT_REVIEW_SPELLING" }
>;
/** Words to look up for review; `before` is up to two preceding words, for ranking. */
export interface ReviewSpellingRequestContext {
  lang: string;
  words: Array<{ word: string; before: string }>;
}
/** Per word: null when known, else Presage's candidates. `ok: false`: no dictionary for the language. */
export type ReviewSpellingResponse = { ok: true; results: Array<string[] | null> } | { ok: false };
export type UpdateLangConfigMessage = Extract<
  Message,
  { command: "CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG" }
>;
export type ContentScriptPredictRequestMessage = Extract<
  Message,
  { command: "CMD_CONTENT_SCRIPT_PREDICT_REQ" }
>;
export type OptionsPageConfigChangeMessage = Extract<
  Message,
  { command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE" }
>;
export type ContentScriptGetConfigMessage = Extract<
  Message,
  { command: "CMD_CONTENT_SCRIPT_GET_CONFIG" }
>;
export type PopupPageEnableMessage = Extract<Message, { command: "CMD_POPUP_PAGE_ENABLE" }>;
export type PopupPageDisableMessage = Extract<Message, { command: "CMD_POPUP_PAGE_DISABLE" }>;
export type PopupPageStatusMessage = Extract<Message, { command: "CMD_STATUS_COMMAND" }>;
export type ContentScriptUsageEventMessage = Extract<
  Message,
  { command: "CMD_CONTENT_SCRIPT_USAGE_EVENT" }
>;
export type ContentScriptPersonalizationEventMessage = Extract<
  Message,
  { command: "CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT" }
>;
export type ContentScriptRuntimeStatusMessage = Extract<
  Message,
  { command: "CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS" }
>;
export type PopupGetProductivityStatsMessage = Extract<
  Message,
  { command: "CMD_POPUP_GET_PRODUCTIVITY_STATS" }
>;
export type PopupAckWeeklyRecapMessage = Extract<
  Message,
  { command: "CMD_POPUP_ACK_WEEKLY_RECAP" }
>;
export type PopupAckDonationMilestoneMessage = Extract<
  Message,
  { command: "CMD_POPUP_ACK_DONATION_MILESTONE" }
>;
