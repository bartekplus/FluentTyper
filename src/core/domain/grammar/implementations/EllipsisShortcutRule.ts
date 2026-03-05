import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { isDeleteInputAction, shouldSkipGenericReplacement } from "./helpers/GenericRuleShared";

export class EllipsisShortcutRule implements GrammarRule {
  readonly id = "ellipsisShortcut" as const;
  readonly name = "Ellipsis Shortcut";
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (isDeleteInputAction(context)) {
      return null;
    }

    const input = context.beforeCursor;
    if (!input.endsWith("...")) {
      return null;
    }

    const prefix = input.slice(0, -3);
    if (shouldSkipGenericReplacement(prefix)) {
      return null;
    }

    return {
      replacement: "…",
      deleteBackwards: 3,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Replaced three dots with ellipsis",
    };
  }
}
