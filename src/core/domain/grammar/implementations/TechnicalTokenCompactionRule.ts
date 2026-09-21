import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class TechnicalTokenCompactionRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "technicalTokenCompaction" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    const length = inputStr.length;
    if (length < 4) {
      return null;
    }

    const lastChar = inputStr[length - 1];
    const maybeSpace = inputStr[length - 2];
    const punctChar = inputStr[length - 3];
    const charBeforePunct = inputStr[length - 4];

    if (!SPACE_CHARS.includes(maybeSpace)) {
      return null;
    }

    // "We sold 12. 5 were returned" is a sentence boundary, not a decimal, and
    // nothing here tells the two apart - only the clock form is unambiguous.

    // ponytail: "Chapter 3: 5 tips" compacts to "3:5" too. The minute digit
    // that would prove a clock has not been typed yet, and deferring would
    // change every "12: 30" fix into a two-keystroke one.
    if (punctChar === ":" && this.isDigit(lastChar) && this.isDigit(charBeforePunct)) {
      return this.createEdit(`:${lastChar}`, 3);
    }

    return null;
  }
}
