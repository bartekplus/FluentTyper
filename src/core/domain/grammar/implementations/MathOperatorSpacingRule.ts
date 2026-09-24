import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class MathOperatorSpacingRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "mathOperatorSpacing" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    const rightIndex = inputStr.length - 1;
    if (rightIndex < 2) {
      return null;
    }

    const rightChar = inputStr[rightIndex];
    const operatorIndex = rightIndex - 1;
    const operatorChar = inputStr[operatorIndex];
    if (!SpacingRuleShared.MATH_OPERATORS.has(operatorChar)) {
      return null;
    }
    if (
      context.hints?.measurementContext === "prose" &&
      /(?:^|[^\p{L}\p{N}_.])[-+]?[0-9]+(?:[.,][0-9]*)?[eE][+-][0-9]$/u.test(inputStr.slice(-128))
    ) {
      return null;
    }

    // "100+ users", "Node 18+ to run": a space is not a right operand, so the
    // "+" is a suffix. "Call +1": a bare word on the left is not one either.
    if (/\s/.test(rightChar)) {
      return null;
    }

    const leftOperand = this.readLeftOperand(inputStr, operatorIndex);
    if (!leftOperand) {
      return null;
    }

    // "--port=8080", "?q=1&page=2", "FOO=bar", "<a href=": flag, query and
    // assignment syntax, not prose arithmetic.
    const beforeOperand = inputStr.slice(Math.max(0, leftOperand.start - 2), leftOperand.start);
    if (operatorChar === "=" && /[-?&`<]/.test(beforeOperand)) {
      return null;
    }
    // A number ending a name ("FOO2", "var1") is part of that name.
    const standaloneNumber =
      leftOperand.kind === "number" && !this.isIdentifierChar(inputStr[leftOperand.start - 1]);
    if (
      operatorChar === "=" &&
      !standaloneNumber &&
      leftOperand.text === leftOperand.text.toUpperCase()
    ) {
      // "FOO=bar" and "FOO2=bar" are environment variables; "2=2" is arithmetic.
      return null;
    }

    if (operatorChar === "=") {
      if (!this.isEqualsRightOperandLike(rightChar)) {
        return null;
      }
    } else if (!this.isArithmeticOperatorContext(operatorChar, leftOperand, rightChar)) {
      return null;
    }

    // "Call +1 555", "i'm +1 on that": a sign separated from the word before it
    // belongs to the number. "y+1" stays arithmetic.
    if (
      operatorChar === "+" &&
      leftOperand.kind === "identifier" &&
      this.isDigit(rightChar) &&
      /\s/.test(inputStr[operatorIndex - 1] ?? "")
    ) {
      return null;
    }

    return this.createEdit(
      `${leftOperand.text} ${operatorChar} ${rightChar}`,
      inputStr.length - leftOperand.start,
    );
  }
}
