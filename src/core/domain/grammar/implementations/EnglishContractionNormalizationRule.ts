import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  applyCasePattern,
  findTrailingLetterToken,
  isEnglishLanguageContext,
  isLikelyCodeLikeContext,
  resolveInputAction,
} from "./helpers/EnglishRuleShared";

const ENGLISH_CONTRACTION_MAP: Record<string, string> = {
  im: "i'm",
  ive: "i've",
  ill: "i'll",
  id: "i'd",
  dont: "don't",
  cant: "can't",
  wont: "won't",
  isnt: "isn't",
  arent: "aren't",
  wasnt: "wasn't",
  werent: "weren't",
  didnt: "didn't",
  doesnt: "doesn't",
  havent: "haven't",
  hasnt: "hasn't",
  hadnt: "hadn't",
  shouldnt: "shouldn't",
  couldnt: "couldn't",
  wouldnt: "wouldn't",
  mustnt: "mustn't",
};
const FORCE_PRONOUN_I_PREFIX = new Set(["im", "ive", "ill", "id"]);

export class EnglishContractionNormalizationRule implements GrammarRule {
  readonly id = "englishContractionNormalization" as const;
  readonly name = "English Contraction Normalization";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (!isEnglishLanguageContext(context)) {
      return null;
    }
    if (resolveInputAction(context) === "delete") {
      return null;
    }

    const tokenInfo = findTrailingLetterToken(context.beforeCursor);
    if (!tokenInfo) {
      return null;
    }
    if (isLikelyCodeLikeContext(tokenInfo.core, tokenInfo.tokenStart, tokenInfo.tokenEnd)) {
      return null;
    }

    const canonical = ENGLISH_CONTRACTION_MAP[tokenInfo.token.toLowerCase()];
    if (!canonical) {
      return null;
    }

    const normalizedInput = tokenInfo.token.toLowerCase();
    let normalizedToken = applyCasePattern(tokenInfo.token, canonical);
    if (
      FORCE_PRONOUN_I_PREFIX.has(normalizedInput) &&
      tokenInfo.token !== tokenInfo.token.toUpperCase()
    ) {
      normalizedToken = `I${normalizedToken.slice(1)}`;
    }
    if (normalizedToken === tokenInfo.token) {
      return null;
    }

    return {
      replacement: `${normalizedToken}${tokenInfo.trailing}`,
      deleteBackwards: context.beforeCursor.length - tokenInfo.tokenStart,
      deleteForwards: 0,
      confidence: "high",
      description: "Normalized English contraction",
    };
  }
}
