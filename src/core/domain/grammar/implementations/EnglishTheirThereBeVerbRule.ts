// Facade: the rule's code is in grammar/rules/common.yaml (englishTheirThereBeVerb.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export { THEIR_THERE_BE_REGEX } from "../review/rules/common.generated";

export class EnglishTheirThereBeVerbRule implements GrammarRule {
  readonly id = "englishTheirThereBeVerb" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
