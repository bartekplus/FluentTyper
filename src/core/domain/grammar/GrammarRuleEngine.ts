import { applyGrammarEditToContext, mergeSequentialGrammarEdits } from "./GrammarEditSequencing";
import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "./types";

const MAX_PROCESS_ITERATIONS = 5;
const RULE_ERROR_THROTTLE_MS = 60_000;

export class GrammarRuleEngine {
  private rules: Map<string, GrammarRule> = new Map();
  private pipelines: Record<GrammarEventType, string[]> = {
    insertChar: [],
    wordBoundary: [],
    idle: [],
    paste: [],
  };
  private errorCounters: Map<string, number> = new Map();
  private lastErrorTime: Map<string, number> = new Map();

  registerRule(rule: GrammarRule) {
    this.rules.set(rule.id, rule);
    for (const trigger of rule.triggers) {
      this.pipelines[trigger].push(rule.id);
    }
  }

  process(
    event: GrammarEventType,
    context: GrammarContext,
    enabledRules?: string[],
  ): GrammarEdit[] {
    const pipeline = this.pipelines[event];
    let currentContext = { ...context };
    const appliedEdits: GrammarEdit[] = [];

    // Iterate to a steady state, but stop after a small fixed budget to avoid loops.
    for (let iteration = 0; iteration < MAX_PROCESS_ITERATIONS; iteration += 1) {
      let madeChanges = false;

      for (const ruleId of pipeline) {
        const rule = this.rules.get(ruleId);
        if (!rule || (enabledRules && !enabledRules.includes(ruleId))) {
          continue;
        }

        try {
          const result = rule.apply(currentContext);
          if (!result) {
            continue;
          }

          for (const edit of Array.isArray(result) ? result : [result]) {
            const enrichedEdit: GrammarEdit = {
              ...edit,
              sourceRuleId: edit.sourceRuleId ?? rule.id,
            };
            appliedEdits.push(enrichedEdit);
            currentContext = applyGrammarEditToContext(currentContext, enrichedEdit);
            madeChanges = true;
          }
        } catch (error) {
          this.recordRuleError(ruleId, error);
        }
      }

      if (!madeChanges) {
        break;
      }
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
      for (const edit of this.process(event, currentContext, enabledRules)) {
        accumulatedEdits.push(edit);
        currentContext = applyGrammarEditToContext(currentContext, edit);
      }
    }

    return mergeSequentialGrammarEdits(accumulatedEdits)[0] ?? null;
  }

  private recordRuleError(ruleId: string, error: unknown): void {
    // Rule evaluation failures are throttled per rule so one bad rule does not spam logs.
    const errorCount = (this.errorCounters.get(ruleId) || 0) + 1;
    this.errorCounters.set(ruleId, errorCount);

    const now = Date.now();
    const lastError = this.lastErrorTime.get(ruleId) || 0;
    if (now - lastError > RULE_ERROR_THROTTLE_MS) {
      console.warn(
        `[GrammarRuleEngine] Rule '${ruleId}' failed (occurrences: ${errorCount}):`,
        error,
      );
      this.lastErrorTime.set(ruleId, now);
    }
  }
}
