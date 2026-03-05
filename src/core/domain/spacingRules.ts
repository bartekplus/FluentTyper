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
  "/": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "—": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "–": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "-": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "’": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "*": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "+": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
  "=": { spaceBefore: Spacing.NO_CHANGE, spaceAfter: Spacing.NO_CHANGE },
};

export const SPACE_CHARS: string[] = ["\xA0", " "];
export const ZERO_WIDTH_FILLER_CHARS: string[] = ["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF"];
export const SPACING_OR_FILLER_CHARS: string[] = [...SPACE_CHARS, ...ZERO_WIDTH_FILLER_CHARS];
