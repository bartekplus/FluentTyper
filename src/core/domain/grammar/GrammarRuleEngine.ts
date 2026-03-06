import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "./types";
export class GrammarRuleEngine {
  private rules: Map<string, GrammarRule> = new Map();
  private pipelines: Map<GrammarEventType, string[]> = new Map();
  private errorCounters: Map<string, number> = new Map();
  private lastErrorTime: Map<string, number> = new Map();

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
            const enrichedEdit: GrammarEdit = {
              ...edit,
              sourceRuleId:
                edit.sourceRuleId ??
                (rule.id === "spacingRule" || rule.id === "capitalizeFirstLetter"
                  ? undefined
                  : rule.id),
            };
            appliedEdits.push(enrichedEdit);
            currentContext = this.applyEditToContext(currentContext, enrichedEdit);
            madeChanges = true;
          }
        } catch (error) {
          // Rule evaluation failed, emit throttled warning to maintain observability
          // without spamming the console and breaking prediction flow.
          const errorCount = (this.errorCounters.get(ruleId) || 0) + 1;
          this.errorCounters.set(ruleId, errorCount);

          const now = Date.now();
          const lastError = this.lastErrorTime.get(ruleId) || 0;
          const THROTTLE_MS = 60000; // 1 minute per rule

          if (now - lastError > THROTTLE_MS) {
            console.warn(
              `[GrammarRuleEngine] Rule '${ruleId}' failed (occurrences: ${errorCount}):`,
              error,
            );
            this.lastErrorTime.set(ruleId, now);
          }
        }
      }
    }

    if (iteration === MAX_ITERATIONS) {
      // Reached max iterations, possible infinite loop detected. Silently return what we have.
    }

    return this.mergeEdits(appliedEdits);
  }

  getDebugSnapshot(): { errorCounters: Record<string, number> } {
    return {
      errorCounters: Object.fromEntries(this.errorCounters),
    };
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
   */
  private mergeEdits(edits: GrammarEdit[]): GrammarEdit[] {
    if (edits.length === 0) {
      return [];
    }

    let totalDeleteForwards = 0;
    let mergedConfidence: GrammarEdit["confidence"] | undefined;
    let mergedSourceRuleId: GrammarEdit["sourceRuleId"] | undefined;
    let mergedSafetyTier: GrammarEdit["safetyTier"] | undefined;

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
    }

    return [
      {
        replacement: accumulatedString,
        deleteBackwards: baseDeleteBackwards,
        deleteForwards: totalDeleteForwards,
        ...(mergedConfidence ? { confidence: mergedConfidence } : {}),
        ...(mergedSourceRuleId ? { sourceRuleId: mergedSourceRuleId } : {}),
        ...(mergedSafetyTier ? { safetyTier: mergedSafetyTier } : {}),
        description: "Merged edits",
      },
    ];
  }
}
