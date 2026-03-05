import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { isDeleteInputAction, shouldSkipGenericReplacement } from "./helpers/GenericRuleShared";

export class DuplicatePunctuationCollapseRule implements GrammarRule {
  readonly id = "duplicatePunctuationCollapse" as const;
  readonly name = "Duplicate Punctuation Collapse";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (isDeleteInputAction(context)) {
      return null;
    }

    const input = context.beforeCursor;
    if (input.length < 2) {
      return null;
    }

    const immediate = this.resolveImmediateDuplicate(input);
    if (immediate) {
      return immediate;
    }

    return this.resolveTrailingDoublePeriod(input);
  }

  private resolveImmediateDuplicate(input: string): GrammarEdit | null {
    const last = input.charAt(input.length - 1);
    const prev = input.charAt(input.length - 2);

    if (last !== prev || ![",", ";", ":"].includes(last)) {
      return null;
    }

    const prefix = input.slice(0, -2);
    if (shouldSkipGenericReplacement(prefix)) {
      return null;
    }

    return {
      replacement: last,
      deleteBackwards: 2,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Collapsed duplicate punctuation",
    };
  }

  private resolveTrailingDoublePeriod(input: string): GrammarEdit | null {
    if (!input.endsWith(" ")) {
      return null;
    }

    const core = input.slice(0, -1);
    if (!core.endsWith("..") || core.endsWith("...")) {
      return null;
    }

    const prefix = core.slice(0, -2);
    if (shouldSkipGenericReplacement(prefix)) {
      return null;
    }

    return {
      replacement: ". ",
      deleteBackwards: 3,
      deleteForwards: 0,
      confidence: "medium",
      safetyTier: "advanced",
      description: "Collapsed accidental double period",
    };
  }
}
