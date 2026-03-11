import type {
  ContentScriptPredictRequestContext,
  PredictResponseContext,
  PredictionInputAction,
} from "@core/domain/messageTypes";
import type { ContentEditableAdapter } from "./ContentEditableAdapter";
import type { SuggestionGrammarCoordinator } from "./SuggestionGrammarCoordinator";
import type { SuggestionPredictionCoordinator } from "./SuggestionPredictionCoordinator";
import type { SuggestionTextEditService } from "./SuggestionTextEditService";

export type PredictionRequest = ContentScriptPredictRequestContext;
export type PredictionResponse = PredictResponseContext;

export interface SuggestionSnapshot {
  beforeCursor: string;
  afterCursor: string;
  cursorOffset: number;
}

export interface EditableContext {
  kind: "text-value" | "contenteditable";
  beforeCursor: string;
  afterCursor: string;
  fullText: string;
  cursorOffset: number;
  selectionStable: boolean;
  blockContext?: {
    beforeCursor: string;
    afterCursor: string;
  } | null;
}

export interface PendingKeyFallback {
  timer: ReturnType<typeof setTimeout>;
  observer: MutationObserver | null;
  reconcileScheduled: boolean;
  inputAction: PredictionInputAction;
  expectedBeforeCursor: string | null;
  expectedFullText: string | null;
  typedKey: string | null;
  waitForTextChangeUntilMs: number | null;
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
  blockScoped?: boolean;
  postEditBlockText?: string | null;
  blockElement?: HTMLElement | null;
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
  inputEventTarget: HTMLInputElement | HTMLTextAreaElement | null;
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
  expectedCursorPosIsBlockLocal: boolean;
  expectedCursorPosBlockElement: HTMLElement | null;
  expectedCursorPosBlockText: string | null;
  pendingExtensionEdit: ExtensionEditSnapshot | null;
  suppressNextSuggestionInputPrediction: boolean;
  manualAutoFixSuppression: ManualAutoFixSuppressionSnapshot | null;
  isComposing: boolean;
  lastKeydownKey: string | null;
  lastInputAction: PredictionInputAction | null;
  lastBeforeCursorText: string | null;
  hasMultipleBlockDescendants: boolean;
  pendingRequestTimer: ReturnType<typeof setTimeout> | null;
  pendingIdleTimer: ReturnType<typeof setTimeout> | null;
  pendingGrammarPaste: boolean;
  recentInteractionTrail: string[];
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

export interface SuggestionEntrySessionOptions {
  entry: SuggestionEntry;
  editableContextResolver: {
    resolve(elem: SuggestionElement): EditableContext | null;
  };
  clearPendingFallback?: () => void;
  hideMenu: () => void;
  clearInlinePresenter: () => void;
  isFocused: () => boolean;
  displayLangHeader: boolean;
  inlineSuggestionEnabled: boolean;
  predictionCoordinator: Pick<
    SuggestionPredictionCoordinator,
    "shouldProcessResponse" | "schedule" | "reconcile" | "cancelPending" | "findMentionToken"
  >;
  grammarCoordinator: Pick<SuggestionGrammarCoordinator, "hasEnabledRules" | "run">;
  textEditService: Pick<
    SuggestionTextEditService,
    "applyGrammarEdit" | "syncManualAutoFixSuppression" | "acceptSuggestion"
  >;
  contentEditableAdapter: Pick<
    ContentEditableAdapter,
    | "getBlockContext"
    | "getBlockContextBySelection"
    | "isCollapsedSelectionBeforeBlockBoundary"
    | "getPreviousBlockTextBySelection"
    | "getActiveBlockElement"
    | "hasMultipleBlockDescendants"
  >;
  getPendingFallback?: () => PendingKeyFallback | undefined;
  renderMenu: (context: {
    suggestions: string[];
    selectedIndex: number;
    menuHeader: string | null;
    mentionText: string;
  }) => void;
  renderInline: () => void;
  recordSuggestionShown: (context: { suggestionCount: number; language: string }) => void;
  recordSuggestionAccepted: (context: {
    triggerText: string;
    insertedText: string;
    language: string;
  }) => void;
  getLang: () => string;
  insertSpaceAfterAutocomplete: boolean;
  logRenderedSuggestionPopup: (
    context: PredictionResponse,
    details: { predictionCount: number; renderer: "inline" | "menu" },
  ) => void;
  logNoVisibleSuggestions: (context: PredictionResponse) => void;
}
