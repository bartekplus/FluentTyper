import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { splitTrailingSpaces } from "./helpers/GenericRuleShared";

export class CollapseRepeatedSpacesRule implements GrammarRule {
  readonly id = "collapseRepeatedSpaces" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    const trailingSpaces = splitTrailingSpaces(text).trailingSpaces.length;
    if (trailingSpaces < 2) {
      return null;
    }

    const indexBeforeSpaces = text.length - trailingSpaces - 1;
    const lineStart = text.lastIndexOf("\n", text.length - trailingSpaces) + 1;
    if (indexBeforeSpaces < lineStart) {
      // Preserve leading indentation-like spaces at line start.
      return null;
    }

    // Keep the first space: a no-break space placed on purpose ("10 kg", "« ") stays one.
    return {
      replacement: text[indexBeforeSpaces + 1],
      deleteBackwards: trailingSpaces,
      deleteForwards: 0,
    };
  }
}
