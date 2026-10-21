// Facade: the rule's code is in grammar/rules/common.yaml (technicalTokenCompaction.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export class TechnicalTokenCompactionRule implements GrammarRule {
  readonly id = "technicalTokenCompaction" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
