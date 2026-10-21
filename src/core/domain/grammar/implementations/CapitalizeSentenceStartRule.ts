// Facade: the rule's code is in grammar/rules/common.yaml (capitalizeSentenceStart.live).
import { liveRule } from "../engine/liveRules";
import type { GrammarContext, GrammarEdit, GrammarRule } from "../types";

export {
  CLOSING_CHARS,
  CLOSING_PADDING_CHARS,
  closesAbbreviation,
  keepsOwnCasing,
  periodEndsSentence,
  SENTENCE_CLOSERS,
  SENTENCE_OPENERS,
  SENTENCE_OPENING_MARKS,
  startsSentence,
  TRAILING_PUNCTUATION_REGEX,
} from "../library/typing/sentences";
export type { AbbreviationOptions } from "../library/typing/sentences";

export class CapitalizeSentenceStartRule implements GrammarRule {
  readonly id = "capitalizeSentenceStart" as const;
  private readonly rule = liveRule(this.id);
  readonly triggers = this.rule.triggers;

  apply(context: GrammarContext): GrammarEdit | null {
    return this.rule.apply(context);
  }
}
