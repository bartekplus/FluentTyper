import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { capitalizeCompletedWord } from "./CapitalizeSentenceStartRule";

export class CapitalizeAfterLineBreakRule implements GrammarRule {
  readonly id = "capitalizeAfterLineBreak" as const;
  // A newline arrives as insertChar, hence both triggers.
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    return capitalizeCompletedWord(context, (text, wordStart) => {
      let i = wordStart - 1;
      while (i >= 0 && SPACE_CHARS.includes(text[i])) {
        i -= 1;
      }
      return i >= 0 && text[i] === "\n";
    });
  }
}
