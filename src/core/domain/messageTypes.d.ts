import type {
  ObservabilityConfig,
  ObservabilityEvent,
  ObservabilitySnapshot,
} from "./observability";

// Context for CMD_BACKGROUND_PAGE_SET_CONFIG
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
  enabled: boolean;
  displayLangHeader: boolean;
  enabledGrammarRules: string[];
  userDictionaryList: string[];
  // Theme configuration
  themeConfig?: {
    suggestionBgLight: string;
    suggestionTextLight: string;
    suggestionHighlightBgLight: string;
    suggestionHighlightTextLight: string;
    suggestionBorderLight: string;
    suggestionBgDark: string;
    suggestionTextDark: string;
    suggestionHighlightBgDark: string;
    suggestionHighlightTextDark: string;
    suggestionBorderDark: string;
    suggestionFontSize: string;
    suggestionPaddingVertical: string;
    suggestionPaddingHorizontal: string;
  };
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
}

// Context for CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG
export interface UpdateLangConfigContext {
  lang: string;
}

// Context for CMD_CONTENT_SCRIPT_PREDICT_REQ
export interface ContentScriptPredictRequestContext {
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

// Context for CMD_OPTIONS_PAGE_CONFIG_CHANGE
export type OptionsPageConfigChangeContext = Record<string, never>;
// Context for CMD_CONTENT_SCRIPT_GET_CONFIG
export type ContentScriptGetConfigContext = Record<string, never>;
export type PopupPageEnableContext = Record<string, never>;
export type PopupPageDisableContext = Record<string, never>;
export interface PopupPageStatusContext {
  enabled: boolean;
}

export interface SuggestionAcceptedUsageEventContext {
  eventType: "suggestion_accepted";
  triggerText: string;
  typedTextLength: number;
  insertedTextLength: number;
  language: string;
}

export interface SuggestionShownUsageEventContext {
  eventType: "suggestion_shown";
  suggestionCount: number;
  language: string;
}

export interface SnippetExpandedUsageEventContext {
  eventType: "snippet_expanded";
  triggerText: string;
  typedTextLength: number;
  insertedTextLength: number;
  language: string;
}

export interface CharsInsertedFromSnippetUsageEventContext {
  eventType: "chars_inserted_from_snippet";
  amount: number;
  triggerText: string;
  language: string;
}

export interface CharsTypedForTriggerUsageEventContext {
  eventType: "chars_typed_for_trigger";
  amount: number;
  triggerText: string;
  language: string;
}

export type ContentScriptUsageEventContext =
  | SuggestionAcceptedUsageEventContext
  | SuggestionShownUsageEventContext
  | SnippetExpandedUsageEventContext
  | CharsInsertedFromSnippetUsageEventContext
  | CharsTypedForTriggerUsageEventContext;

export type PopupGetProductivityStatsContext = Record<string, never>;

export interface PopupAckWeeklyRecapContext {
  weekKey: string;
}

export type DonationPromptAction = "shown" | "supported" | "snooze";

export interface PopupAckDonationMilestoneContext {
  promptId: string;
  action: DonationPromptAction;
  milestoneHours: number | null;
}

export type OptionsResetProductivityStatsContext = Record<string, never>;
export type OptionsGetPredictorDebugSnapshotContext = Record<string, never>;
export type OptionsClearPredictorDebugTraceContext = Record<string, never>;
export type OptionsGetObservabilitySnapshotContext = Record<string, never>;
export type OptionsClearObservabilityEventsContext = Record<string, never>;
export interface ContentScriptReportObservabilityEventContext {
  event: ObservabilityEvent;
}
export interface ContentScriptReportObservabilityModulesContext {
  modules: string[];
}
export interface OptionsReportObservabilityEventContext {
  event: ObservabilityEvent;
}
export interface OptionsReportObservabilityModulesContext {
  modules: string[];
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
  source: "lifetime_threshold" | "weekly_recap";
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
  | { command: "CMD_GET_HOSTNAME" }
  | {
      command: "CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG";
      context: UpdateLangConfigContext;
    }
  | {
      command: "CMD_CONTENT_SCRIPT_PREDICT_REQ";
      context: ContentScriptPredictRequestContext;
    }
  | {
      command: "CMD_OPTIONS_PAGE_CONFIG_CHANGE";
      context: OptionsPageConfigChangeContext;
    }
  | {
      command: "CMD_CONTENT_SCRIPT_GET_CONFIG";
      context: ContentScriptGetConfigContext;
    }
  | { command: "CMD_POPUP_PAGE_ENABLE"; context: PopupPageEnableContext }
  | { command: "CMD_POPUP_PAGE_DISABLE"; context: PopupPageDisableContext }
  | { command: "CMD_STATUS_COMMAND"; context: PopupPageStatusContext }
  | {
      command: "CMD_CONTENT_SCRIPT_USAGE_EVENT";
      context: ContentScriptUsageEventContext;
    }
  | {
      command: "CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS";
      context: ContentScriptRuntimeStatusContext;
    }
  | {
      command: "CMD_POPUP_GET_PRODUCTIVITY_STATS";
      context: PopupGetProductivityStatsContext;
    }
  | {
      command: "CMD_POPUP_ACK_WEEKLY_RECAP";
      context: PopupAckWeeklyRecapContext;
    }
  | {
      command: "CMD_POPUP_ACK_DONATION_MILESTONE";
      context: PopupAckDonationMilestoneContext;
    }
  | {
      command: "CMD_OPTIONS_RESET_PRODUCTIVITY_STATS";
      context: OptionsResetProductivityStatsContext;
    }
  | {
      command: "CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT";
      context: OptionsGetPredictorDebugSnapshotContext;
    }
  | {
      command: "CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE";
      context: OptionsClearPredictorDebugTraceContext;
    }
  | {
      command: "CMD_OPTIONS_GET_OBSERVABILITY_SNAPSHOT";
      context: OptionsGetObservabilitySnapshotContext;
    }
  | {
      command: "CMD_OPTIONS_CLEAR_OBSERVABILITY_EVENTS";
      context: OptionsClearObservabilityEventsContext;
    }
  | {
      command: "CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT";
      context: ContentScriptReportObservabilityEventContext;
    }
  | {
      command: "CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_MODULES";
      context: ContentScriptReportObservabilityModulesContext;
    }
  | {
      command: "CMD_OPTIONS_REPORT_OBSERVABILITY_EVENT";
      context: OptionsReportObservabilityEventContext;
    }
  | {
      command: "CMD_OPTIONS_REPORT_OBSERVABILITY_MODULES";
      context: OptionsReportObservabilityModulesContext;
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
export type OptionsResetProductivityStatsMessage = Extract<
  Message,
  { command: "CMD_OPTIONS_RESET_PRODUCTIVITY_STATS" }
>;
export type OptionsGetPredictorDebugSnapshotMessage = Extract<
  Message,
  { command: "CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT" }
>;
export type OptionsClearPredictorDebugTraceMessage = Extract<
  Message,
  { command: "CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE" }
>;
export type OptionsGetObservabilitySnapshotMessage = Extract<
  Message,
  { command: "CMD_OPTIONS_GET_OBSERVABILITY_SNAPSHOT" }
>;
export type OptionsClearObservabilityEventsMessage = Extract<
  Message,
  { command: "CMD_OPTIONS_CLEAR_OBSERVABILITY_EVENTS" }
>;
export type ContentScriptReportObservabilityEventMessage = Extract<
  Message,
  { command: "CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT" }
>;
export type ContentScriptReportObservabilityModulesMessage = Extract<
  Message,
  { command: "CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_MODULES" }
>;
export type OptionsReportObservabilityEventMessage = Extract<
  Message,
  { command: "CMD_OPTIONS_REPORT_OBSERVABILITY_EVENT" }
>;
export type OptionsReportObservabilityModulesMessage = Extract<
  Message,
  { command: "CMD_OPTIONS_REPORT_OBSERVABILITY_MODULES" }
>;
export type GetAutoLanguageStatusMessage = Extract<
  Message,
  { command: "CMD_GET_AUTO_LANGUAGE_STATUS" }
>;

export type ObservabilitySnapshotResponse = ObservabilitySnapshot;
