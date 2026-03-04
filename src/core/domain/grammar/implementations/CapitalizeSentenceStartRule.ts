import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";

const SENTENCE_ENDING_CHARS = new Set([".", "!", "?"]);
const CLOSING_CHARS = new Set([")", "]", "}", '"', "'", "”", "’"]);

export class CapitalizeSentenceStartRule implements GrammarRule {
  readonly id = "capitalizeSentenceStart" as const;
  readonly name = "Capitalize Sentence Start";
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    if (text.length === 0) {
      return null;
    }

    const lastChar = text[text.length - 1];
    if (lastChar.toLowerCase() === lastChar.toUpperCase() || lastChar !== lastChar.toLowerCase()) {
      return null;
    }

    let i = text.length - 2;
    while (i >= 0 && SPACE_CHARS.includes(text[i]) && text[i] !== "\n") {
      i -= 1;
    }

    // Capitalize first letter of a fresh sequence.
    if (i < 0) {
      return {
        replacement: lastChar.toUpperCase(),
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "medium",
        description: "Capitalized sequence start",
      };
    }

    const hadWhitespaceGap = i < text.length - 2;
    while (i >= 0 && CLOSING_CHARS.has(text[i])) {
      i -= 1;
    }

    if (i >= 0 && SENTENCE_ENDING_CHARS.has(text[i]) && hadWhitespaceGap) {
      return {
        replacement: lastChar.toUpperCase(),
        deleteBackwards: 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Capitalized sentence start",
      };
    }

    return null;
  }
}
