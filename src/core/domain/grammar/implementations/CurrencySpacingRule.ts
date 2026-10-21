// Facade: the rule's code is in grammar/rules/common.yaml (currencySpacing.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export { CURRENCY_MARKERS } from "../review/rules/common.generated";

export class CurrencySpacingRule implements GrammarRule {
  readonly id = "currencySpacing" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
