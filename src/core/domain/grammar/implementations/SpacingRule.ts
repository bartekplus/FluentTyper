import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS, SPACING_RULES, Spacing } from "../../spacingRules";

export class SpacingRule implements GrammarRule {
  readonly id = "spacingRule";
  readonly name = "Spacing Rule";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];
  private static readonly CODE_CUE_CHARS = new Set("=([{:+-*/%&|!<>?,".split(""));

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
    if (SPACE_CHARS.includes(lastCharMin2)) {
      return null;
    }

    const requiresSpaceBefore = SPACING_RULES[lastChar].spaceBefore === Spacing.INSERT_SPACE;
    const requiresNoSpaceBefore = SPACING_RULES[lastChar].spaceBefore === Spacing.REMOVE_SPACE;
    const hasSpaceBefore = SPACE_CHARS.includes(lastCharMin1);

    const insertSpaceAfter =
      this.insertSpaceAfterAutocomplete &&
      SPACING_RULES[lastChar].spaceAfter === Spacing.INSERT_SPACE;

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
    for (let i = startIndex; i >= 0; i -= 1) {
      const ch = inputStr[i];
      if (!SPACE_CHARS.includes(ch)) {
        return ch;
      }
    }
    return null;
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
