import { TextTargetAdapter, type TextTarget } from "./TextTargetAdapter";
import type { PredictionRequest, PredictionResponse, SuggestionEntry } from "./types";
import type { PredictionInputAction } from "@core/domain/messageTypes";
import { createLogger } from "@core/application/logging/Logger";
import {
  createPredictionTraceContext,
  resolveTraceAgeMs,
  type PredictionTraceContext,
} from "../predictionTrace";

const FIRST_CHAR_DEBOUNCE_CAP_MS = 12;
const logger = createLogger("SuggestionPredictionCoordinator");

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
  private separatorRegexNeedsReset: boolean;

  constructor(options: SuggestionPredictionCoordinatorOptions) {
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

    const beforeCursor =
      beforeCursorOverride ?? TextTargetAdapter.snapshot(entry.elem as TextTarget).beforeCursor;
    const traceContext = createPredictionTraceContext();

    if (force) {
      this.requestPrediction(
        entry,
        true,
        clearSuggestions,
        inputAction,
        beforeCursor,
        afterCursorOverride,
        traceContext,
      );
      return;
    }

    const debounceMs = this.resolveDebounceMs(inputAction, beforeCursor);
    logger.debug("Scheduled prediction request", {
      traceId: traceContext.traceId,
      requestId: entry.requestId + 1,
      suggestionId: entry.id,
      inputAction: inputAction || "other",
      debounceMs,
      tokenLength: this.findMentionToken(beforeCursor).token.length,
    });

    entry.pendingRequestTimer = setTimeout(() => {
      entry.pendingRequestTimer = null;
      this.requestPrediction(
        entry,
        false,
        clearSuggestions,
        inputAction,
        beforeCursor,
        afterCursorOverride,
        traceContext,
      );
    }, debounceMs);
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
    const beforeCursor =
      beforeCursorOverride ?? TextTargetAdapter.snapshot(entry.elem as TextTarget).beforeCursor;
    this.requestPrediction(
      entry,
      false,
      clearSuggestions,
      inputAction,
      beforeCursor,
      afterCursorOverride,
      createPredictionTraceContext(),
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
    traceContext: PredictionTraceContext = createPredictionTraceContext(),
  ): void {
    const snapshot = TextTargetAdapter.snapshot(entry.elem as TextTarget);
    const beforeCursor = beforeCursorOverride ?? snapshot.beforeCursor;
    const afterCursor = afterCursorOverride ?? snapshot.afterCursor;

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
    logger.debug("Dispatching prediction request", {
      traceId: traceContext.traceId,
      requestId: entry.requestId,
      suggestionId: entry.id,
      inputAction: inputAction || "other",
      requestAgeMs: resolveTraceAgeMs(traceContext.traceStartedAtMs),
      tokenLength: tokenInfo.token.length,
    });

    this.getPrediction(
      this.createPredictionRequest({
        beforeCursor,
        afterCursor,
        suggestionId: entry.id,
        requestId: entry.requestId,
        inputAction,
        traceContext,
      }),
    );
  }

  private createPredictionRequest({
    beforeCursor,
    afterCursor,
    suggestionId,
    requestId,
    inputAction,
    traceContext,
  }: {
    beforeCursor: string;
    afterCursor: string;
    suggestionId: number;
    requestId: number;
    inputAction?: PredictionInputAction;
    traceContext: PredictionTraceContext;
  }): PredictionRequest {
    return {
      text: beforeCursor,
      nextChar: afterCursor.charAt(0) || "",
      suggestionId,
      requestId,
      lang: this.lang,
      traceId: traceContext.traceId,
      traceStartedAtMs: traceContext.traceStartedAtMs,
      ...(inputAction ? { inputAction } : {}),
    };
  }

  private resolveDebounceMs(
    inputAction?: PredictionInputAction,
    beforeCursor: string = "",
  ): number {
    const isFirstTokenChar = this.findMentionToken(beforeCursor).token.length <= 1;
    if (inputAction === "insert") {
      return isFirstTokenChar
        ? Math.min(this.debounceByAction.insert, FIRST_CHAR_DEBOUNCE_CAP_MS)
        : this.debounceByAction.insert;
    }
    if (inputAction === "delete") {
      return this.debounceByAction.delete;
    }
    return isFirstTokenChar
      ? Math.min(this.debounceByAction.other, FIRST_CHAR_DEBOUNCE_CAP_MS)
      : this.debounceByAction.other;
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
