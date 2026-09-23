import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
import { isDeleteInputAction } from "./helpers/GenericRuleShared";
import { SpacingRuleShared } from "./helpers/SpacingRuleShared";

export class SlashContextSpacingRule extends SpacingRuleShared implements GrammarRule {
  readonly id = "slashContextSpacing" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    if (inputStr.length < 2) {
      return null;
    }

    const slashIndex = inputStr.length - 1;
    if (inputStr[slashIndex] !== "/") {
      return null;
    }

    if (this.shouldCompactProtocolSlash(inputStr, slashIndex)) {
      return this.createEdit("/", 2);
    }

    // Backspacing "A / " to "A /" must stick, or the space can never be removed.
    if (
      this.insertSpaceAfterAutocomplete &&
      !isDeleteInputAction(context) &&
      this.isSlashOperatorContext(inputStr, slashIndex)
    ) {
      return this.createEdit("/ ", 1);
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

    // "Path: /home/user" is a label, not a URL: only real schemes compact.
    const scheme = inputStr.slice(schemeStart, colonIndex).toLowerCase();
    return ["http", "https", "ftp", "ftps", "file", "ssh", "git", "ws", "wss"].includes(scheme);
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
    return !!ch && ([")", "]", "}"].includes(ch) || /[\p{L}\p{N}]/u.test(ch));
  }
}
