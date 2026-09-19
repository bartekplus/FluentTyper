import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class OpeningBracketSpacingRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "openingBracketSpacing" as const;
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

    // "[label](url)": the closing-bracket rule appended a prose space after "]"
    // before it could know a link target followed. Take it back, the way the
    // slash rule compacts "https: //".
    if (openingBracket === "(" && hasSpaceBefore && inputStr[openingIndex - 2] === "]") {
      return this.createEdit("(", 2);
    }

    let requiresSpaceBefore = true;
    if (openingBracket === "(" && this.isControlKeywordBeforeIndex(inputStr, openingIndex)) {
      requiresSpaceBefore = true;
    } else if (
      openingBracket === "{" &&
      this.findPreviousSignificantChar(inputStr, openingIndex - 1) === ")"
    ) {
      requiresSpaceBefore = true;
    } else if (SpacingRuleShared.CLOSING_BRACKETS.has(previousChar)) {
      // "[link](url)" and "foo()[0]": a bracket against a bracket is structure.
      requiresSpaceBefore = false;
    } else if (this.isTightlyAttached(inputStr, openingIndex)) {
      // Preserve attached code-like forms such as function calls.
      requiresSpaceBefore = false;
    }

    if (requiresSpaceBefore && !hasSpaceBefore) {
      return this.createEdit(` ${openingBracket}`, 1);
    }

    return null;
  }
}
