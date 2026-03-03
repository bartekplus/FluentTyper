import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "./types";
export class GrammarRuleEngine {
  private rules: Map<string, GrammarRule> = new Map();
  private pipelines: Map<GrammarEventType, string[]> = new Map();

  constructor() {
    this.pipelines.set("insertChar", []);
    this.pipelines.set("wordBoundary", []);
    this.pipelines.set("idle", []);
    this.pipelines.set("paste", []);
  }

  registerRule(rule: GrammarRule) {
    this.rules.set(rule.id, rule);
    for (const trigger of rule.triggers) {
      if (!this.pipelines.has(trigger)) {
        this.pipelines.set(trigger, []);
      }
      const pipeline = this.pipelines.get(trigger);
      if (pipeline) {
        pipeline.push(rule.id);
      }
    }
  }

  process(
    event: GrammarEventType,
    context: GrammarContext,
    enabledRules?: string[],
  ): GrammarEdit[] {
    const pipeline = this.pipelines.get(event) || [];
    let currentContext = { ...context };
    const appliedEdits: GrammarEdit[] = [];

    // Iterate to a steady state (max 5 iterations to prevent infinite loops)
    let iteration = 0;
    const MAX_ITERATIONS = 5;
    let madeChanges = true;

    while (madeChanges && iteration < MAX_ITERATIONS) {
      madeChanges = false;
      iteration++;

      for (const ruleId of pipeline) {
        if (enabledRules && !enabledRules.includes(ruleId)) {
          continue;
        }

        const rule = this.rules.get(ruleId);
        if (!rule) {
          continue;
        }

        try {
          const result = rule.apply(currentContext);
          if (!result) {
            continue;
          }

          const edits = Array.isArray(result) ? result : [result];
          if (edits.length === 0) {
            continue;
          }

          for (const edit of edits) {
            appliedEdits.push(edit);
            currentContext = this.applyEditToContext(currentContext, edit);
            madeChanges = true;
          }
        } catch {
          // Rule evaluation failed, silently ignore to prevent breaking prediction flow
        }
      }
    }

    if (iteration === MAX_ITERATIONS) {
      // Reached max iterations, possible infinite loop detected. Silently return what we have.
    }

    return this.mergeEdits(appliedEdits);
  }

  private applyEditToContext(context: GrammarContext, edit: GrammarEdit): GrammarContext {
    let before = context.beforeCursor;
    let after = context.afterCursor;

    if (edit.deleteBackwards > 0) {
      before = before.slice(0, -edit.deleteBackwards);
    }
    if (edit.deleteForwards > 0) {
      after = after.slice(edit.deleteForwards);
    }

    before += edit.replacement;

    return {
      ...context,
      beforeCursor: before,
      afterCursor: after,
    };
  }

  /**
   * Squashes multiple sequential edits into a single GrammarEdit.
   *
   * NOTE: The downstream transport (ForceReplaceType / Tribute) does not support
   * forward deletion. If any rule produces deleteForwards > 0, this method
   * clamps it to 0 and logs a warning. To support forward deletion, extend
   * ForceReplaceType and the Tribute replaceText path first.
   */
  private mergeEdits(edits: GrammarEdit[]): GrammarEdit[] {
    if (edits.length === 0) {
      return [];
    }

    let totalDeleteForwards = 0;

    // Simplified squashing assuming sequential application at the cursor:
    let accumulatedString = "";
    let baseDeleteBackwards = 0;

    for (const edit of edits) {
      // If an edit deletes backwards more than we have in accumulated string
      const deleteIntoBase = Math.max(0, edit.deleteBackwards - accumulatedString.length);
      baseDeleteBackwards += deleteIntoBase;
      const keepAccumulated = accumulatedString.length - edit.deleteBackwards + deleteIntoBase;
      accumulatedString = accumulatedString.slice(0, keepAccumulated) + edit.replacement;

      totalDeleteForwards += edit.deleteForwards;
    }

    // Guard: ForceReplaceType / Tribute apply path only supports backward deletion.
    // Clamp deleteForwards to 0 so this limitation is explicit rather than a silent data loss.
    if (totalDeleteForwards > 0) {
      console.warn(
        `[GrammarRuleEngine] mergeEdits produced deleteForwards=${totalDeleteForwards}, ` +
          `but the downstream transport (ForceReplaceType) does not support forward deletion. ` +
          `Clamping to 0. Extend ForceReplaceType and Tribute to support this.`,
      );
      totalDeleteForwards = 0;
    }

    return [
      {
        replacement: accumulatedString,
        deleteBackwards: baseDeleteBackwards,
        deleteForwards: totalDeleteForwards,
        description: "Merged edits",
      },
    ];
  }
}
