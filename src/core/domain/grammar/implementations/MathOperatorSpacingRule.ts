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
      (/(?:^|[^\p{L}\p{N}_.])[-+]?[0-9]+(?:[.,][0-9]*)?[eE][+-][0-9]$/u.test(
        inputStr.slice(-128),
      ) ||
        /[0-9]-[0-9]$/.test(inputStr))
    ) {
      return null;
    }

    const leftOperand = this.readLeftOperand(inputStr, operatorIndex);
    if (!leftOperand) {
      return null;
    }

    if (operatorChar === "=") {
      if (!this.isEqualsRightOperandLike(rightChar)) {
        return null;
      }
    } else if (!this.isArithmeticOperatorContext(operatorChar, leftOperand, rightChar)) {
      return null;
    }

    return this.createEdit(
      `${leftOperand.text} ${operatorChar} ${rightChar}`,
      inputStr.length - leftOperand.start,
    );
  }
}
