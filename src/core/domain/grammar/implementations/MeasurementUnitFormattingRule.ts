// Facade: the rule's code is in grammar/rules/common.yaml (measurementUnitFormatting.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export { isProsePrefix } from "../engine/rules/common.generated";

export class MeasurementUnitFormattingRule implements GrammarRule {
  readonly id = "measurementUnitFormatting" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
