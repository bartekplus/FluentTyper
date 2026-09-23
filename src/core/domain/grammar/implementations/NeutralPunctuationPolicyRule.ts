import type { GrammarEdit, GrammarEventType, GrammarRule } from "../types";

export class NeutralPunctuationPolicyRule implements GrammarRule {
  readonly id = "neutralPunctuationPolicy" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(): GrammarEdit | null {
    // Explicitly no-op: for : ; ! ? we intentionally avoid auto spacing in v1
    // to keep cross-language behavior conservative. French spacing is the
    // opt-in frenchPunctuationSpacing rule.
    return null;
  }
}
