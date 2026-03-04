import type {
  ContentScriptPredictRequestContext,
  PredictResponseContext,
} from "@core/domain/messageTypes";

export type PredictionRequest = ContentScriptPredictRequestContext;
export type PredictionResponse = PredictResponseContext;

export interface SuggestionSnapshot {
  beforeCursor: string;
  afterCursor: string;
  cursorOffset: number;
}

export type SuggestionElement =
  (HTMLInputElement | HTMLTextAreaElement | HTMLElement) & {
    tributeMenu?: HTMLElement | null;
    suggestionMenu?: HTMLElement | null;
  };

export interface SuggestionManagerOptions {
  selectors: string;
  minWordLengthToPredict: number;
  autocomplete: boolean;
  autocompleteOnEnter: boolean;
  autocompleteOnTab: boolean;
  lang: string;
  selectByDigit: boolean;
  revertOnBackspace: boolean;
  displayLangHeader: boolean;
  inline_suggestion: boolean;
  getPrediction: (context: PredictionRequest) => void;
  telemetry?: SuggestionTelemetry;
}

export interface SuggestionTelemetry {
  recordSuggestionShown(args: { suggestionCount: number; language: string }): void;
  recordSuggestionAccepted(args: {
    triggerText: string;
    insertedText: string;
    language: string;
  }): void;
}

export interface ReplacementSnapshot {
  triggerText: string;
  insertedText: string;
  cursorAfter: number;
}

export interface SuggestionEntry {
  id: number;
  elem: SuggestionElement;
  menu: HTMLDivElement;
  list: HTMLUListElement;
  requestId: number;
  suggestions: string[];
  selectedIndex: number;
  menuHeader: string | null;
  latestMentionText: string;
  latestMentionStart: number;
  inlineSuggestion: string | null;
  pendingInlineAccept: boolean;
  missingTrailingSpace: boolean;
  expectedCursorPos: number;
  lastReplacement: ReplacementSnapshot | null;
  pendingRequestTimer: ReturnType<typeof setTimeout> | null;
  handlers: {
    input: EventListener;
    keydown: EventListener;
    focus: EventListener;
    blur: EventListener;
    click: EventListener;
    menuMouseDown: EventListener;
    menuClick: EventListener;
  };
}
