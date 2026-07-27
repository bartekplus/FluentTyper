import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class TechnicalTokenCompactionRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "technicalTokenCompaction" as const;
  readonly name = "Technical Token Compaction";
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

    if (punctChar === "." && this.isDigit(lastChar) && this.isDigit(charBeforePunct)) {
      return this.createEdit(`.${lastChar}`, 3, "Compacted technical decimal notation");
    }

    if (punctChar === ":" && this.isDigit(lastChar) && this.isDigit(charBeforePunct)) {
      return this.createEdit(`:${lastChar}`, 3, "Compacted technical time or ratio notation");
    }

    return null;
  }
}
