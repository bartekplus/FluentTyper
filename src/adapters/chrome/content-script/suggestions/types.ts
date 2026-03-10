import type {
  ContentScriptPredictRequestContext,
  PredictResponseContext,
  PredictionInputAction,
} from "@core/domain/messageTypes";

export type PredictionRequest = ContentScriptPredictRequestContext;
export type PredictionResponse = PredictResponseContext;

export interface SuggestionSnapshot {
  beforeCursor: string;
  afterCursor: string;
  cursorOffset: number;
}

export interface PostEditFingerprint {
  fullText: string;
  cursorOffset: number;
  selectionCollapsed: boolean;
}

export type SuggestionElement = (HTMLInputElement | HTMLTextAreaElement | HTMLElement) & {
  tributeMenu?: HTMLElement | null;
  suggestionMenu?: HTMLElement | null;
};

export interface SuggestionManagerOptions {
  selectors: string;
  minWordLengthToPredict: number;
  autocomplete: boolean;
  autocompleteOnEnter: boolean;
  autocompleteOnTab: boolean;
  insertSpaceAfterAutocomplete: boolean;
  lang: string;
  selectByDigit: boolean;
  displayLangHeader: boolean;
  inline_suggestion: boolean;
  preferNativeAutocomplete: boolean;
  enabledGrammarRules: string[];
  userDictionaryList: string[];
  getPrediction: (context: PredictionRequest) => void;
  telemetry?: SuggestionTelemetry;
  onShadowRootDiscovered?: (root: ShadowRoot) => void;
}

export interface SuggestionTelemetry {
  recordSuggestionShown(args: { suggestionCount: number; language: string }): void;
  recordSuggestionAccepted(args: {
    triggerText: string;
    insertedText: string;
    language: string;
  }): void;
}

export interface ExtensionEditSnapshot {
  replaceStart: number;
  originalText: string;
  replacementText: string;
  cursorBefore: number;
  cursorAfter: number;
  postEditFingerprint: PostEditFingerprint;
  source: "suggestion" | "grammar";
  sourceRuleId?: string;
}

export interface ManualAutoFixSuppressionSnapshot {
  ruleKey: string;
  replaceStart: number;
  tokenStart: number;
  tokenText: string;
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
  visibleSuggestionBeforeCursorText: string | null;
  visibleSuggestionFullText: string | null;
  inlineSuggestion: string | null;
  pendingInlineAccept: boolean;
  missingTrailingSpace: boolean;
  expectedCursorPos: number;
  pendingExtensionEdit: ExtensionEditSnapshot | null;
  manualAutoFixSuppression: ManualAutoFixSuppressionSnapshot | null;
  isComposing: boolean;
  lastKeydownKey: string | null;
  lastInputAction: PredictionInputAction | null;
  lastBeforeCursorText: string | null;
  hasMultipleBlockDescendants: boolean;
  pendingRequestTimer: ReturnType<typeof setTimeout> | null;
  pendingIdleTimer: ReturnType<typeof setTimeout> | null;
  pendingGrammarPaste: boolean;
  handlers: {
    input: EventListener;
    keydown: EventListener;
    paste: EventListener;
    focus: EventListener;
    blur: EventListener;
    click: EventListener;
    compositionStart: EventListener;
    compositionEnd: EventListener;
    menuMouseDown: EventListener;
    menuClick: EventListener;
  };
}
