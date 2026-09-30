import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { matchTrailingEnglishPhrase } from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

export const MODAL_OF_REGEX =
  /\b((?:could|would|should|must|might)(?:n['’]t)?)\s+of\s+([A-Za-z]+)$/i;
// "the might of Rome", "with all our might of": the noun, not the modal.
const NOUN_MIGHT_BEFORE = /\b(?:the|its|his|her|their|our|your|my|all|full|with|by|of)\s+$/i;

/** True when "might" before "of" is the noun ("the might of"), judged by the text before it. */
export function isNounMight(modal: string, before: string): boolean {
  return modal.toLowerCase() === "might" && NOUN_MIGHT_BEFORE.test(before.slice(-24));
}
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
    if (
      OF_IDIOMS.has(following.toLowerCase()) ||
      isNounMight(modal, boundaryContext.core.slice(0, phraseStart))
    ) {
      return null;
    }

    const style = detectWordCase(modal);
    const normalizedModal = applyWordCase(modal, style);
    const haveWord = modalHaveWord(modal, match[0].slice(modal.length).trimStart().slice(0, 2));

    return {
      replacement: `${normalizedModal} ${haveWord} ${following}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
    };
  }
}

/** "have" in the case of the "of" it replaces: "COULD OF" -> "HAVE", "Could Of" -> "Have". */
export function modalHaveWord(modal: string, of: string): string {
  if (detectWordCase(modal) === "upper") return "HAVE";
  return of === "Of" ? "Have" : "have";
}
