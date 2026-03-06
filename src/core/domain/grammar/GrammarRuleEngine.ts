import {
  applyGrammarEditToContext,
  mergeSequentialGrammarEdit,
  mergeSequentialGrammarEdits,
} from "./GrammarEditSequencing";
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
            currentContext = applyGrammarEditToContext(currentContext, enrichedEdit);
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

    return mergeSequentialGrammarEdits(appliedEdits);
  }

  processSequence(
    events: GrammarEventType[],
    context: GrammarContext,
    enabledRules?: string[],
  ): GrammarEdit | null {
    let currentContext = { ...context };
    const accumulatedEdits: GrammarEdit[] = [];

    for (const event of events) {
      const edits = this.process(event, currentContext, enabledRules);
      if (edits.length === 0) {
        continue;
      }

      for (const edit of edits) {
        accumulatedEdits.push(edit);
        currentContext = applyGrammarEditToContext(currentContext, edit);
      }
    }

    return mergeSequentialGrammarEdit(accumulatedEdits);
  }

  getDebugSnapshot(): { errorCounters: Record<string, number> } {
    return {
      errorCounters: Object.fromEntries(this.errorCounters),
    };
  }
}
