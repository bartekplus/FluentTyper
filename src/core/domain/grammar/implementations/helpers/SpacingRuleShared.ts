import type { GrammarEdit } from "../../types";
import { SPACE_CHARS } from "../../../spacingRules";
import { lastNonSpaceBefore } from "./GenericRuleShared";

export abstract class SpacingRuleShared {
  protected static readonly OPENING_BRACKETS = new Set(["(", "[", "{"]);
  protected static readonly CLOSING_BRACKETS = new Set([")", "]", "}"]);

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

  protected findPreviousSignificantChar(inputStr: string, startIndex: number): string | null {
    return inputStr[lastNonSpaceBefore(inputStr, startIndex + 1)] ?? null;
  }

  protected isTightlyAttached(inputStr: string, index: number): boolean {
    if (index <= 0) {
      return false;
    }
    return !SPACE_CHARS.includes(inputStr[index - 1]);
  }
}
