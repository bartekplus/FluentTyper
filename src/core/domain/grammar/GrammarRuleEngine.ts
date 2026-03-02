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

  private mergeEdits(edits: GrammarEdit[]): GrammarEdit[] {
    // For now, if there are multiple edits, they are logically applied in sequence.
    // If the consumer (e.g. PredictionOrchestrator) only supports a single forceReplace,
    // we need to squash them into one edit relative to the ORIGINAL cursor.
    // Actually, returning all edits or squashing them is fine, but to map to `forceReplace`
    // easily, we squash them into a single GrammarEdit.
    if (edits.length === 0) {
      return [];
    }

    let totalDeleteForwards = 0;

    // Let's do a simplified squashing assuming sequential application at the cursor:
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
