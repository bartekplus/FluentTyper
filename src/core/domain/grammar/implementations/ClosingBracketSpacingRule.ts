import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { lastNonSpaceBefore } from "./helpers/GenericRuleShared";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

const OPENING_BY_CLOSING_BRACKET = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
]);

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

    const prevChar = inputStr[closingIndex - 1];
    const hasSpaceBefore = SPACE_CHARS.includes(prevChar);

    // "- [ ] todo": an empty pair is a markdown checkbox, not prose spacing.
    const openingChar = OPENING_BY_CLOSING_BRACKET.get(closingBracket)!;
    if (hasSpaceBefore && inputStr[closingIndex - 2] === openingChar) {
      return null;
    }
    // "[label](url)": a link target may follow "]", and once a space is in,
    // "see [1] (the paper)" cannot be told from it. So "]" gets no space.
    // Typed right before the same closer (an auto-closed pair): a space here
    // would strand that closer instead of letting autoBracketClose overtype it.
    const insertSpaceAfter =
      this.insertSpaceAfterAutocomplete &&
      closingBracket !== "]" &&
      context.afterCursor[0] !== closingBracket &&
      this.isProseLikeClosingContext(inputStr, closingBracket, closingIndex);

    const inputAction = context.hints?.inputAction;
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
    const openingBracket = OPENING_BY_CLOSING_BRACKET.get(closingBracket)!;
    const openingIndex = this.findMatchingOpeningIndex(
      inputStr,
      closingIndex,
      openingBracket,
      closingBracket,
    );

    if (openingIndex === null) {
      // "1)" and "a)" are list markers, not the end of a bracketed aside.
      const previousChar = inputStr[lastNonSpaceBefore(inputStr, closingIndex)];
      return !previousChar || !this.isIdentifierChar(previousChar);
    }

    if (openingIndex === 0) {
      return true;
    }

    return SPACE_CHARS.includes(inputStr[openingIndex - 1]);
  }

  private findMatchingOpeningIndex(
    inputStr: string,
    closingIndex: number,
    openingBracket: string,
    closingBracket: string,
  ): number | null {
    let depth = 0;
    for (let i = closingIndex; i >= 0; i -= 1) {
      const ch = inputStr[i];
      if (ch === closingBracket) {
        depth += 1;
        continue;
      }
      if (ch === openingBracket) {
        depth -= 1;
        if (depth === 0) {
          return i;
        }
      }
    }
    return null;
  }
}
