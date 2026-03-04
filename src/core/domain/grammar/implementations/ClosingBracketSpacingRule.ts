import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class ClosingBracketSpacingRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "closingBracketSpacing" as const;
  readonly name = "Closing Bracket Spacing";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    if (!inputStr || inputStr.length < 2) {
      return null;
    }

    const closingIndex = inputStr.length - 1;
    const closingBracket = inputStr[closingIndex];
    if (!SpacingRuleShared.CLOSING_BRACKETS.has(closingBracket)) {
      return null;
    }

    const prevChar = inputStr[closingIndex - 1];
    const hasSpaceBefore = SPACE_CHARS.includes(prevChar);
    const spaceBeforeViolated = hasSpaceBefore;
    const insertSpaceAfter =
      this.insertSpaceAfterAutocomplete &&
      this.isProseLikeClosingContext(inputStr, closingBracket, closingIndex);

    const inputAction = this.resolveInputAction(context);
    if (inputAction === "delete" && !spaceBeforeViolated && insertSpaceAfter) {
      return null;
    }

    if (!spaceBeforeViolated && !insertSpaceAfter) {
      return null;
    }

    return this.createEdit(
      `${closingBracket}${insertSpaceAfter ? " " : ""}`,
      spaceBeforeViolated ? 2 : 1,
      "Applied closing bracket spacing",
    );
  }

  private isProseLikeClosingContext(
    inputStr: string,
    closingBracket: string,
    closingIndex: number,
  ): boolean {
    const openingBracket = this.getOpeningBracket(closingBracket);
    if (!openingBracket) {
      return false;
    }

    const openingIndex = this.findMatchingOpeningIndex(
      inputStr,
      closingIndex,
      openingBracket,
      closingBracket,
    );

    if (openingIndex === null) {
      const previousChar = this.findPreviousSignificantChar(inputStr, closingIndex - 1);
      if (!previousChar) {
        return true;
      }
      return !this.isLikelyCodeContinuationChar(previousChar);
    }

    if (openingIndex === 0) {
      return true;
    }

    const charBeforeOpening = inputStr[openingIndex - 1];
    if (SPACE_CHARS.includes(charBeforeOpening)) {
      if (openingBracket === "(" && this.isControlKeywordBeforeIndex(inputStr, openingIndex)) {
        return false;
      }
      return true;
    }

    if (openingBracket === "(" && this.isControlKeywordBeforeIndex(inputStr, openingIndex)) {
      return false;
    }

    return false;
  }
}
