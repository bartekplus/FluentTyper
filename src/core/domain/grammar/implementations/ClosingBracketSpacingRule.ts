// Facade: the rule's code is in grammar/rules/common.yaml (closingBracketSpacing.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export class ClosingBracketSpacingRule implements GrammarRule {
  readonly id = "closingBracketSpacing" as const;
  private readonly rule: GrammarRule;
  readonly triggers: GrammarRule["triggers"];

  constructor(insertSpaceAfterAutocomplete = true) {
    this.rule = liveRule(this.id, { insertSpaceAfterAutocomplete });
    this.triggers = this.rule.triggers;
  }

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
