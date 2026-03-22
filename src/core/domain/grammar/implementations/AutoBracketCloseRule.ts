import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { isDeleteInputAction } from "./helpers/GenericRuleShared";

const PAIRS = new Map<string, string>([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["'", "'"],
  ['"', '"'],
  ["`", "`"],
  ["<", ">"],
  ["«", "»"],
]);

const CLOSING_TO_OPENING = new Map<string, string>();
for (const [open, close] of PAIRS) {
  CLOSING_TO_OPENING.set(close, open);
}

const SYMMETRIC_QUOTES = new Set(["'", '"', "`"]);

const WORD_CHAR_REGEX = /[\p{L}\p{N}]/u;

export class AutoBracketCloseRule implements GrammarRule {
  readonly id = "autoBracketClose" as const;
  readonly name = "Auto-close Brackets and Quotes";
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (isDeleteInputAction(context)) {
      return null;
    }

    const { beforeCursor, afterCursor } = context;
    if (beforeCursor.length === 0) {
      return null;
    }

    const typed = beforeCursor[beforeCursor.length - 1];

    // Check for overtype first: user typed a closing char and afterCursor starts with the same.
    // For symmetric quotes (', ", `), both the opening and closing char are identical,
    // so overtype fires whenever the same quote appears ahead — this is a heuristic that
    // matches IDE behavior (e.g., VS Code) but may skip over non-auto-inserted quotes.
    if (CLOSING_TO_OPENING.has(typed) && afterCursor.length > 0 && afterCursor[0] === typed) {
      return this.handleOvertype(beforeCursor, typed);
    }

    // Check for auto-close: user typed an opening char
    const closeChar = PAIRS.get(typed);
    if (closeChar) {
      return this.handleAutoClose(context, typed, closeChar);
    }

    return null;
  }

  private handleAutoClose(
    context: GrammarContext,
    openChar: string,
    closeChar: string,
  ): GrammarEdit | null {
    const { beforeCursor, afterCursor } = context;
    const beforeOpener = beforeCursor.slice(0, -1);

    // For symmetric quotes (', ", `): don't auto-close when preceded by a word character
    // (it's likely an apostrophe/contraction like "it's" or closing quote)
    if (SYMMETRIC_QUOTES.has(openChar)) {
      if (beforeOpener.length > 0 && WORD_CHAR_REGEX.test(beforeOpener[beforeOpener.length - 1])) {
        return null;
      }
    }

    // For < bracket: don't auto-close when preceded by a word character
    // (it's likely a comparison operator or HTML tag, not a quotation bracket)
    if (openChar === "<") {
      if (beforeOpener.length > 0 && WORD_CHAR_REGEX.test(beforeOpener[beforeOpener.length - 1])) {
        return null;
      }
    }

    // Don't auto-close if afterCursor already starts with the matching close char
    // (avoids doubling: typing ( when cursor is already before ))
    if (afterCursor.length > 0 && afterCursor[0] === closeChar) {
      return null;
    }

    return {
      replacement: openChar + closeChar,
      deleteBackwards: 1,
      deleteForwards: 0,
      cursorOffset: 1,
      confidence: "medium",
      safetyTier: "advanced",
      sourceRuleId: "autoBracketClose",
      description: `Auto-closed ${openChar}${closeChar}`,
    };
  }

  private handleOvertype(beforeCursor: string, closeChar: string): GrammarEdit | null {
    // For > specifically: don't overtype when preceded by certain patterns
    // that suggest comparison/shift operators (e.g., "a>", "1>", ">>")
    if (closeChar === ">") {
      const beforeTyped = beforeCursor.slice(0, -1);
      if (
        beforeTyped.length > 0 &&
        WORD_CHAR_REGEX.test(beforeTyped[beforeTyped.length - 1])
      ) {
        return null;
      }
    }

    // Cursor naturally lands at end of the single-char replacement,
    // which is the correct position (after the closing char).
    return {
      replacement: closeChar,
      deleteBackwards: 1,
      deleteForwards: 1,
      confidence: "high",
      safetyTier: "advanced",
      sourceRuleId: "autoBracketClose",
      description: `Skipped over auto-inserted ${closeChar}`,
    };
  }
}
