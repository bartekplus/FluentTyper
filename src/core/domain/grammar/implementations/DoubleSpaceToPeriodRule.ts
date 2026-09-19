import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isDeleteInputAction,
  shouldSkipGenericReplacement,
  splitTrailingSpaces,
} from "./helpers/GenericRuleShared";

const DOUBLE_SPACE_REGEX = /[ \xA0]{2}$/;

export class DoubleSpaceToPeriodRule implements GrammarRule {
  readonly id = "doubleSpaceToPeriod" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (isDeleteInputAction(context)) {
      return null;
    }

    const input = context.beforeCursor;
    if (!DOUBLE_SPACE_REGEX.test(input)) {
      return null;
    }

    const { core } = splitTrailingSpaces(input);
    if (core.length === 0) {
      return null;
    }

    // Only a word can end a sentence. Punctuation, brackets and quotes reach
    // here when an earlier rule already appended its own space, and turning
    // that pair into ". " wrecks "(quietly) that" and "{a: 1} now".
    if (!/\p{L}$/u.test(core)) {
      return null;
    }

    if (shouldSkipGenericReplacement(core)) {
      return null;
    }

    return {
      replacement: ". ",
      deleteBackwards: 2,
      deleteForwards: 0,
    };
  }
}
