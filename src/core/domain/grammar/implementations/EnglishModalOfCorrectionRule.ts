import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const MODAL_OF_REGEX = /\b(could|would|should|must)\s+of\s+([A-Za-z]+)$/i;
// "must of course", "would of necessity": prepositional "of" reads as a mistake
// until the following word arrives, so the correction waits for it.
const OF_IDIOMS = new Set([
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
    const boundaryContext = resolveEnglishBoundaryContext(context);
    if (!boundaryContext) {
      return null;
    }

    const match = boundaryContext.core.match(MODAL_OF_REGEX);
    if (!match) {
      return null;
    }

    const phrase = match[0];
    const modal = match[1];
    const following = match[2];
    if (OF_IDIOMS.has(following.toLowerCase())) {
      return null;
    }
    const phraseStart = boundaryContext.core.length - phrase.length;
    if (isLikelyCodeLikeContext(boundaryContext.core, phraseStart, boundaryContext.core.length)) {
      return null;
    }

    const style = detectWordCase(modal);
    const normalizedModal = applyWordCase(modal, style);
    const haveWord = style === "upper" ? "HAVE" : "have";

    return {
      replacement: `${normalizedModal} ${haveWord} ${following}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
    };
  }
}
