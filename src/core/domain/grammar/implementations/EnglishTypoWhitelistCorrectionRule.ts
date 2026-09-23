import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  findTrailingLetterToken,
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
  resolveUserDictionarySet,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase, normalizeWordSet } from "./helpers/GenericRuleShared";

const TYPO_WHITELIST = new Map(
  Object.entries({
    teh: "the",
    adn: "and",
    recieve: "receive",
    seperate: "separate",
    occured: "occurred",
    untill: "until",
    wich: "which",
    thier: "their",
    becuase: "because",
    definately: "definitely",
  }),
);

export class EnglishTypoWhitelistCorrectionRule implements GrammarRule {
  readonly id = "englishTypoWhitelistCorrection" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  private readonly fallbackUserDictionary: Set<string>;

  constructor(userDictionaryList: string[] = []) {
    this.fallbackUserDictionary = normalizeWordSet(userDictionaryList);
  }

  apply(context: GrammarContext): GrammarEdit | null {
    const boundaryContext = resolveEnglishBoundaryContext(context);
    if (!boundaryContext) {
      return null;
    }

    const tokenInfo = findTrailingLetterToken(boundaryContext.input);
    if (!tokenInfo) {
      return null;
    }
    if (isLikelyCodeLikeContext(tokenInfo.core, tokenInfo.tokenStart, tokenInfo.tokenEnd)) {
      return null;
    }

    const normalizedToken = tokenInfo.token.toLowerCase();
    const correction = TYPO_WHITELIST.get(normalizedToken);
    if (!correction) {
      return null;
    }

    const dictionarySet = resolveUserDictionarySet(context, this.fallbackUserDictionary);
    if (dictionarySet.has(normalizedToken)) {
      return null;
    }

    const replacementToken = applyWordCase(correction, detectWordCase(tokenInfo.token));
    if (replacementToken === tokenInfo.token) {
      return null;
    }

    return {
      replacement: `${replacementToken}${tokenInfo.trailing}`,
      deleteBackwards: boundaryContext.input.length - tokenInfo.tokenStart,
      deleteForwards: 0,
    };
  }
}
