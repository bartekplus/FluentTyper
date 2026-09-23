import type { GrammarEdit } from "../../types";
import { SPACE_CHARS } from "../../../spacingRules";

const OPENING_BY_CLOSING_BRACKET = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
]);

export abstract class SpacingRuleShared {
  protected static readonly MATH_OPERATORS = new Set(["=", "+", "*"]);
  protected static readonly OPENING_BRACKETS = new Set(["(", "[", "{"]);
  protected static readonly CLOSING_BRACKETS = new Set([")", "]", "}"]);
  protected static readonly CONTROL_KEYWORDS = new Set(["if", "for", "while", "switch", "catch"]);
  protected static readonly QUOTE_CHARS = new Set(['"', "'", "`", "”", "’"]);

  protected readonly insertSpaceAfterAutocomplete: boolean;

  constructor(insertSpaceAfterAutocomplete: boolean = true) {
    this.insertSpaceAfterAutocomplete = insertSpaceAfterAutocomplete;
  }

  protected createEdit(replacement: string, deleteBackwards: number): GrammarEdit {
    return {
      replacement,
      deleteBackwards,
      deleteForwards: 0,
    };
  }

  protected isDigit(ch: string | undefined): boolean {
    return typeof ch === "string" && ch >= "0" && ch <= "9";
  }

  protected isIdentifierChar(ch: string | undefined): boolean {
    return typeof ch === "string" && /[A-Za-z0-9_$]/.test(ch);
  }

  protected isIdentifierStartChar(ch: string | undefined): boolean {
    return typeof ch === "string" && /[A-Za-z_$]/.test(ch);
  }

  protected findPreviousSignificantIndex(inputStr: string, startIndex: number): number | null {
    for (let i = startIndex; i >= 0; i -= 1) {
      const ch = inputStr[i];
      if (!SPACE_CHARS.includes(ch)) {
        return i;
      }
    }
    return null;
  }

  protected findPreviousSignificantChar(inputStr: string, startIndex: number): string | null {
    const index = this.findPreviousSignificantIndex(inputStr, startIndex);
    return index === null ? null : inputStr[index];
  }

  protected readIdentifierTokenBoundsAt(
    inputStr: string,
    index: number,
  ): { start: number; end: number } | null {
    if (!this.isIdentifierChar(inputStr[index])) {
      return null;
    }

    let start = index;
    while (start > 0 && this.isIdentifierChar(inputStr[start - 1])) {
      start -= 1;
    }

    let end = index;
    while (end + 1 < inputStr.length && this.isIdentifierChar(inputStr[end + 1])) {
      end += 1;
    }

    return { start, end };
  }

  protected readNumericTokenBoundsAt(
    inputStr: string,
    index: number,
  ): { start: number; end: number } | null {
    if (!this.isDigit(inputStr[index])) {
      return null;
    }

    let start = index;
    while (start > 0 && /[0-9.]/.test(inputStr[start - 1])) {
      start -= 1;
    }

    let end = index;
    while (end + 1 < inputStr.length && /[0-9.]/.test(inputStr[end + 1])) {
      end += 1;
    }

    return { start, end };
  }

  protected readLeftOperand(
    inputStr: string,
    operatorIndex: number,
  ): { start: number; text: string; kind: "identifier" | "number" | "closingBracket" } | null {
    const leftIndex = this.findPreviousSignificantIndex(inputStr, operatorIndex - 1);
    if (leftIndex === null) {
      return null;
    }

    const leftChar = inputStr[leftIndex];
    if (SpacingRuleShared.CLOSING_BRACKETS.has(leftChar)) {
      return { start: leftIndex, text: leftChar, kind: "closingBracket" };
    }

    if (this.isDigit(leftChar)) {
      const numericBounds = this.readNumericTokenBoundsAt(inputStr, leftIndex);
      if (!numericBounds) {
        return null;
      }
      return {
        start: numericBounds.start,
        text: inputStr.slice(numericBounds.start, numericBounds.end + 1),
        kind: "number",
      };
    }

    const tokenBounds = this.readIdentifierTokenBoundsAt(inputStr, leftIndex);
    if (!tokenBounds) {
      return null;
    }

    return {
      start: tokenBounds.start,
      text: inputStr.slice(tokenBounds.start, tokenBounds.end + 1),
      kind: "identifier",
    };
  }

  protected isEqualsRightOperandLike(ch: string | undefined): boolean {
    return (
      !!ch &&
      (this.isIdentifierStartChar(ch) ||
        this.isDigit(ch) ||
        SpacingRuleShared.QUOTE_CHARS.has(ch) ||
        SpacingRuleShared.OPENING_BRACKETS.has(ch))
    );
  }

  protected isArithmeticOperatorContext(
    operatorChar: string,
    leftOperand: { text: string; kind: "identifier" | "number" | "closingBracket" },
    rightChar: string,
  ): boolean {
    if (!["+", "*"].includes(operatorChar)) {
      return false;
    }

    if (leftOperand.kind === "number" || this.isDigit(rightChar)) {
      return true;
    }
    // Single-letter identifiers on both sides: "a+b", "x*y".
    return (
      leftOperand.kind === "identifier" &&
      leftOperand.text.length === 1 &&
      this.isIdentifierStartChar(rightChar)
    );
  }

  protected isTightlyAttached(inputStr: string, index: number): boolean {
    if (index <= 0) {
      return false;
    }
    return !SPACE_CHARS.includes(inputStr[index - 1]);
  }

  protected isControlKeywordBeforeIndex(inputStr: string, index: number): boolean {
    const previousIndex = this.findPreviousSignificantIndex(inputStr, index - 1);
    if (previousIndex === null) {
      return false;
    }

    const tokenBounds = this.readIdentifierTokenBoundsAt(inputStr, previousIndex);
    if (!tokenBounds) {
      return false;
    }

    const token = inputStr.slice(tokenBounds.start, tokenBounds.end + 1).toLowerCase();
    if (!SpacingRuleShared.CONTROL_KEYWORDS.has(token)) {
      return false;
    }

    const charBeforeToken = tokenBounds.start > 0 ? inputStr[tokenBounds.start - 1] : undefined;
    return !this.isIdentifierChar(charBeforeToken);
  }

  protected isLikelyCodeContinuationChar(ch: string): boolean {
    return this.isIdentifierChar(ch) || [")", "]", "}", ".", "'", '"', "`"].includes(ch);
  }

  protected getOpeningBracket(closingBracket: string): string | null {
    return OPENING_BY_CLOSING_BRACKET.get(closingBracket) ?? null;
  }

  protected findMatchingOpeningIndex(
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
