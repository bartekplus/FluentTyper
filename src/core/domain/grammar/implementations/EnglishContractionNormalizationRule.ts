import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  findTrailingLetterToken,
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const ENGLISH_CONTRACTION_MAP: Record<string, string> = {
  im: "i'm",
  ive: "i've",
  dont: "don't",
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
// "ill", "cant" and "wont" are ordinary English words; expanding them corrupts
// valid input, and no context available here disambiguates them.
const FORCE_PRONOUN_I_PREFIX = new Set(["im", "ive"]);

export class EnglishContractionNormalizationRule implements GrammarRule {
  readonly id = "englishContractionNormalization" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

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

    const canonical = ENGLISH_CONTRACTION_MAP[tokenInfo.token.toLowerCase()];
    if (!canonical) {
      return null;
    }
    const normalizedInput = tokenInfo.token.toLowerCase();
    // "Jony Ive", "Ada Ill": a capitalized token following another capitalized
    // word is a name, not a contraction someone forgot an apostrophe in.
    if (/^[A-Z][a-z]/.test(tokenInfo.token)) {
      const before = tokenInfo.core.slice(0, tokenInfo.tokenStart).trimEnd();
      if (/[A-Z][a-z]*$/.test(before)) {
        return null;
      }
    }

    // "IM" is an acronym, not a missing apostrophe. Unambiguous forms such as
    // "DONT" stay corrected.
    if (
      FORCE_PRONOUN_I_PREFIX.has(normalizedInput) &&
      tokenInfo.token === tokenInfo.token.toUpperCase()
    ) {
      return null;
    }

    let normalizedToken = applyWordCase(canonical, detectWordCase(tokenInfo.token));
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
      deleteBackwards: boundaryContext.input.length - tokenInfo.tokenStart,
      deleteForwards: 0,
    };
  }
}
