import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { matchTrailingEnglishPhrase } from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

export const MODAL_OF_REGEX = /\b(could|would|should|must)\s+of\s+([A-Za-z]+)$/i;
// "must of course", "would of necessity": prepositional "of" reads as a mistake
// until the following word arrives, so the correction waits for it.
export const OF_IDIOMS = new Set([
  "course",
  "necessity",
  "itself",
  "himself",
  "herself",
  "themselves",
  "late",
  "old",
  "sorts",
  "note",
  "interest",
  "value",
  "which",
  "whom",
  "them",
  "us",
  "these",
  "those",
  "the",
  "a",
  "an",
  "his",
  "her",
  "their",
  "its",
  "our",
  "my",
  "your",
]);

export class EnglishModalOfCorrectionRule implements GrammarRule {
  readonly id = "englishModalOfCorrection" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const matched = matchTrailingEnglishPhrase(context, MODAL_OF_REGEX);
    if (!matched) {
      return null;
    }
    const { boundary: boundaryContext, match, phraseStart } = matched;
    const modal = match[1];
    const following = match[2];
    if (OF_IDIOMS.has(following.toLowerCase())) {
      return null;
    }

    const style = detectWordCase(modal);
    const normalizedModal = applyWordCase(modal, style);
    const haveWord = modalHaveWord(modal);

    return {
      replacement: `${normalizedModal} ${haveWord} ${following}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
    };
  }
}

/** "have" in the case of the modal it follows: "COULD OF" -> "HAVE". */
export function modalHaveWord(modal: string): string {
  return detectWordCase(modal) === "upper" ? "HAVE" : "have";
}
