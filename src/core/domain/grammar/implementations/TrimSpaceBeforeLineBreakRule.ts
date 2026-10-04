import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { lastNonSpaceBefore } from "./helpers/GenericRuleShared";

export class TrimSpaceBeforeLineBreakRule implements GrammarRule {
  readonly id = "trimSpaceBeforeLineBreak" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    if (!text || !text.endsWith("\n")) {
      return null;
    }

    const spacesBeforeNewline = text.length - 2 - lastNonSpaceBefore(text, text.length - 1);
    if (spacesBeforeNewline <= 0) {
      return null;
    }

    return {
      replacement: "\n",
      deleteBackwards: spacesBeforeNewline + 1,
      deleteForwards: 0,
    };
  }
}
