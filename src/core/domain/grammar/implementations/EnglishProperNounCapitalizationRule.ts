// Facade: the rule's code is in grammar/rules/common.yaml (englishProperNounCapitalization.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export {
  couldEndProperName,
  findProperName,
  isMonthInContext,
  properNameReplacement,
} from "../engine/rules/common.generated";

export class EnglishProperNounCapitalizationRule implements GrammarRule {
  readonly id = "englishProperNounCapitalization" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
