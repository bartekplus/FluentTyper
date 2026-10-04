import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";

export class OpeningBracketSpacingRule implements GrammarRule {
  readonly id = "openingBracketSpacing" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  /**
   * "if (x){" becomes "if (x) {". Every other bracket stays where it was typed:
   * against a word ("item(s)"), against a bracket ("foo()[0]") or after a space.
   */
  apply(context: GrammarContext): GrammarEdit | null {
    return context.beforeCursor.endsWith("){")
      ? { replacement: " {", deleteBackwards: 1, deleteForwards: 0 }
      : null;
  }
}
