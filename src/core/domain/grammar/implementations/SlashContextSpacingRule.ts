import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class SlashContextSpacingRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "slashContextSpacing" as const;
  readonly name = "Slash Context Spacing";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    if (!inputStr || inputStr.length < 2) {
      return null;
    }

    const slashIndex = inputStr.length - 1;
    if (inputStr[slashIndex] !== "/") {
      return null;
    }

    if (this.shouldCompactProtocolSlash(inputStr, slashIndex)) {
      return this.createEdit("/", 2, "Compacted protocol slash spacing");
    }

    if (this.isSlashOperatorContext(inputStr, slashIndex) && this.insertSpaceAfterAutocomplete) {
      return this.createEdit("/ ", 1, "Applied slash operator spacing");
    }

    return null;
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
}
