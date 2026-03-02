import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";

export class CapitalizeFirstLetterRule implements GrammarRule {
  readonly id = "capitalizeFirstLetter";
  readonly name = "Capitalize First Letter";
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    if (text.length === 0) {
      return null;
    }

    const lastChar = text[text.length - 1];

    // We only capitalize valid lowercase alphabetic letters
    if (lastChar.toLowerCase() === lastChar.toUpperCase() || lastChar !== lastChar.toLowerCase()) {
      return null;
    }

    // Traverse backwards to find the previous non-space character
    let i = text.length - 2;
    while (i >= 0 && SPACE_CHARS.includes(text[i])) {
      i--;
    }

    // We allow capitalizing the very first char of the text (after spaces)
    if (i < 0) {
      return {
        replacement: lastChar.toUpperCase(),
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "medium",
        description: "Capitalized sequence start",
      };
    }

    const terminatingChar = text[i];
    if ([".", "!", "?"].includes(terminatingChar)) {
      // Must have at least one space after the sentence terminal
      if (i === text.length - 2) {
        return null;
      }

      return {
        replacement: lastChar.toUpperCase(),
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Capitalized sentence start",
      };
    }

    return null;
  }
}
