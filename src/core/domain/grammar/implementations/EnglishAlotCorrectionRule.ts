// Facade: the rule's code is in grammar/rules/common.yaml (englishAlotCorrection.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export { ALOT_REGEX, correctAlot } from "../review/rules/common.generated";

export class EnglishAlotCorrectionRule implements GrammarRule {
  readonly id = "englishAlotCorrection" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
