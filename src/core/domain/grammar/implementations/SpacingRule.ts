import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS, SPACING_RULES, Spacing } from "../../spacingRules";

export class SpacingRule implements GrammarRule {
  readonly id = "spacingRule";
  readonly name = "Spacing Rule";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  private insertSpaceAfterAutocomplete: boolean;

  constructor(insertSpaceAfterAutocomplete: boolean = true) {
    this.insertSpaceAfterAutocomplete = insertSpaceAfterAutocomplete;
  }

  apply(context: GrammarContext): GrammarEdit | null {
    const inputStr = context.beforeCursor;
    if (!inputStr || inputStr.length === 0) return null;

    const length = inputStr.length;
    const lastChar = inputStr[length - 1];
    const lastCharMin1 = inputStr[length - 2];
    const lastCharMin2 = inputStr[length - 3];

    if (!lastCharMin1) return null;
    if (!SPACING_RULES[lastChar]) return null;
    if (SPACE_CHARS.includes(lastCharMin2)) return null;

    if (
      (SPACING_RULES[lastChar].spaceBefore === Spacing.INSERT_SPACE) ===
      SPACE_CHARS.includes(lastCharMin1)
    ) {
      return null;
    }

    const insertSpaceBefore = SPACING_RULES[lastChar].spaceBefore === Spacing.INSERT_SPACE;
    const insertSpaceAfter =
      this.insertSpaceAfterAutocomplete &&
      SPACING_RULES[lastChar].spaceAfter === Spacing.INSERT_SPACE;

    const text = `${insertSpaceBefore ? "\xA0" : ""}${lastChar}${insertSpaceAfter ? "\xA0" : ""}`;

    if (text === lastChar && SPACING_RULES[lastChar].spaceBefore !== Spacing.REMOVE_SPACE) {
      return null;
    }

    const deleteBackwards = 2 - Number(insertSpaceBefore);

    return {
      replacement: text,
      deleteBackwards,
      deleteForwards: 0,
      confidence: "high",
      description: "Applied standard spacing rules for punctuation",
    };
  }
}
