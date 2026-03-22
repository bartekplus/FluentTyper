import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const MODAL_OF_REGEX = /\b(could|would|should|must)\s+of$/i;

export class EnglishModalOfCorrectionRule implements GrammarRule {
  readonly id = "englishModalOfCorrection" as const;
  readonly name = "English Modal Of Correction";
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
    const phraseStart = boundaryContext.core.length - phrase.length;
    if (isLikelyCodeLikeContext(boundaryContext.core, phraseStart, boundaryContext.core.length)) {
      return null;
    }

    const style = detectWordCase(modal);
    const normalizedModal = applyWordCase(modal.toLowerCase(), style);
    const haveWord = style === "upper" ? "HAVE" : "have";

    return {
      replacement: `${normalizedModal} ${haveWord}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected modal phrase typo",
    };
  }
}
