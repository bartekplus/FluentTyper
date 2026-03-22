import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  SPACE_CHARS,
  SPACING_RULES,
  Spacing,
  type SpacingRule as SpacingPolicy,
} from "../../spacingRules";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class SpacingRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "spacingRule";
  readonly name = "Spacing Rule";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  constructor(insertSpaceAfterAutocomplete: boolean = true) {
    super(insertSpaceAfterAutocomplete);
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
    const previousChar = inputStr[length - 2];
    const charBeforePrevious = inputStr[length - 3];

    if (!previousChar || !SPACING_RULES[lastChar]) {
      return null;
    }

    const effectivePolicy = this.resolveEffectiveSpacingRule(inputStr, lastChar, length - 1);
    if (
      !effectivePolicy ||
      (charBeforePrevious !== undefined && SPACE_CHARS.includes(charBeforePrevious))
    ) {
      return null;
    }

    const requiresSpaceBefore = effectivePolicy.spaceBefore === Spacing.INSERT_SPACE;
    const requiresNoSpaceBefore = effectivePolicy.spaceBefore === Spacing.REMOVE_SPACE;
    const hasSpaceBefore = SPACE_CHARS.includes(previousChar);
    const insertSpaceAfter =
      this.insertSpaceAfterAutocomplete && effectivePolicy.spaceAfter === Spacing.INSERT_SPACE;
    const spaceBeforeViolated =
      (requiresSpaceBefore && !hasSpaceBefore) || (requiresNoSpaceBefore && hasSpaceBefore);

    if (this.resolveInputAction(context) === "delete" && !spaceBeforeViolated && insertSpaceAfter) {
      return null;
    }
    if (!spaceBeforeViolated && !insertSpaceAfter) {
      return null;
    }

    if (spaceBeforeViolated) {
      const replacement = `${requiresSpaceBefore ? "\xA0" : ""}${lastChar}${insertSpaceAfter ? "\xA0" : ""}`;
      return {
        replacement,
        deleteBackwards: hasSpaceBefore ? 2 : 1,
        deleteForwards: 0,
        confidence: "high",
        description: "Applied standard spacing rules for punctuation",
      };
    }

    return {
      replacement: `${lastChar}\xA0`,
      deleteBackwards: 1,
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

  private applyMathOperatorNormalization(inputStr: string): GrammarEdit | null {
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

    return {
      replacement: `${leftOperand.text}\xA0${operatorChar}\xA0${rightChar}`,
      deleteBackwards: inputStr.length - leftOperand.start,
      deleteForwards: 0,
      confidence: "high",
      description: "Applied context-aware math operator spacing",
    };
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

    if (SpacingRuleShared.OPENING_BRACKETS.has(lastChar)) {
      return this.resolveOpeningBracketRule(inputStr, lastChar, lastIndex, baseRule);
    }
    if (SpacingRuleShared.CLOSING_BRACKETS.has(lastChar)) {
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

  // Preserve the legacy spacing rule's narrower straight-quote heuristic.
  protected override isEqualsRightOperandLike(ch: string | undefined): boolean {
    if (!ch) {
      return false;
    }
    if (this.isIdentifierStartChar(ch) || this.isDigit(ch)) {
      return true;
    }
    if (["'", '"', "`"].includes(ch)) {
      return true;
    }
    return SpacingRuleShared.OPENING_BRACKETS.has(ch);
  }
}
