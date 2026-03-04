import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";

export class NeutralPunctuationPolicyRule implements GrammarRule {
  readonly id = "neutralPunctuationPolicy" as const;
  readonly name = "Neutral Punctuation Policy";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    void context;
    // Explicitly no-op: for : ; ! ? we intentionally avoid auto spacing in v1
    // to keep cross-language behavior conservative.
    return null;
  }
}
