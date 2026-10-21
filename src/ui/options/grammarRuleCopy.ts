import type { CatalogRuleId } from "@core/domain/grammar/ruleCatalog";
import { CHECK_EXAMPLES, CHECK_TEXT } from "@core/domain/grammar/engine/copy.generated";
import { i18n } from "./fluenttyperI18n.js";

/**
 * A rule's example in the language of the text it checks: the text before and after
 * the fix, or null after it for a warning without a fix. Tests run each example
 * through its rule.
 */
export interface RuleExample {
  text: readonly [before: string, after: string | null];
  lang: string;
}

/**
 * The example of each check, from `example` in grammar/rules/*.yaml. The rule compiler
 * rejects a check without one, so every catalog id has an entry.
 */
export const GRAMMAR_RULE_EXAMPLES = CHECK_EXAMPLES as Record<CatalogRuleId, RuleExample>;

/** The title and description of each Review check, from `text` in grammar/rules/*.yaml. */
export const REVIEW_RULE_TEXT = CHECK_TEXT;

i18n.extend(REVIEW_RULE_TEXT);
