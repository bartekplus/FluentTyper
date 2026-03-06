import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  SPACE_CHARS,
  SPACING_RULES,
  Spacing,
  type SpacingRule as SpacingPolicy,
} from "../../spacingRules";

export class SpacingRule implements GrammarRule {
  readonly id = "spacingRule";
  readonly name = "Spacing Rule";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];
  private static readonly CODE_CUE_CHARS = new Set("=([{:+-*/%&|!<>?,".split(""));
  private static readonly MATH_OPERATORS = new Set(["=", "+", "*"]);
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

    const mathOperatorNormalization = this.applyMathOperatorNormalization(inputStr);
    if (mathOperatorNormalization) {
      return mathOperatorNormalization;
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
      this.insertSpaceAfterAutocomplete && effectivePolicy.spaceAfter === Spacing.INSERT_SPACE;

    const spaceBeforeViolated =
      (requiresSpaceBefore && !hasSpaceBefore) || (requiresNoSpaceBefore && hasSpaceBefore);
    const inputAction = this.resolveInputAction(context);

    // Respect explicit user deletion of the auto-inserted trailing space.
    if (inputAction === "delete" && !spaceBeforeViolated && insertSpaceAfter) {
      return null;
    }

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

  private resolveInputAction(context: GrammarContext): "insert" | "delete" | "other" | null {
    const candidate = context.hints?.inputAction;
    if (candidate === "insert" || candidate === "delete" || candidate === "other") {
      return candidate;
    }
    return null;
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

  private applyMathOperatorNormalization(inputStr: string): GrammarEdit | null {
    const rightIndex = inputStr.length - 1;
    if (rightIndex < 2) {
      return null;
    }

    const rightChar = inputStr[rightIndex];
    const operatorIndex = rightIndex - 1;
    const operatorChar = inputStr[operatorIndex];
    if (!SpacingRule.MATH_OPERATORS.has(operatorChar)) {
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

    const replacement = `${leftOperand.text}\xA0${operatorChar}\xA0${rightChar}`;
    return {
      replacement,
      deleteBackwards: inputStr.length - leftOperand.start,
      deleteForwards: 0,
      confidence: "high",
      description: "Applied context-aware math operator spacing",
    };
  }

  private readLeftOperand(
    inputStr: string,
    operatorIndex: number,
  ): { start: number; text: string; kind: "identifier" | "number" | "closingBracket" } | null {
    const leftIndex = this.findPreviousSignificantIndex(inputStr, operatorIndex - 1);
    if (leftIndex === null) {
      return null;
    }

    const leftChar = inputStr[leftIndex];
    if (SpacingRule.CLOSING_BRACKETS.has(leftChar)) {
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

  private isEqualsRightOperandLike(ch: string | undefined): boolean {
    if (!ch) {
      return false;
    }
    if (this.isIdentifierStartChar(ch) || this.isDigit(ch)) {
      return true;
    }
    if (["'", '"', "`"].includes(ch)) {
      return true;
    }
    return SpacingRule.OPENING_BRACKETS.has(ch);
  }

  private isArithmeticOperatorContext(
    operatorChar: string,
    leftOperand: { text: string; kind: "identifier" | "number" | "closingBracket" },
    rightChar: string,
  ): boolean {
    if (!["+", "*"].includes(operatorChar)) {
      return false;
    }

    const leftNumeric = leftOperand.kind === "number";
    const rightNumeric = this.isDigit(rightChar);
    if (leftNumeric || rightNumeric) {
      return true;
    }

    const leftSingleIdentifier = leftOperand.kind === "identifier" && leftOperand.text.length === 1;
    const rightSingleIdentifier = this.isIdentifierStartChar(rightChar);
    return leftSingleIdentifier && rightSingleIdentifier;
  }

  private readNumericTokenBoundsAt(
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

    const previousSignificantIndex = this.findPreviousSignificantIndex(inputStr, tokenStart - 1);
    if (previousSignificantIndex === null) {
      const token = inputStr.slice(tokenStart, tokenEnd + 1);
      return /\d/.test(token) || token.startsWith("$");
    }

    // Treat cue chars as code context only when tightly attached to the token
    // before the dot (e.g. "obj.user. x"), not across sentence whitespace.
    if (previousSignificantIndex !== tokenStart - 1) {
      return false;
    }

    const previousSignificant = inputStr[previousSignificantIndex];
    return previousSignificant === "." || SpacingRule.CODE_CUE_CHARS.has(previousSignificant);
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

    if (lastChar === "/") {
      return this.resolveSlashRule(inputStr, lastIndex, baseRule);
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

    if (
      openingBracket === "{" &&
      this.findPreviousSignificantChar(inputStr, openingIndex - 1) === ")"
    ) {
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
    const shouldInsertAfter = this.isProseLikeClosingContext(
      inputStr,
      closingBracket,
      closingIndex,
    );
    return {
      spaceBefore: Spacing.REMOVE_SPACE,
      spaceAfter: shouldInsertAfter ? Spacing.INSERT_SPACE : Spacing.NO_CHANGE,
    };
  }

  private resolveSlashRule(
    inputStr: string,
    slashIndex: number,
    baseRule: SpacingPolicy,
  ): SpacingPolicy {
    if (this.shouldCompactProtocolSlash(inputStr, slashIndex)) {
      return {
        spaceBefore: Spacing.REMOVE_SPACE,
        spaceAfter: Spacing.NO_CHANGE,
      };
    }

    if (this.isSlashOperatorContext(inputStr, slashIndex)) {
      return {
        spaceBefore: Spacing.INSERT_SPACE,
        spaceAfter: Spacing.INSERT_SPACE,
      };
    }

    return baseRule;
  }

  private shouldCompactProtocolSlash(inputStr: string, slashIndex: number): boolean {
    const charBeforeSlash = inputStr[slashIndex - 1];
    if (!SPACE_CHARS.includes(charBeforeSlash)) {
      return false;
    }

    const colonIndex = slashIndex - 2;
    if (colonIndex < 1 || inputStr[colonIndex] !== ":") {
      return false;
    }

    let schemeStart = colonIndex - 1;
    while (schemeStart >= 0 && /[A-Za-z0-9+.-]/.test(inputStr[schemeStart])) {
      schemeStart -= 1;
    }

    schemeStart += 1;
    if (schemeStart >= colonIndex) {
      return false;
    }

    const scheme = inputStr.slice(schemeStart, colonIndex);
    return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme);
  }

  private isSlashOperatorContext(inputStr: string, slashIndex: number): boolean {
    const charBeforeSlash = inputStr[slashIndex - 1];
    if (!SPACE_CHARS.includes(charBeforeSlash)) {
      return false;
    }

    const previousSignificant = this.findPreviousSignificantChar(inputStr, slashIndex - 1);
    return this.isSlashOperandLike(previousSignificant);
  }

  private isSlashOperandLike(ch: string | null): boolean {
    if (!ch) {
      return false;
    }
    if ([")", "]", "}"].includes(ch)) {
      return true;
    }
    return /[\p{L}\p{N}]/u.test(ch);
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
