import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  findTrailingLetterToken,
  hasTrailingTokenBoundary,
  isEnglishLanguageContext,
  isLikelyCodeLikeContext,
  splitTrailingDelimiters,
} from "./helpers/EnglishRuleShared";

const ENGLISH_APOSTROPHE_PRONOUN_REGEX = /(^|[^A-Za-z0-9_])(i)(['’](?:m|ve|ll|d|re|s))$/;

export class EnglishPronounICapitalizationRule implements GrammarRule {
  readonly id = "englishPronounICapitalization" as const;
  readonly name = "English Pronoun I Capitalization";
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (!isEnglishLanguageContext(context)) {
      return null;
    }
    const inputStr = context.beforeCursor;
    if (inputStr.length === 0) {
      return null;
    }
    if (!hasTrailingTokenBoundary(inputStr)) {
      return null;
    }

    const apostropheCorrection = this.applyApostrophePronoun(inputStr);
    if (apostropheCorrection) {
      return apostropheCorrection;
    }

    const tokenInfo = findTrailingLetterToken(inputStr);
    if (!tokenInfo || tokenInfo.token !== "i") {
      return null;
    }
    if (isLikelyCodeLikeContext(tokenInfo.core, tokenInfo.tokenStart, tokenInfo.tokenEnd)) {
      return null;
    }

    const replacement = `I${tokenInfo.trailing}`;
    return {
      replacement,
      deleteBackwards: inputStr.length - tokenInfo.tokenStart,
      deleteForwards: 0,
      confidence: "high",
      description: "Capitalized English pronoun I",
    };
  }

  private applyApostrophePronoun(inputStr: string): GrammarEdit | null {
    const { core, trailing } = splitTrailingDelimiters(inputStr);
    if (core.length === 0 || trailing.length === 0) {
      return null;
    }
    const match = core.match(ENGLISH_APOSTROPHE_PRONOUN_REGEX);
    if (!match) {
      return null;
    }

    const suffix = match[3];
    const replaceStart = core.length - (1 + suffix.length);
    if (replaceStart < 0 || core[replaceStart] !== "i") {
      return null;
    }
    if (isLikelyCodeLikeContext(core, replaceStart, replaceStart + 1)) {
      return null;
    }

    const replacement = `I${core.slice(replaceStart + 1)}${trailing}`;
    return {
      replacement,
      deleteBackwards: inputStr.length - replaceStart,
      deleteForwards: 0,
      confidence: "high",
      description: "Capitalized English pronoun in contraction",
    };
  }
}
