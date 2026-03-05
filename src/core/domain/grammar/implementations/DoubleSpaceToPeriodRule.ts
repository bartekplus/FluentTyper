import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isDeleteInputAction,
  shouldSkipGenericReplacement,
  splitTrailingSpaces,
} from "./helpers/GenericRuleShared";

const DOUBLE_SPACE_REGEX = /[ \xA0]{2}$/;

export class DoubleSpaceToPeriodRule implements GrammarRule {
  readonly id = "doubleSpaceToPeriod" as const;
  readonly name = "Double Space To Period";
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

    const lastChar = core.charAt(core.length - 1);
    if (/[.!?…]/.test(lastChar)) {
      return null;
    }

    if (/\d$/.test(core.trimEnd())) {
      return null;
    }

    if (shouldSkipGenericReplacement(core)) {
      return null;
    }

    return {
      replacement: ". ",
      deleteBackwards: 2,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Replaced double-space with sentence period",
    };
  }
}
