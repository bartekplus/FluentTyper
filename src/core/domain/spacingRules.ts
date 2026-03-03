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
  ">": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "!": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  ":": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  ";": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  "?": { spaceBefore: Spacing.REMOVE_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  "[": { spaceBefore: Spacing.INSERT_SPACE, spaceAfter: Spacing.REMOVE_SPACE },
  "(": { spaceBefore: Spacing.INSERT_SPACE, spaceAfter: Spacing.REMOVE_SPACE },
  "{": { spaceBefore: Spacing.INSERT_SPACE, spaceAfter: Spacing.REMOVE_SPACE },
  "<": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "/": { spaceBefore: Spacing.INSERT_SPACE, spaceAfter: Spacing.INSERT_SPACE },
  "—": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "–": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "-": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "’": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "*": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "+": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "=": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
};

export const SPACE_CHARS: string[] = ["\xA0", " "];
