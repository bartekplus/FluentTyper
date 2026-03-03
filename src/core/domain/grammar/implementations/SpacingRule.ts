import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS, SPACING_RULES, Spacing, type SpacingRule as SpacingPolicy } from "../../spacingRules";

export class SpacingRule implements GrammarRule {
  readonly id = "spacingRule";
  readonly name = "Spacing Rule";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];
  private static readonly CODE_CUE_CHARS = new Set("=([{:+-*/%&|!<>?,".split(""));
  private static readonly OPENING_BRACKETS = new Set(["(", "[", "{"]);
  private static readonly CLOSING_BRACKETS = new Set([")", "]", "}"]);
  private static readonly CONTROL_KEYWORDS = new Set(["if", "for", "while", "switch", "catch"]);

  private insertSpaceAfterAutocomplete: boolean;

  constructor(insertSpaceAfterAutocomplete: boolean = true) {
    this.insertSpaceAfterAutocomplete = insertSpaceAfterAutocomplete;
  }

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    if (!inputStr || inputStr.length === 0) {
      return null;
    }

    const technicalCompaction = this.applyTechnicalCompaction(inputStr);
    if (technicalCompaction) {
      return technicalCompaction;
    }

    const length = inputStr.length;
    const lastChar = inputStr[length - 1];
    const lastCharMin1 = inputStr[length - 2];
    const lastCharMin2 = inputStr[length - 3];

    if (!lastCharMin1) {
      return null;
    }
    if (!SPACING_RULES[lastChar]) {
      return null;
    }
    const effectivePolicy = this.resolveEffectiveSpacingRule(inputStr, lastChar, length - 1);
    if (!effectivePolicy) {
      return null;
    }
    if (SPACE_CHARS.includes(lastCharMin2)) {
      return null;
    }

    const requiresSpaceBefore = effectivePolicy.spaceBefore === Spacing.INSERT_SPACE;
    const requiresNoSpaceBefore = effectivePolicy.spaceBefore === Spacing.REMOVE_SPACE;
    const hasSpaceBefore = SPACE_CHARS.includes(lastCharMin1);

    const insertSpaceAfter =
      this.insertSpaceAfterAutocomplete &&
      effectivePolicy.spaceAfter === Spacing.INSERT_SPACE;

    const spaceBeforeViolated =
      (requiresSpaceBefore && !hasSpaceBefore) || (requiresNoSpaceBefore && hasSpaceBefore);

    if (!spaceBeforeViolated && !insertSpaceAfter) {
      return null;
    }

    let deleteBackwards: number;
    let replacement: string;

    if (spaceBeforeViolated) {
      deleteBackwards = hasSpaceBefore ? 2 : 1;
      const idealPrefix = requiresSpaceBefore ? "\xA0" : "";
      const idealSuffix = insertSpaceAfter ? "\xA0" : "";
      replacement = `${idealPrefix}${lastChar}${idealSuffix}`;
    } else {
      deleteBackwards = 1;
      replacement = `${lastChar}\xA0`;
    }

    return {
      replacement,
      deleteBackwards,
      deleteForwards: 0,
      confidence: "high",
      description: "Applied standard spacing rules for punctuation",
    };
  }

  private applyTechnicalCompaction(inputStr: string): GrammarEdit | null {
    const length = inputStr.length;
    if (length < 4) {
      return null;
    }

    const lastChar = inputStr[length - 1];
    const maybeNbsp = inputStr[length - 2];
    const punctChar = inputStr[length - 3];
    const charBeforePunct = inputStr[length - 4];

    if (maybeNbsp !== "\xA0") {
      return null;
    }

    if (punctChar === "." && this.isDigit(lastChar) && this.isDigit(charBeforePunct)) {
      return this.createTechnicalCompactionEdit(".", lastChar, "decimal notation");
    }

    if (punctChar === ":" && this.isDigit(lastChar) && this.isDigit(charBeforePunct)) {
      return this.createTechnicalCompactionEdit(":", lastChar, "time or ratio notation");
    }

    if (
      punctChar === "." &&
      this.isIdentifierStartChar(lastChar) &&
      this.shouldCompactAccessor(inputStr, length - 3)
    ) {
      return this.createTechnicalCompactionEdit(".", lastChar, "code accessor");
    }

    return null;
  }

  private createTechnicalCompactionEdit(
    punctChar: string,
    lastChar: string,
    contextName: string,
  ): GrammarEdit {
    return {
      replacement: `${punctChar}${lastChar}`,
      deleteBackwards: 3,
      deleteForwards: 0,
      confidence: "high",
      description: `Compacted technical punctuation spacing for ${contextName}`,
    };
  }

  private shouldCompactAccessor(inputStr: string, punctIndex: number): boolean {
    const tokenEnd = punctIndex - 1;
    let tokenStart = tokenEnd;

    while (tokenStart >= 0 && this.isIdentifierChar(inputStr[tokenStart])) {
      tokenStart -= 1;
    }

    tokenStart += 1;
    if (tokenStart > tokenEnd) {
      return false;
    }

    const tokenBeforeDot = inputStr.slice(tokenStart, punctIndex);
    if (/[_$\d]/.test(tokenBeforeDot)) {
      return true;
    }

    const previousSignificant = this.findPreviousSignificantChar(inputStr, tokenStart - 1);
    if (!previousSignificant) {
      return false;
    }

    return (
      previousSignificant === "." || SpacingRule.CODE_CUE_CHARS.has(previousSignificant)
    );
  }

  private findPreviousSignificantChar(inputStr: string, startIndex: number): string | null {
    const index = this.findPreviousSignificantIndex(inputStr, startIndex);
    return index === null ? null : inputStr[index];
  }

  private findPreviousSignificantIndex(inputStr: string, startIndex: number): number | null {
    for (let i = startIndex; i >= 0; i -= 1) {
      const ch = inputStr[i];
      if (!SPACE_CHARS.includes(ch)) {
        return i;
      }
    }
    return null;
  }

  private resolveEffectiveSpacingRule(
    inputStr: string,
    lastChar: string,
    lastIndex: number,
  ): SpacingPolicy | null {
    const baseRule = SPACING_RULES[lastChar];
    if (!baseRule) {
      return null;
    }

    if (SpacingRule.OPENING_BRACKETS.has(lastChar)) {
      return this.resolveOpeningBracketRule(inputStr, lastChar, lastIndex, baseRule);
    }

    if (SpacingRule.CLOSING_BRACKETS.has(lastChar)) {
      return this.resolveClosingBracketRule(inputStr, lastChar, lastIndex);
    }

    return baseRule;
  }

  private resolveOpeningBracketRule(
    inputStr: string,
    openingBracket: string,
    openingIndex: number,
    baseRule: SpacingPolicy,
  ): SpacingPolicy {
    if (openingBracket === "(" && this.isControlKeywordBeforeIndex(inputStr, openingIndex)) {
      return baseRule;
    }

    if (openingBracket === "{" && this.findPreviousSignificantChar(inputStr, openingIndex - 1) === ")") {
      return baseRule;
    }

    if (this.isTightlyAttached(inputStr, openingIndex)) {
      return { ...baseRule, spaceBefore: Spacing.NO_CHANGE };
    }

    return baseRule;
  }

  private resolveClosingBracketRule(
    inputStr: string,
    closingBracket: string,
    closingIndex: number,
  ): SpacingPolicy {
    const shouldInsertAfter = this.isProseLikeClosingContext(inputStr, closingBracket, closingIndex);
    return {
      spaceBefore: Spacing.REMOVE_SPACE,
      spaceAfter: shouldInsertAfter ? Spacing.INSERT_SPACE : Spacing.NO_CHANGE,
    };
  }

  private isTightlyAttached(inputStr: string, index: number): boolean {
    if (index <= 0) {
      return false;
    }
    return !SPACE_CHARS.includes(inputStr[index - 1]);
  }

  private isControlKeywordBeforeIndex(inputStr: string, index: number): boolean {
    const previousIndex = this.findPreviousSignificantIndex(inputStr, index - 1);
    if (previousIndex === null) {
      return false;
    }

    const tokenBounds = this.readIdentifierTokenBoundsAt(inputStr, previousIndex);
    if (!tokenBounds) {
      return false;
    }

    const token = inputStr.slice(tokenBounds.start, tokenBounds.end + 1).toLowerCase();
    if (!SpacingRule.CONTROL_KEYWORDS.has(token)) {
      return false;
    }

    const charBeforeToken = tokenBounds.start > 0 ? inputStr[tokenBounds.start - 1] : undefined;
    return !this.isIdentifierChar(charBeforeToken);
  }

  private readIdentifierTokenBoundsAt(
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

  private isProseLikeClosingContext(
    inputStr: string,
    closingBracket: string,
    closingIndex: number,
  ): boolean {
    const openingBracket = this.getOpeningBracket(closingBracket);
    if (!openingBracket) {
      return false;
    }

    const openingIndex = this.findMatchingOpeningIndex(
      inputStr,
      closingIndex,
      openingBracket,
      closingBracket,
    );
    if (openingIndex === null) {
      const previousChar = this.findPreviousSignificantChar(inputStr, closingIndex - 1);
      if (!previousChar) {
        return true;
      }
      return !this.isLikelyCodeContinuationChar(previousChar);
    }

    if (openingIndex === 0) {
      return true;
    }

    const charBeforeOpening = inputStr[openingIndex - 1];
    if (SPACE_CHARS.includes(charBeforeOpening)) {
      if (openingBracket === "(" && this.isControlKeywordBeforeIndex(inputStr, openingIndex)) {
        return false;
      }
      return true;
    }

    if (openingBracket === "(" && this.isControlKeywordBeforeIndex(inputStr, openingIndex)) {
      return false;
    }

    return false;
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

  private getOpeningBracket(closingBracket: string): string | null {
    switch (closingBracket) {
      case ")":
        return "(";
      case "]":
        return "[";
      case "}":
        return "{";
      default:
        return null;
    }
  }

  private isLikelyCodeContinuationChar(ch: string): boolean {
    return this.isIdentifierChar(ch) || [")", "]", "}", ".", "'", '"', "`"].includes(ch);
  }

  private isDigit(ch: string | undefined): boolean {
    return typeof ch === "string" && ch >= "0" && ch <= "9";
  }

  private isIdentifierChar(ch: string | undefined): boolean {
    return typeof ch === "string" && /[A-Za-z0-9_$]/.test(ch);
  }

  private isIdentifierStartChar(ch: string | undefined): boolean {
    return typeof ch === "string" && /[A-Za-z_$]/.test(ch);
  }
}
