import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";

export class TrimSpaceBeforeLineBreakRule implements GrammarRule {
  readonly id = "trimSpaceBeforeLineBreak" as const;
  readonly name = "Trim Space Before Line Break";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    if (!text || !text.endsWith("\n")) {
      return null;
    }

    let i = text.length - 2;
    while (i >= 0 && SPACE_CHARS.includes(text[i])) {
      i -= 1;
    }

    const spacesBeforeNewline = text.length - 2 - i;
    if (spacesBeforeNewline <= 0) {
      return null;
    }

    return {
      replacement: "\n",
      deleteBackwards: spacesBeforeNewline + 1,
      deleteForwards: 0,
      confidence: "high",
      description: "Trimmed spaces before line break",
    };
  }
}
