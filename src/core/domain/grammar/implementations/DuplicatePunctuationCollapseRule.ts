import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { PUNCTUATION_EQUIVALENTS, SPACE_CHARS, SPACING_OR_FILLER_CHARS } from "../../spacingRules";
import { shouldSkipGenericReplacement, splitTrailingSpaces } from "./helpers/GenericRuleShared";

export class DuplicatePunctuationCollapseRule implements GrammarRule {
  readonly id = "duplicatePunctuationCollapse" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];
  // ":" is excluded: "std::vector" and "a::b" are scope operators, and nothing
  // available here separates them from a doubled prose colon. Equivalent
  // marks (Arabic "،", "؛") collapse like their ASCII forms.
  private static readonly COLLAPSIBLE_PUNCTUATION = new Set([
    ",",
    ";",
    ...Object.keys(PUNCTUATION_EQUIVALENTS).filter((mark) =>
      [",", ";"].includes(PUNCTUATION_EQUIVALENTS[mark]),
    ),
  ]);
  apply(context: GrammarContext): GrammarEdit | null {
    const input = context.beforeCursor;
    if (input.length < 2) {
      return null;
    }

    return (
      this.resolveImmediateDuplicate(input) ??
      this.resolveSpacedTrailingDuplicate(input) ??
      this.resolveTrailingDuplicateBeforeSpace(input) ??
      this.resolveTrailingDoublePeriod(input)
    );
  }

  private resolveImmediateDuplicate(input: string): GrammarEdit | null {
    const last = input.charAt(input.length - 1);
    if (!DuplicatePunctuationCollapseRule.COLLAPSIBLE_PUNCTUATION.has(last)) {
      return null;
    }

    const runLength = this.measureTrailingRunLength(input, last);
    if (runLength < 2) {
      return null;
    }

    const runStart = input.length - runLength;
    const leadingSpaceCount = this.measureLeadingSpaceBefore(input, runStart);
    const prefix = input.slice(0, runStart - leadingSpaceCount);
    if (shouldSkipGenericReplacement(prefix)) {
      return null;
    }

    return {
      replacement: last,
      deleteBackwards: leadingSpaceCount + runLength,
      deleteForwards: 0,
    };
  }

  private resolveSpacedTrailingDuplicate(input: string): GrammarEdit | null {
    const lastIndex = input.length - 1;
    const last = input.charAt(lastIndex);
    if (!DuplicatePunctuationCollapseRule.COLLAPSIBLE_PUNCTUATION.has(last)) {
      return null;
    }

    let spaceRunStart = lastIndex - 1;
    while (spaceRunStart >= 0 && SPACING_OR_FILLER_CHARS.includes(input.charAt(spaceRunStart))) {
      spaceRunStart -= 1;
    }

    const spaceRunLength = lastIndex - 1 - spaceRunStart;
    if (spaceRunLength <= 0) {
      return null;
    }

    let runStart = spaceRunStart;
    while (runStart >= 0 && input.charAt(runStart) === last) {
      runStart -= 1;
    }
    const duplicateRunLength = spaceRunStart - runStart;
    if (duplicateRunLength <= 0) {
      return null;
    }

    const duplicateRunStart = runStart + 1;
    const leadingSpaceCount = this.measureLeadingSpaceBefore(input, duplicateRunStart);
    const prefix = input.slice(0, duplicateRunStart - leadingSpaceCount);
    if (shouldSkipGenericReplacement(prefix)) {
      return null;
    }

    const separatedSpaces = input.slice(spaceRunStart + 1, lastIndex);
    const collapsedSpacing = this.collapseSeparatedSpacing(separatedSpaces);
    return {
      replacement: `${last}${collapsedSpacing}`,
      deleteBackwards: leadingSpaceCount + duplicateRunLength + spaceRunLength + 1,
      deleteForwards: 0,
    };
  }

  private resolveTrailingDuplicateBeforeSpace(input: string): GrammarEdit | null {
    const { core, trailingSpaces: trailingSpacing } = splitTrailingSpaces(
      input,
      SPACING_OR_FILLER_CHARS,
    );
    if (trailingSpacing.length === 0 || core.length < 2) {
      return null;
    }

    const last = core.charAt(core.length - 1);
    if (!DuplicatePunctuationCollapseRule.COLLAPSIBLE_PUNCTUATION.has(last)) {
      return null;
    }

    const runLength = this.measureTrailingRunLength(core, last);
    if (runLength < 2) {
      return null;
    }

    const runStart = core.length - runLength;
    const leadingSpaceCount = this.measureLeadingSpaceBefore(core, runStart);
    const prefix = core.slice(0, runStart - leadingSpaceCount);
    if (shouldSkipGenericReplacement(prefix)) {
      return null;
    }

    return {
      replacement: `${last}${trailingSpacing}`,
      deleteBackwards: leadingSpaceCount + runLength + trailingSpacing.length,
      deleteForwards: 0,
    };
  }

  private measureTrailingRunLength(input: string, ch: string): number {
    let i = input.length - 1;
    while (i >= 0 && input.charAt(i) === ch) {
      i -= 1;
    }
    return input.length - 1 - i;
  }

  private collapseSeparatedSpacing(spacingRun: string): string {
    if (spacingRun.includes(" ")) {
      return " ";
    }
    if (spacingRun.includes("\xA0")) {
      return "\xA0";
    }
    return spacingRun.charAt(0);
  }

  private measureLeadingSpaceBefore(input: string, index: number): number {
    return splitTrailingSpaces(input.slice(0, index), SPACE_CHARS).trailingSpaces.length;
  }

  private resolveTrailingDoublePeriod(input: string): GrammarEdit | null {
    if (!input.endsWith(" ")) {
      return null;
    }

    const core = input.slice(0, -1);
    if (!core.endsWith("..") || core.endsWith("...")) {
      return null;
    }

    const prefix = core.slice(0, -2);
    if (shouldSkipGenericReplacement(prefix)) {
      return null;
    }

    return {
      replacement: ". ",
      deleteBackwards: 3,
      deleteForwards: 0,
    };
  }
}
