import {
  applyGrammarEditToContext,
  mergeSequentialGrammarEdits,
} from "./GrammarEditSequencing";
import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "./types";

const MAX_PROCESS_ITERATIONS = 5;
const RULE_ERROR_THROTTLE_MS = 60_000;
const LEGACY_SOURCE_RULE_IDS = new Set(["spacingRule", "capitalizeFirstLetter"]);
type LegacyGrammarRuleId = "spacingRule" | "capitalizeFirstLetter";

function isLegacySourceRuleId(ruleId: GrammarRule["id"]): ruleId is LegacyGrammarRuleId {
  return LEGACY_SOURCE_RULE_IDS.has(ruleId as LegacyGrammarRuleId);
}

export class GrammarRuleEngine {
  private rules: Map<string, GrammarRule> = new Map();
  private pipelines: Map<GrammarEventType, string[]> = new Map();
  private errorCounters: Map<string, number> = new Map();
  private lastErrorTime: Map<string, number> = new Map();

  constructor() {
    for (const trigger of ["insertChar", "wordBoundary", "idle", "paste"] as const) {
      this.pipelines.set(trigger, []);
    }
  }

  registerRule(rule: GrammarRule) {
    this.rules.set(rule.id, rule);
    for (const trigger of rule.triggers) {
      this.getPipeline(trigger).push(rule.id);
    }
  }

  process(
    event: GrammarEventType,
    context: GrammarContext,
    enabledRules?: string[],
  ): GrammarEdit[] {
    const pipeline = this.getPipeline(event);
    let currentContext = { ...context };
    const appliedEdits: GrammarEdit[] = [];

    // Iterate to a steady state, but stop after a small fixed budget to avoid loops.
    for (let iteration = 0; iteration < MAX_PROCESS_ITERATIONS; iteration += 1) {
      let madeChanges = false;

      for (const ruleId of pipeline) {
        if (!this.shouldRunRule(ruleId, enabledRules)) {
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
              sourceRuleId: this.getSourceRuleId(rule, edit),
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
      const edits = this.process(event, currentContext, enabledRules);
      if (edits.length === 0) {
        continue;
      }

      for (const edit of edits) {
        accumulatedEdits.push(edit);
        currentContext = applyGrammarEditToContext(currentContext, edit);
      }
    }

    return mergeSequentialGrammarEdits(accumulatedEdits)[0] ?? null;
  }

  getDebugSnapshot(): { errorCounters: Record<string, number> } {
    return {
      errorCounters: Object.fromEntries(this.errorCounters),
    };
  }

  private getPipeline(event: GrammarEventType): string[] {
    const pipeline = this.pipelines.get(event);
    if (pipeline) {
      return pipeline;
    }

    const nextPipeline: string[] = [];
    this.pipelines.set(event, nextPipeline);
    return nextPipeline;
  }

  private shouldRunRule(ruleId: string, enabledRules?: string[]): boolean {
    return !enabledRules || enabledRules.includes(ruleId);
  }

  private getSourceRuleId(
    rule: GrammarRule,
    edit: GrammarEdit,
  ): GrammarEdit["sourceRuleId"] {
    if (edit.sourceRuleId) {
      return edit.sourceRuleId;
    }
    if (isLegacySourceRuleId(rule.id)) {
      return undefined;
    }
    return rule.id;
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
