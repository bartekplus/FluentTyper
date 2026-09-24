import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { isLowercaseLetter } from "./helpers/GenericRuleShared";

export class CapitalizeAfterLineBreakRule implements GrammarRule {
  readonly id = "capitalizeAfterLineBreak" as const;
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    if (text.length === 0) {
      return null;
    }

    const lastChar = text[text.length - 1];
    if (!isLowercaseLetter(lastChar)) {
      return null;
    }

    let i = text.length - 2;
    // Spanish "¿Qué" / "¡Hola": the letter after the inverted mark starts the line.
    if (text[i] === "¿" || text[i] === "¡") {
      i -= 1;
    }
    while (i >= 0 && SPACE_CHARS.includes(text[i])) {
      i -= 1;
    }

    if (i >= 0 && text[i] === "\n") {
      return {
        replacement: lastChar.toUpperCase(),
        deleteBackwards: 1,
        deleteForwards: 0,
      };
    }

    return null;
  }
}
