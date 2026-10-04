import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS } from "../../spacingRules";
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

    if (this.insertSpaceAfterAutocomplete && this.isSlashOperatorContext(inputStr, slashIndex)) {
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

    // Only a math operand: a number, a single letter or a closing bracket
    // ("10 /", "x /", "(a+b) /"). After a word, "/" opens a path or switch:
    // "Open /etc/hosts", "Type /help".
    return /(?:^|\s)(?:[-+]?\p{N}+(?:[.,]\p{N}+)*|\p{L})[ \t\u00a0]+\/$|[)\]}][ \t\u00a0]+\/$/u.test(
      inputStr.slice(Math.max(0, slashIndex - 64), slashIndex + 1),
    );
  }
}
