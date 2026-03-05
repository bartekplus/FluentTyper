import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isDeleteInputAction,
  isLikelyApostropheContext,
  splitTrailingSpaces,
  shouldOpenQuote,
  shouldSkipGenericReplacement,
} from "./helpers/GenericRuleShared";

export class SmartQuoteNormalizationRule implements GrammarRule {
  readonly id = "smartQuoteNormalization" as const;
  readonly name = "Smart Quote Normalization";
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (isDeleteInputAction(context)) {
      return null;
    }

    const input = context.beforeCursor;
    if (input.length === 0) {
      return null;
    }

    const typed = input.charAt(input.length - 1);
    if (typed !== '"' && typed !== "'") {
      return null;
    }

    const beforeQuote = input.slice(0, -1);
    if (shouldSkipGenericReplacement(beforeQuote)) {
      return null;
    }
    if (this.hasAmbiguousOrMismatchedQuoteState(beforeQuote, typed)) {
      return null;
    }

    let replacement: string;
    let deleteBackwards = 1;

    if (typed === '"') {
      const { core, trailingSpaces } = splitTrailingSpaces(beforeQuote);
      const hasPendingOpenDoubleQuote = this.countPendingOpenDoubleQuotes(core) > 0;
      const forceClosingQuoteWithSpaceTrim =
        trailingSpaces.length > 0 &&
        hasPendingOpenDoubleQuote &&
        this.endsWithLikelyQuoteContent(core);

      if (forceClosingQuoteWithSpaceTrim) {
        replacement = "”";
        deleteBackwards = 1 + trailingSpaces.length;
      } else {
        replacement = shouldOpenQuote(beforeQuote) ? "“" : "”";
      }
    } else {
      replacement = isLikelyApostropheContext(beforeQuote)
        ? "’"
        : shouldOpenQuote(beforeQuote)
          ? "‘"
          : "’";
    }

    if (replacement === typed) {
      return null;
    }

    return {
      replacement,
      deleteBackwards,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Normalized straight quote",
    };
  }

  private hasAmbiguousOrMismatchedQuoteState(inputBeforeQuote: string, typed: '"' | "'"): boolean {
    if (typed === '"') {
      return this.hasMismatchedDoubleQuoteState(inputBeforeQuote);
    }
    return this.hasMismatchedSingleQuoteState(inputBeforeQuote);
  }

  private hasMismatchedDoubleQuoteState(input: string): boolean {
    let balance = 0;

    for (let i = 0; i < input.length; i += 1) {
      const char = input.charAt(i);
      if (char === "“") {
        balance += 1;
        continue;
      }
      if (char === "”") {
        if (balance === 0) {
          return true;
        }
        balance -= 1;
        continue;
      }
      if (char !== '"') {
        continue;
      }

      const before = input.slice(0, i);
      if (shouldOpenQuote(before)) {
        balance += 1;
        continue;
      }
      if (balance === 0) {
        return true;
      }
      balance -= 1;
    }

    return false;
  }

  private countPendingOpenDoubleQuotes(input: string): number {
    let balance = 0;

    for (let i = 0; i < input.length; i += 1) {
      const char = input.charAt(i);
      if (char === "“") {
        balance += 1;
        continue;
      }
      if (char === "”") {
        if (balance > 0) {
          balance -= 1;
        }
        continue;
      }
      if (char !== '"') {
        continue;
      }
      const before = input.slice(0, i);
      if (shouldOpenQuote(before)) {
        balance += 1;
      } else if (balance > 0) {
        balance -= 1;
      }
    }

    return balance;
  }

  private endsWithLikelyQuoteContent(input: string): boolean {
    if (!input) {
      return false;
    }
    const last = input.charAt(input.length - 1);
    return /[\p{L}\p{N}\])}»›”’!?.,:;]/u.test(last);
  }

  private hasMismatchedSingleQuoteState(input: string): boolean {
    let balance = 0;

    for (let i = 0; i < input.length; i += 1) {
      const char = input.charAt(i);
      const prev = i > 0 ? input.charAt(i - 1) : "";
      const next = i + 1 < input.length ? input.charAt(i + 1) : "";
      const inWordApostrophe = this.isWordChar(prev) && this.isWordChar(next);

      if (char === "‘") {
        balance += 1;
        continue;
      }
      if (char === "’") {
        if (inWordApostrophe) {
          continue;
        }
        if (balance === 0) {
          return true;
        }
        balance -= 1;
        continue;
      }
      if (char !== "'" || inWordApostrophe) {
        continue;
      }

      const before = input.slice(0, i);
      if (shouldOpenQuote(before)) {
        balance += 1;
        continue;
      }
      if (balance === 0) {
        return true;
      }
      balance -= 1;
    }

    return false;
  }

  private isWordChar(value: string): boolean {
    return /[\p{L}\p{N}]/u.test(value);
  }
}
