import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class OpeningBracketSpacingRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "openingBracketSpacing" as const;
  readonly name = "Opening Bracket Spacing";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    if (!inputStr || inputStr.length < 2) {
      return null;
    }

    const openingIndex = inputStr.length - 1;
    const openingBracket = inputStr[openingIndex];
    if (!SpacingRuleShared.OPENING_BRACKETS.has(openingBracket)) {
      return null;
    }

    const previousChar = inputStr[openingIndex - 1];
    const hasSpaceBefore = SPACE_CHARS.includes(previousChar);

    let requiresSpaceBefore = true;
    if (openingBracket === "(" && this.isControlKeywordBeforeIndex(inputStr, openingIndex)) {
      requiresSpaceBefore = true;
    } else if (
      openingBracket === "{" &&
      this.findPreviousSignificantChar(inputStr, openingIndex - 1) === ")"
    ) {
      requiresSpaceBefore = true;
    } else if (this.isTightlyAttached(inputStr, openingIndex)) {
      // Preserve attached code-like forms such as function calls.
      requiresSpaceBefore = false;
    }

    if (requiresSpaceBefore && !hasSpaceBefore) {
      return this.createEdit(` ${openingBracket}`, 1, "Applied opening bracket spacing");
    }

    return null;
  }
}
