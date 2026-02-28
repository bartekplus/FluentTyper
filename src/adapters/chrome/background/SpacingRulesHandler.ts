// spacingRulesHandler.ts
// Handles spacing rules logic for FluentTyper

import type { ForceReplaceType } from "@core/domain/messageTypes";
import {
  SPACING_RULES,
  SPACE_CHARS,
  Spacing,
  type SpacingRule,
} from "@core/domain/spacingRules";

export { SPACING_RULES, SPACE_CHARS, Spacing, type SpacingRule };

export class SpacingRulesHandler {
  insertSpaceAfterAutocomplete: boolean;
  applySpacingRulesEnabled: boolean = false;

  constructor(
    insertSpaceAfterAutocomplete: boolean = true,
    applySpacingRulesEnabled: boolean = false,
  ) {
    this.insertSpaceAfterAutocomplete = insertSpaceAfterAutocomplete;
    this.applySpacingRulesEnabled = applySpacingRulesEnabled;
  }

  static get Spacing() {
    return Spacing;
  }

  static get SPACING_RULES() {
    return SPACING_RULES;
  }

  static get SPACE_CHARS() {
    return SPACE_CHARS;
  }

  applySpacingRules(inputStr: string): ForceReplaceType | null {
    if (!inputStr || this.applySpacingRulesEnabled === false) {
      return null;
    }
    const { length } = inputStr;
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
    if (
      (SPACING_RULES[lastChar].spaceBefore === Spacing.INSERT_SPACE) ===
      SPACE_CHARS.includes(lastCharMin1)
    ) {
      return null;
    }
    const insertSpaceBefore =
      SPACING_RULES[lastChar].spaceBefore === Spacing.INSERT_SPACE;
    const insertSpaceAfter =
      this.insertSpaceAfterAutocomplete &&
      SPACING_RULES[lastChar].spaceAfter === Spacing.INSERT_SPACE;
    const text = `${insertSpaceBefore ? "\xA0" : ""}${lastChar}${
      insertSpaceAfter ? "\xA0" : ""
    }`;
    if (
      text === lastChar &&
      SPACING_RULES[lastChar].spaceBefore !== Spacing.REMOVE_SPACE
    ) {
      return null;
    }
    return {
      text,
      length: 2 - Number(insertSpaceBefore),
    };
  }
}
