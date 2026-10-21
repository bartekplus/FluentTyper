// Facade: the rule's code is in grammar/rules/common.yaml (englishArticleAnCorrection.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export {
  ARTICLE_REGEX,
  correctArticle,
  isArticleContext,
  SENTENCE_START_REGEX,
} from "../review/rules/common.generated";

export class EnglishArticleAnCorrectionRule implements GrammarRule {
  readonly id = "englishArticleAnCorrection" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
