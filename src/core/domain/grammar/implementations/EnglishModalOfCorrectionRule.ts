// Facade: the rule's code is in grammar/rules/common.yaml (englishModalOfCorrection.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export {
  isNounMight,
  MODAL_OF_REGEX,
  modalHaveWord,
  OF_IDIOMS,
} from "../review/rules/common.generated";

export class EnglishModalOfCorrectionRule implements GrammarRule {
  readonly id = "englishModalOfCorrection" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
