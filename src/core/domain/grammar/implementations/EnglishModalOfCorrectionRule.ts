import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  hasTrailingTokenBoundary,
  isEnglishLanguageContext,
  isLikelyCodeLikeContext,
  resolveInputAction,
  splitTrailingDelimiters,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const MODAL_OF_REGEX = /\b(could|would|should|must)\s+of$/i;

export class EnglishModalOfCorrectionRule implements GrammarRule {
  readonly id = "englishModalOfCorrection" as const;
  readonly name = "English Modal Of Correction";
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (!isEnglishLanguageContext(context)) {
      return null;
    }
    if (resolveInputAction(context) === "delete") {
      return null;
    }
    if (!hasTrailingTokenBoundary(context.beforeCursor)) {
      return null;
    }

    const input = context.beforeCursor;
    const { core, trailing } = splitTrailingDelimiters(input);
    const match = core.match(MODAL_OF_REGEX);
    if (!match) {
      return null;
    }

    const phrase = match[0];
    const modal = match[1];
    const phraseStart = core.length - phrase.length;
    if (isLikelyCodeLikeContext(core, phraseStart, core.length)) {
      return null;
    }

    const style = detectWordCase(modal);
    const normalizedModal = applyWordCase(modal.toLowerCase(), style);
    const haveWord = style === "upper" ? "HAVE" : "have";

    return {
      replacement: `${normalizedModal} ${haveWord}${trailing}`,
      deleteBackwards: input.length - phraseStart,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected modal phrase typo",
    };
  }
}
