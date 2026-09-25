import { TextTargetAdapter } from "./TextTargetAdapter";
import { resolveCodeContext } from "./CodeContextResolver";
import type { PredictionRequest, PredictionResponse, SuggestionEntry } from "./types";
import type { PredictionInputAction } from "@core/domain/messageTypes";
import { extractPredictionTokenSuffix } from "@core/domain/predictionToken";
import { createLogger } from "@core/application/logging/Logger";
import {
  createPredictionTraceContext,
  resolveTraceAgeMs,
  type PredictionTraceContext,
} from "../predictionTrace";

const FIRST_CHAR_DEBOUNCE_CAP_MS = 12;
const logger = createLogger("SuggestionPredictionCoordinator");

export type PredictionSessionState = Pick<
  SuggestionEntry,
  "id" | "requestId" | "latestMentionText" | "latestMentionStart" | "pendingRequestTimer"
> &
  Partial<Pick<SuggestionEntry, "elem">>;

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
  private readonly debounceByAction: SuggestionPredictionCoordinatorOptions["debounceByAction"];
  private readonly getPrediction: (context: PredictionRequest) => void;

  private lang: string;
  private minWordLengthToPredict: number;
  private separatorRegex: RegExp;

  constructor(options: SuggestionPredictionCoordinatorOptions) {
    this.debounceByAction = options.debounceByAction;
    this.getPrediction = options.getPrediction;
    this.lang = options.lang;
    this.minWordLengthToPredict = options.minWordLengthToPredict;
    this.separatorRegex = options.separatorRegex;
  }

  public updateLang(lang: string, separatorRegex: RegExp): void {
    this.lang = lang;
    this.separatorRegex = separatorRegex;
  }

  public schedule(
    entry: PredictionSessionState,
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
      beforeCursorOverride ??
      (entry.elem ? TextTargetAdapter.snapshot(entry.elem).beforeCursor : "");
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
    entry: PredictionSessionState,
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

  public cancelPending(entry: PredictionSessionState): void {
    if (entry.pendingRequestTimer === null) {
      return;
    }
    clearTimeout(entry.pendingRequestTimer);
    entry.pendingRequestTimer = null;
  }

  public shouldProcessResponse(
    entry: PredictionSessionState,
    response: PredictionResponse,
    {
      isEntryFocused,
      clearSuggestions,
    }: {
      isEntryFocused: boolean;
      clearSuggestions: () => void;
    },
  ): boolean {
    if (entry.requestId !== response.requestId) {
      return false;
    }

    if (!isEntryFocused) {
      clearSuggestions();
      return false;
    }

    return true;
  }

  private requestPrediction(
    entry: PredictionSessionState,
    force: boolean,
    clearSuggestions: () => void,
    inputAction?: PredictionInputAction,
    beforeCursorOverride?: string,
    afterCursorOverride?: string,
    traceContext: PredictionTraceContext = createPredictionTraceContext(),
  ): void {
    const snapshot =
      beforeCursorOverride === undefined || afterCursorOverride === undefined
        ? entry.elem
          ? TextTargetAdapter.snapshot(entry.elem)
          : null
        : null;
    const beforeCursor = beforeCursorOverride ?? snapshot?.beforeCursor ?? "";
    const afterCursor = afterCursorOverride ?? snapshot?.afterCursor ?? "";

    const shouldPredict = this.shouldPredict(beforeCursor);
    if (!force && !shouldPredict) {
      // No new request will be sent, so bump the request id to invalidate
      // any in-flight responses from previous input states.
      entry.requestId += 1;
      logger.debug("Suppressing prediction request for non-predictable input", {
        traceId: traceContext.traceId,
        requestId: entry.requestId,
        suggestionId: entry.id,
        inputAction: inputAction || "other",
        beforeCursorLength: beforeCursor.length,
        afterCursorLength: afterCursor.length,
        tokenLength: this.findMentionToken(beforeCursor).token.length,
      });
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

    this.getPrediction({
      ...(entry.elem && resolveCodeContext(entry.elem) !== "prose"
        ? { suppressAutoCapitalize: true }
        : {}),
      text: beforeCursor,
      nextChar: afterCursor.charAt(0),
      afterCursorTokenSuffix: extractPredictionTokenSuffix(afterCursor, (char) =>
        this.isSeparator(char),
      ),
      suggestionId: entry.id,
      requestId: entry.requestId,
      lang: this.lang,
      traceId: traceContext.traceId,
      traceStartedAtMs: traceContext.traceStartedAtMs,
      ...(inputAction ? { inputAction } : {}),
    });
  }

  private resolveDebounceMs(
    inputAction: PredictionInputAction | undefined,
    beforeCursor: string,
  ): number {
    if (inputAction === "delete") {
      return this.debounceByAction.delete;
    }
    const debounceMs =
      inputAction === "insert" ? this.debounceByAction.insert : this.debounceByAction.other;
    return this.findMentionToken(beforeCursor).token.length <= 1
      ? Math.min(debounceMs, FIRST_CHAR_DEBOUNCE_CAP_MS)
      : debounceMs;
  }

  private shouldPredict(beforeCursor: string): boolean {
    if (this.minWordLengthToPredict === -1) {
      return false;
    }

    const lastChar = beforeCursor.charAt(beforeCursor.length - 1);
    if (lastChar && this.isSeparator(lastChar)) {
      return this.minWordLengthToPredict === 0;
    }

    const token = this.findMentionToken(beforeCursor).token;
    return token.length >= this.minWordLengthToPredict;
  }

  public isSeparator(value: string): boolean {
    // Global/sticky regexes carry lastIndex between test() calls; others ignore it.
    this.separatorRegex.lastIndex = 0;
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
