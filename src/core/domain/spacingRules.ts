export enum Spacing {
  INSERT_SPACE = "INSERT_SPACE",
  REMOVE_SPACE = "REMOVE_SPACE",
  NO_CHANGE = "NO_CHANGE",
}

export interface SpacingRule {
  spaceBefore: Spacing;
  spaceAfter: Spacing;
}

// Non-Latin punctuation that behaves exactly like an ASCII mark: Arabic
// comma, semicolon and question mark.
export const PUNCTUATION_EQUIVALENTS: Readonly<Record<string, string>> = {
  "،": ",",
  "؛": ";",
  "؟": "?",
};

const BASE_SPACING_RULES: Record<string, SpacingRule> = {
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

export const SPACING_RULES: Record<string, SpacingRule> = {
  ...BASE_SPACING_RULES,
  ...Object.fromEntries(
    Object.entries(PUNCTUATION_EQUIVALENTS).map(([mark, ascii]) => [
      mark,
      BASE_SPACING_RULES[ascii],
    ]),
  ),
};

export const SPACE_CHARS: string[] = ["\xA0", " "];
export const ZERO_WIDTH_FILLER_CHARS: string[] = ["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF"];
export const SPACING_OR_FILLER_CHARS: string[] = [...SPACE_CHARS, ...ZERO_WIDTH_FILLER_CHARS];
