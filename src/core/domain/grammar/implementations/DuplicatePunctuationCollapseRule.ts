import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { SPACE_CHARS, SPACING_OR_FILLER_CHARS } from "../../spacingRules";
import { shouldSkipGenericReplacement } from "./helpers/GenericRuleShared";

export class DuplicatePunctuationCollapseRule implements GrammarRule {
  readonly id = "duplicatePunctuationCollapse" as const;
  readonly name = "Duplicate Punctuation Collapse";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];
  private static readonly COLLAPSIBLE_PUNCTUATION = new Set([",", ";", ":"]);
  apply(context: GrammarContext): GrammarEdit | null {
    const input = context.beforeCursor;
    if (input.length < 2) {
      return null;
    }

    const immediate = this.resolveImmediateDuplicate(input);
    if (immediate) {
      return immediate;
    }

    const spaced = this.resolveSpacedTrailingDuplicate(input);
    if (spaced) {
      return spaced;
    }

    const trailingDuplicate = this.resolveTrailingDuplicateBeforeSpace(input);
    if (trailingDuplicate) {
      return trailingDuplicate;
    }

    return this.resolveTrailingDoublePeriod(input);
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
      confidence: "medium",
      safetyTier: "advanced",
      description: "Collapsed duplicate punctuation",
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
      confidence: "medium",
      safetyTier: "advanced",
      description: "Collapsed duplicate punctuation",
    };
  }

  private resolveTrailingDuplicateBeforeSpace(input: string): GrammarEdit | null {
    const { core, trailingSpacing } = this.splitTrailingSpacing(input);
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
      confidence: "medium",
      safetyTier: "advanced",
      description: "Collapsed duplicate punctuation",
    };
  }

  private splitTrailingSpacing(input: string): { core: string; trailingSpacing: string } {
    let idx = input.length;
    while (idx > 0 && SPACING_OR_FILLER_CHARS.includes(input.charAt(idx - 1))) {
      idx -= 1;
    }
    return {
      core: input.slice(0, idx),
      trailingSpacing: input.slice(idx),
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
    return spacingRun.charAt(0) || "";
  }

  private measureLeadingSpaceBefore(input: string, index: number): number {
    let i = index - 1;
    let count = 0;
    while (i >= 0 && SPACE_CHARS.includes(input.charAt(i))) {
      count += 1;
      i -= 1;
    }
    return count;
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
      confidence: "medium",
      safetyTier: "advanced",
      description: "Collapsed accidental double period",
    };
  }
}
