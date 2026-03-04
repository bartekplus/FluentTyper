import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import type { PredictionRequest, PredictionResponse, SuggestionEntry } from "./types";
import type { PredictionInputAction } from "@core/domain/messageTypes";

interface SuggestionPredictionCoordinatorOptions {
  debounceByAction: {
    insert: number;
    delete: number;
    other: number;
  };
  getPrediction: (context: PredictionRequest) => void;
  lang: string;
  minWordLengthToPredict: number;
  separatorRegex: RegExp;
  grammarRulesEnabled: boolean;
}

export class SuggestionPredictionCoordinator {
  private readonly debounceByAction: {
    insert: number;
    delete: number;
    other: number;
  };
  private readonly getPrediction: (context: PredictionRequest) => void;

  private lang: string;
  private minWordLengthToPredict: number;
  private separatorRegex: RegExp;
  private grammarRulesEnabled: boolean;

  constructor(options: SuggestionPredictionCoordinatorOptions) {
    this.debounceByAction = options.debounceByAction;
    this.getPrediction = options.getPrediction;
    this.lang = options.lang;
    this.minWordLengthToPredict = options.minWordLengthToPredict;
    this.separatorRegex = options.separatorRegex;
    this.grammarRulesEnabled = options.grammarRulesEnabled;
  }

  public updateLang(lang: string, separatorRegex: RegExp): void {
    this.lang = lang;
    this.separatorRegex = separatorRegex;
  }

  public updateGrammarRulesEnabled(enabled: boolean): void {
    this.grammarRulesEnabled = enabled;
  }

  public schedule(
    entry: SuggestionEntry,
    {
      force,
      clearSuggestions,
      inputAction,
    }: {
      force: boolean;
      clearSuggestions: () => void;
      inputAction?: PredictionInputAction;
    },
  ): void {
    this.cancelPending(entry);

    if (force) {
      this.requestPrediction(entry, true, clearSuggestions, inputAction);
      return;
    }

    entry.pendingRequestTimer = setTimeout(() => {
      entry.pendingRequestTimer = null;
      this.requestPrediction(entry, false, clearSuggestions, inputAction);
    }, this.resolveDebounceMs(inputAction));
  }

  public reconcile(
    entry: SuggestionEntry,
    {
      clearSuggestions,
      inputAction,
    }: {
      clearSuggestions: () => void;
      inputAction?: PredictionInputAction;
    },
  ): void {
    this.cancelPending(entry);
    this.requestPrediction(entry, false, clearSuggestions, inputAction);
  }

  public cancelPending(entry: SuggestionEntry): void {
    if (entry.pendingRequestTimer === null) {
      return;
    }
    clearTimeout(entry.pendingRequestTimer);
    entry.pendingRequestTimer = null;
  }

  public shouldProcessResponse(
    entry: SuggestionEntry,
    response: PredictionResponse,
    {
      isEntryFocused,
      applyTextEdit,
      clearSuggestions,
    }: {
      isEntryFocused: boolean;
      applyTextEdit: () => void;
      clearSuggestions: () => void;
    },
  ): boolean {
    const isCurrentRequest = entry.requestId === response.requestId;
    const hasTextEdit = response.textEdit != null;

    if (!isCurrentRequest && !hasTextEdit) {
      return false;
    }

    if (response.textEdit && isEntryFocused) {
      applyTextEdit();
    }

    if (!isCurrentRequest) {
      return false;
    }

    if (!isEntryFocused) {
      clearSuggestions();
      return false;
    }

    return true;
  }

  private requestPrediction(
    entry: SuggestionEntry,
    force: boolean,
    clearSuggestions: () => void,
    inputAction?: PredictionInputAction,
  ): void {
    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const beforeCursor = snapshot.beforeCursor;

    const shouldPredict = this.shouldPredict(beforeCursor);
    const shouldRequestForGrammar = this.shouldRequestGrammarEdit(beforeCursor);
    if (!force && !shouldPredict && !shouldRequestForGrammar) {
      // No new request will be sent, so bump the request id to invalidate
      // any in-flight responses from previous input states.
      entry.requestId += 1;
      clearSuggestions();
      return;
    }
    if (!shouldPredict) {
      clearSuggestions();
    }

    const tokenInfo = this.findMentionToken(beforeCursor);
    entry.latestMentionText = tokenInfo.token;
    entry.latestMentionStart = tokenInfo.start;
    entry.requestId += 1;

    this.getPrediction(
      this.createPredictionRequest({
        beforeCursor,
        afterCursor: snapshot.afterCursor,
        suggestionId: entry.id,
        requestId: entry.requestId,
        inputAction,
      }),
    );
  }

  private createPredictionRequest({
    beforeCursor,
    afterCursor,
    suggestionId,
    requestId,
    inputAction,
  }: {
    beforeCursor: string;
    afterCursor: string;
    suggestionId: number;
    requestId: number;
    inputAction?: PredictionInputAction;
  }): PredictionRequest {
    return {
      text: beforeCursor,
      nextChar: afterCursor.charAt(0) || "",
      suggestionId,
      requestId,
      lang: this.lang,
      ...(inputAction ? { inputAction } : {}),
    };
  }

  private shouldRequestGrammarEdit(beforeCursor: string): boolean {
    if (!this.grammarRulesEnabled || beforeCursor.length === 0) {
      return false;
    }
    return true;
  }

  private resolveDebounceMs(inputAction?: PredictionInputAction): number {
    if (inputAction === "insert") {
      return this.debounceByAction.insert;
    }
    if (inputAction === "delete") {
      return this.debounceByAction.delete;
    }
    return this.debounceByAction.other;
  }

  private shouldPredict(beforeCursor: string): boolean {
    if (this.minWordLengthToPredict === -1) {
      return false;
    }

    const lastChar = beforeCursor.charAt(beforeCursor.length - 1) || "";
    if (lastChar && this.isSeparator(lastChar)) {
      return this.minWordLengthToPredict === 0;
    }

    const token = this.findMentionToken(beforeCursor).token;
    return token.length >= this.minWordLengthToPredict;
  }

  private isSeparator(value: string): boolean {
    if (this.separatorRegex.global || this.separatorRegex.sticky) {
      this.separatorRegex.lastIndex = 0;
    }
    return this.separatorRegex.test(value);
  }

  private findMentionToken(beforeCursor: string): { token: string; start: number } {
    let start = beforeCursor.length;
    while (start > 0) {
      const current = beforeCursor.charAt(start - 1);
      if (this.isSeparator(current)) {
        break;
      }
      start -= 1;
    }
    return { token: beforeCursor.slice(start), start };
  }
}
