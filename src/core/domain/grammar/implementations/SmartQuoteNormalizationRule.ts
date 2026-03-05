import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isDeleteInputAction,
  isLikelyApostropheContext,
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

    const replacement =
      typed === '"'
        ? shouldOpenQuote(beforeQuote)
          ? "“"
          : "”"
        : isLikelyApostropheContext(beforeQuote)
          ? "’"
          : shouldOpenQuote(beforeQuote)
            ? "‘"
            : "’";

    if (replacement === typed) {
      return null;
    }

    return {
      replacement,
      deleteBackwards: 1,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Normalized straight quote",
    };
  }
}
