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

const CLOSING_CHARS = new Set(PAIRS.values());

const SYMMETRIC_QUOTES = new Set(["'", '"', "`"]);

const WORD_CHAR_REGEX = /[\p{L}\p{N}]/u;

export class AutoBracketCloseRule implements GrammarRule {
  readonly id = "autoBracketClose" as const;
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (isDeleteInputAction(context)) {
      return null;
    }

    const { beforeCursor, afterCursor } = context;
    const typed = beforeCursor[beforeCursor.length - 1];

    // Check for overtype first: user typed a closing char and afterCursor starts with the same.
    // For symmetric quotes (', ", `), both the opening and closing char are identical,
    // so overtype fires whenever the same quote appears ahead — this is a heuristic that
    // matches IDE behavior (e.g., VS Code) but may skip over non-auto-inserted quotes.
    if (CLOSING_CHARS.has(typed) && afterCursor[0] === typed) {
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

    // Don't auto-close a symmetric quote (', ", `) or < preceded by a word character:
    // that is likely an apostrophe ("it's"), a closing quote, a comparison or an HTML tag.
    if (
      (SYMMETRIC_QUOTES.has(openChar) || openChar === "<") &&
      WORD_CHAR_REGEX.test(beforeOpener.at(-1) ?? "")
    ) {
      return null;
    }

    // Don't auto-close if afterCursor already starts with the matching close char
    // (avoids doubling: typing ( when cursor is already before ))
    if (afterCursor[0] === closeChar) {
      return null;
    }

    return {
      replacement: openChar + closeChar,
      deleteBackwards: 1,
      deleteForwards: 0,
      cursorOffset: 1,
      sourceRuleId: "autoBracketClose",
    };
  }

  private handleOvertype(beforeCursor: string, closeChar: string): GrammarEdit | null {
    const beforeTyped = beforeCursor.slice(0, -1);

    // For > specifically: don't overtype when preceded by certain patterns
    // that suggest comparison/shift operators (e.g., "a>", "1>", ">>")
    if (closeChar === ">" && WORD_CHAR_REGEX.test(beforeTyped.at(-1) ?? "")) {
      return null;
    }

    // For symmetric quotes: only overtype when preceded by a word character.
    // This distinguishes "user closing a quote" (e.g., "hello"|) from
    // "engine re-processing after auto-close" (e.g., "|) which would oscillate.
    if (SYMMETRIC_QUOTES.has(closeChar) && !WORD_CHAR_REGEX.test(beforeTyped.at(-1) ?? "")) {
      return null;
    }

    // Cursor naturally lands at end of the single-char replacement,
    // which is the correct position (after the closing char).
    return {
      replacement: closeChar,
      deleteBackwards: 1,
      deleteForwards: 1,
      sourceRuleId: "autoBracketClose",
    };
  }
}
