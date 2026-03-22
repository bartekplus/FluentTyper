import type { GrammarContext, GrammarEdit } from "./types";

export function applyGrammarEditToContext(
  context: GrammarContext,
  edit: GrammarEdit,
): GrammarContext {
  let before = context.beforeCursor;
  let after = context.afterCursor;

  if (edit.deleteBackwards > 0) {
    before = before.slice(0, -edit.deleteBackwards);
  }
  if (edit.deleteForwards > 0) {
    after = after.slice(edit.deleteForwards);
  }

  if (edit.cursorOffset !== undefined) {
    const offset = Math.max(0, Math.min(edit.replacement.length, edit.cursorOffset));
    before += edit.replacement.slice(0, offset);
    after = edit.replacement.slice(offset) + after;
  } else {
    before += edit.replacement;
  }

  return {
    ...context,
    beforeCursor: before,
    afterCursor: after,
  };
}

export function mergeSequentialGrammarEdits(edits: GrammarEdit[]): GrammarEdit[] {
  if (edits.length === 0) {
    return [];
  }

  let totalDeleteForwards = 0;
  let mergedConfidence: GrammarEdit["confidence"] | undefined;
  let mergedSourceRuleId: GrammarEdit["sourceRuleId"] | undefined;
  let mergedSafetyTier: GrammarEdit["safetyTier"] | undefined;
  let mergedCursorOffset: number | undefined;
  let accumulatedString = "";
  let baseDeleteBackwards = 0;

  for (const edit of edits) {
    const deleteIntoBase = Math.max(0, edit.deleteBackwards - accumulatedString.length);
    baseDeleteBackwards += deleteIntoBase;
    const keepAccumulated = accumulatedString.length - edit.deleteBackwards + deleteIntoBase;
    accumulatedString = accumulatedString.slice(0, keepAccumulated) + edit.replacement;

    totalDeleteForwards += edit.deleteForwards;
    if (edit.confidence === "medium") {
      mergedConfidence = "medium";
    } else if (edit.confidence === "high" && mergedConfidence !== "medium") {
      mergedConfidence = "high";
    }
    if (edit.sourceRuleId) {
      mergedSourceRuleId = edit.sourceRuleId;
    }
    if (edit.safetyTier) {
      mergedSafetyTier = edit.safetyTier;
    }
    if (edit.cursorOffset !== undefined) {
      mergedCursorOffset = keepAccumulated + edit.cursorOffset;
    }
  }

  return [
    {
      replacement: accumulatedString,
      deleteBackwards: baseDeleteBackwards,
      deleteForwards: totalDeleteForwards,
      ...(mergedCursorOffset !== undefined ? { cursorOffset: mergedCursorOffset } : {}),
      ...(mergedConfidence ? { confidence: mergedConfidence } : {}),
      ...(mergedSourceRuleId ? { sourceRuleId: mergedSourceRuleId } : {}),
      ...(mergedSafetyTier ? { safetyTier: mergedSafetyTier } : {}),
      description: "Merged edits",
    },
  ];
}
