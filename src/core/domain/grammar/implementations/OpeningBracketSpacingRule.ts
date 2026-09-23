import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class OpeningBracketSpacingRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "openingBracketSpacing" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    if (inputStr.length < 2) {
      return null;
    }

    const openingIndex = inputStr.length - 1;
    const openingBracket = inputStr[openingIndex];
    if (!SpacingRuleShared.OPENING_BRACKETS.has(openingBracket)) {
      return null;
    }

    const previousChar = inputStr[openingIndex - 1];
    const requiresSpaceBefore =
      (openingBracket === "(" && this.isControlKeywordBeforeIndex(inputStr, openingIndex)) ||
      (openingBracket === "{" &&
        this.findPreviousSignificantChar(inputStr, openingIndex - 1) === ")") ||
      // "[link](url)" and "foo()[0]": a bracket against a bracket is structure.
      // Otherwise preserve attached code-like forms such as function calls.
      (!SpacingRuleShared.CLOSING_BRACKETS.has(previousChar) &&
        !this.isTightlyAttached(inputStr, openingIndex));

    if (requiresSpaceBefore && !SPACE_CHARS.includes(previousChar)) {
      return this.createEdit(` ${openingBracket}`, 1);
    }

    return null;
  }
}
