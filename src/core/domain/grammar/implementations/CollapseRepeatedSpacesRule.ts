import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";

export class CollapseRepeatedSpacesRule implements GrammarRule {
  readonly id = "collapseRepeatedSpaces" as const;
  readonly name = "Collapse Repeated Spaces";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    if (!text || text.length < 2) {
      return null;
    }

    const lastChar = text[text.length - 1];
    if (!SPACE_CHARS.includes(lastChar)) {
      return null;
    }

    let trailingSpaces = 0;
    for (let i = text.length - 1; i >= 0; i -= 1) {
      if (!SPACE_CHARS.includes(text[i])) {
        break;
      }
      trailingSpaces += 1;
    }

    if (trailingSpaces < 2) {
      return null;
    }

    const indexBeforeSpaces = text.length - trailingSpaces - 1;
    if (indexBeforeSpaces < 0) {
      return null;
    }

    const lineStart = text.lastIndexOf("\n", text.length - trailingSpaces) + 1;
    if (indexBeforeSpaces < lineStart) {
      // Preserve leading indentation-like spaces at line start.
      return null;
    }

    return {
      replacement: " ",
      deleteBackwards: trailingSpaces,
      deleteForwards: 0,
      confidence: "high",
      description: "Collapsed repeated spaces",
    };
  }
}
