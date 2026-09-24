import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { resolveInputAction } from "./helpers/GenericRuleShared";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class ClosingBracketSpacingRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "closingBracketSpacing" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    if (inputStr.length < 2) {
      return null;
    }

    const closingIndex = inputStr.length - 1;
    const closingBracket = inputStr[closingIndex];
    if (!SpacingRuleShared.CLOSING_BRACKETS.has(closingBracket)) {
      return null;
    }

    // Typed right before the same closer (an auto-closed pair): overtyping it
    // is autoBracketClose's call, and a space here would strand that closer.
    if (context.afterCursor[0] === closingBracket) {
      return null;
    }

    const prevChar = inputStr[closingIndex - 1];
    const hasSpaceBefore = SPACE_CHARS.includes(prevChar);

    // "- [ ] todo": an empty pair is a markdown checkbox, not prose spacing.
    const openingChar = this.getOpeningBracket(closingBracket);
    if (openingChar && hasSpaceBefore && inputStr[closingIndex - 2] === openingChar) {
      return null;
    }
    // "[label](url)": a link target may follow "]", and once a space is in,
    // "see [1] (the paper)" cannot be told from it. So "]" gets no space.
    const insertSpaceAfter =
      this.insertSpaceAfterAutocomplete &&
      closingBracket !== "]" &&
      this.isProseLikeClosingContext(inputStr, closingBracket, closingIndex);

    const inputAction = resolveInputAction(context);
    if (inputAction === "delete" && !hasSpaceBefore && insertSpaceAfter) {
      return null;
    }

    if (!hasSpaceBefore && !insertSpaceAfter) {
      return null;
    }

    return this.createEdit(
      `${closingBracket}${insertSpaceAfter ? " " : ""}`,
      hasSpaceBefore ? 2 : 1,
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
      // "1)" and "a)" are list markers, not the end of a bracketed aside.
      const previousChar = this.findPreviousSignificantChar(inputStr, closingIndex - 1);
      return !previousChar || !this.isIdentifierChar(previousChar);
    }

    if (openingIndex === 0) {
      return true;
    }

    return SPACE_CHARS.includes(inputStr[openingIndex - 1]);
  }
}
