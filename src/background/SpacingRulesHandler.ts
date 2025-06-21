// spacingRulesHandler.ts
// Handles spacing rules logic for FluentTyper

import { ForceReplaceType } from "../shared/messageTypes";
export enum Spacing {
  INSERT_SPACE = "INSERT_SPACE",
  REMOVE_SPACE = "REMOVE_SPACE",
  NO_CHANGE = "NO_CHANGE",
}

export interface SpacingRule {
  spaceBefore: Spacing;
  spaceAfter: Spacing;
}

export const SPACING_RULES: Record<string, SpacingRule> = {
  ".": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  ",": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  "]": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  ")": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  "}": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  ">": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  "!": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  ":": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  ";": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  "?": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  "[": { spaceBefore: Spacing.INSERT_SPACE, spaceAfter: Spacing.REMOVE_SPACE },
  "(": { spaceBefore: Spacing.INSERT_SPACE, spaceAfter: Spacing.REMOVE_SPACE },
  "{": { spaceBefore: Spacing.INSERT_SPACE, spaceAfter: Spacing.REMOVE_SPACE },
  "<": { spaceBefore: Spacing.INSERT_SPACE, spaceAfter: Spacing.REMOVE_SPACE },
  "/": { spaceBefore: Spacing.INSERT_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  // TODO: Validate spacing rules for below symbols
  "—": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "–": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "-": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "’": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "*": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "+": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "=": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
};

export const SPACE_CHARS: string[] = ["\xA0", " "];

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
    if (text === lastChar) {
      return null;
    }
    return {
      text,
      length: 2 - Number(insertSpaceBefore),
    };
  }
}
