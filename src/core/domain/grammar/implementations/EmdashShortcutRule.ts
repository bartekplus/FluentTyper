import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { isDeleteInputAction, shouldSkipGenericReplacement } from "./helpers/GenericRuleShared";

export class EmdashShortcutRule implements GrammarRule {
  readonly id = "emdashShortcut" as const;
  readonly name = "Emdash Shortcut";
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (isDeleteInputAction(context)) {
      return null;
    }

    const input = context.beforeCursor;
    if (!input.endsWith("--") || input.endsWith("---")) {
      return null;
    }

    const prefix = input.slice(0, -2);
    if (!prefix || /\s$/.test(prefix)) {
      return null;
    }

    if (shouldSkipGenericReplacement(prefix)) {
      return null;
    }

    return {
      replacement: "—",
      deleteBackwards: 2,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Replaced double hyphen with em dash",
    };
  }
}
