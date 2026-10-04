import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { lastNonSpaceBefore } from "./helpers/GenericRuleShared";
import { capitalizeCompletedWord } from "./CapitalizeSentenceStartRule";

export class CapitalizeAfterLineBreakRule implements GrammarRule {
  readonly id = "capitalizeAfterLineBreak" as const;
  // A newline arrives as insertChar, hence both triggers.
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    return capitalizeCompletedWord(
      context,
      (text, wordStart) => text[lastNonSpaceBefore(text, wordStart)] === "\n",
    );
  }
}
