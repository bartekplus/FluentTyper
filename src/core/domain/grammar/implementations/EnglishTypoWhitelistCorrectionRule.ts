import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  findTrailingLetterToken,
  isPartOfTechnicalToken,
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
    if (isPartOfTechnicalToken(tokenInfo.core, tokenInfo.tokenStart, tokenInfo.tokenEnd)) {
      return null;
    }

    const dictionarySet = resolveUserDictionarySet(context, this.fallbackUserDictionary);
    const replacementToken = correctWhitelistedTypo(tokenInfo.token, dictionarySet);
    if (!replacementToken) {
      return null;
    }

    return {
      replacement: `${replacementToken}${tokenInfo.trailing}`,
      deleteBackwards: boundaryContext.input.length - tokenInfo.tokenStart,
      deleteForwards: 0,
    };
  }
}

/** The whitelisted correction of `token` in its own case, or null (also for dictionary words). */
export function correctWhitelistedTypo(
  token: string,
  dictionary: ReadonlySet<string>,
): string | null {
  const normalizedToken = token.toLowerCase();
  const correction = TYPO_WHITELIST.get(normalizedToken);
  if (!correction || dictionary.has(normalizedToken)) {
    return null;
  }
  const replacementToken = applyWordCase(correction, detectWordCase(token));
  return replacementToken === token ? null : replacementToken;
}
