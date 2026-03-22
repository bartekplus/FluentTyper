import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  normalizeWordSet,
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
  resolveUserDictionarySet,
} from "./helpers/EnglishRuleShared";
import { detectWordCase } from "./helpers/GenericRuleShared";

const ALOT_REGEX = /\balot$/i;

export class EnglishAlotCorrectionRule implements GrammarRule {
  readonly id = "englishAlotCorrection" as const;
  readonly name = "English Alot Correction";
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  private readonly fallbackUserDictionary: Set<string>;

  constructor(userDictionaryList: string[] = []) {
    this.fallbackUserDictionary = normalizeWordSet(userDictionaryList);
  }

  apply(context: GrammarContext): GrammarEdit | null {
    const boundaryContext = resolveEnglishBoundaryContext(context);
    if (!boundaryContext) {
      return null;
    }

    const match = boundaryContext.core.match(ALOT_REGEX);
    if (!match) {
      return null;
    }

    const phrase = match[0];
    const phraseStart = boundaryContext.core.length - phrase.length;
    if (isLikelyCodeLikeContext(boundaryContext.core, phraseStart, boundaryContext.core.length)) {
      return null;
    }

    const dictionarySet = resolveUserDictionarySet(context, this.fallbackUserDictionary);
    if (dictionarySet.has("alot")) {
      return null;
    }

    const style = detectWordCase(phrase);
    const replacementPhrase = style === "upper" ? "A LOT" : style === "title" ? "A lot" : "a lot";

    return {
      replacement: `${replacementPhrase}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected alot typo",
    };
  }
}
