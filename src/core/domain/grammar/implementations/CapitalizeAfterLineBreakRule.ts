import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";

export class CapitalizeAfterLineBreakRule implements GrammarRule {
  readonly id = "capitalizeAfterLineBreak" as const;
  readonly name = "Capitalize After Line Break";
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    if (text.length === 0) {
      return null;
    }

    const lastChar = text[text.length - 1];
    if (lastChar.toLowerCase() === lastChar.toUpperCase() || lastChar !== lastChar.toLowerCase()) {
      return null;
    }

    let i = text.length - 2;
    while (i >= 0 && SPACE_CHARS.includes(text[i]) && text[i] !== "\n") {
      i -= 1;
    }

    if (i >= 0 && text[i] === "\n") {
      return {
        replacement: lastChar.toUpperCase(),
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Capitalized after line break",
      };
    }

    return null;
  }
}
