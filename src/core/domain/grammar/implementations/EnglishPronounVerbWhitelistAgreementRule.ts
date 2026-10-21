// Facade: the rule's code is in grammar/rules/common.yaml (englishPronounVerbWhitelistAgreement.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export { AGREEMENT_CORRECTIONS, AGREEMENT_REGEX } from "../review/rules/common.generated";

export class EnglishPronounVerbWhitelistAgreementRule implements GrammarRule {
  readonly id = "englishPronounVerbWhitelistAgreement" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
