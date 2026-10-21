// Facade: the rule's code is in grammar/rules/common.yaml (englishYourWelcomeCorrection.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export { correctYourWelcome, YOUR_WELCOME_REGEX } from "../engine/rules/common.generated";

export class EnglishYourWelcomeCorrectionRule implements GrammarRule {
  readonly id = "englishYourWelcomeCorrection" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
