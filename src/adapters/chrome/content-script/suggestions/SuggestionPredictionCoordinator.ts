import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import type { PredictionRequest, PredictionResponse, SuggestionEntry } from "./types";
import type { PredictionInputAction } from "@core/domain/messageTypes";
import type { ContentEditableAdapter } from "./ContentEditableAdapter";

interface SuggestionPredictionCoordinatorOptions {
  contentEditableAdapter: ContentEditableAdapter;
  debounceByAction: {
    insert: number;
    delete: number;
    other: number;
  };
  getPrediction: (context: PredictionRequest) => void;
  lang: string;
  minWordLengthToPredict: number;
  separatorRegex: RegExp;
}

export class SuggestionPredictionCoordinator {
  private readonly contentEditableAdapter: ContentEditableAdapter;
  private readonly debounceByAction: {
    insert: number;
    delete: number;
    other: number;
  };
  private readonly getPrediction: (context: PredictionRequest) => void;

  private lang: string;
  private minWordLengthToPredict: number;
  private separatorRegex: RegExp;
  private separatorRegexNeedsReset: boolean;

  constructor(options: SuggestionPredictionCoordinatorOptions) {
    this.contentEditableAdapter = options.contentEditableAdapter;
    this.debounceByAction = options.debounceByAction;
    this.getPrediction = options.getPrediction;
    this.lang = options.lang;
    this.minWordLengthToPredict = options.minWordLengthToPredict;
    this.separatorRegex = options.separatorRegex;
    this.separatorRegexNeedsReset = options.separatorRegex.global || options.separatorRegex.sticky;
  }

  public updateLang(lang: string, separatorRegex: RegExp): void {
    this.lang = lang;
    this.separatorRegex = separatorRegex;
    this.separatorRegexNeedsReset = separatorRegex.global || separatorRegex.sticky;
  }

  public schedule(
    entry: SuggestionEntry,
    {
      force,
      clearSuggestions,
      inputAction,
      beforeCursorOverride,
      afterCursorOverride,
    }: {
      force: boolean;
      clearSuggestions: () => void;
      inputAction?: PredictionInputAction;
      beforeCursorOverride?: string;
      afterCursorOverride?: string;
    },
  ): void {
    this.cancelPending(entry);

    if (force) {
      this.requestPrediction(
        entry,
        true,
        clearSuggestions,
        inputAction,
        beforeCursorOverride,
        afterCursorOverride,
      );
      return;
    }

    entry.pendingRequestTimer = setTimeout(() => {
      entry.pendingRequestTimer = null;
      this.requestPrediction(
        entry,
        false,
        clearSuggestions,
        inputAction,
        beforeCursorOverride,
        afterCursorOverride,
      );
    }, this.resolveDebounceMs(inputAction));
  }

  public reconcile(
    entry: SuggestionEntry,
    {
      clearSuggestions,
      inputAction,
      beforeCursorOverride,
      afterCursorOverride,
    }: {
      clearSuggestions: () => void;
      inputAction?: PredictionInputAction;
      beforeCursorOverride?: string;
      afterCursorOverride?: string;
    },
  ): void {
    this.cancelPending(entry);
    this.requestPrediction(
      entry,
      false,
      clearSuggestions,
      inputAction,
      beforeCursorOverride,
      afterCursorOverride,
    );
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
      clearSuggestions,
    }: {
      isEntryFocused: boolean;
      clearSuggestions: () => void;
    },
  ): boolean {
    const isCurrentRequest = entry.requestId === response.requestId;
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
    beforeCursorOverride?: string,
    afterCursorOverride?: string,
  ): void {
    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    let beforeCursor: string;
    let afterCursor: string;
    if (TextTargetAdapter.isTextValue(entry.elem)) {
      beforeCursor = beforeCursorOverride ?? snapshot.beforeCursor;
      afterCursor = afterCursorOverride ?? snapshot.afterCursor;
    } else {
      // Contenteditable: use block-local context at request time when it has content before cursor,
      // so we never send concatenated text from multiple paragraphs (e.g. Reddit/Lexical).
      // When block beforeCursor is empty but override is set, use override (stale-caret case).
      const blockContext =
        this.contentEditableAdapter.getBlockContext(entry.elem) ??
        this.contentEditableAdapter.getBlockContextBySelection(entry.elem);
      if (blockContext && blockContext.beforeCursor.length > 0) {
        beforeCursor = blockContext.beforeCursor;
        afterCursor = blockContext.afterCursor;
      } else if (
        blockContext &&
        typeof beforeCursorOverride === "string" &&
        beforeCursorOverride.length > 0
      ) {
        beforeCursor = beforeCursorOverride;
        afterCursor = afterCursorOverride ?? blockContext.afterCursor;
      } else if (blockContext) {
        beforeCursor = blockContext.beforeCursor;
        afterCursor = blockContext.afterCursor;
      } else {
        beforeCursor = beforeCursorOverride ?? "";
        afterCursor = afterCursorOverride ?? "";
      }
    }

    const shouldPredict = this.shouldPredict(beforeCursor);
    if (!force && !shouldPredict) {
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
        afterCursor,
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

  public isSeparator(value: string): boolean {
    if (this.separatorRegexNeedsReset) {
      this.separatorRegex.lastIndex = 0;
    }
    return this.separatorRegex.test(value);
  }

  public findMentionToken(beforeCursor: string): { token: string; start: number } {
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
