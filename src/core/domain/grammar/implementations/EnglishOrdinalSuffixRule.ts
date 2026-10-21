// Facade: the rule's code is in grammar/rules/common.yaml (englishOrdinalSuffix.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export { ordinalSuffix } from "../engine/rules/common.generated";

export class EnglishOrdinalSuffixRule implements GrammarRule {
  readonly id = "englishOrdinalSuffix" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
