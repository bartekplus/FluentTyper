import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  findTrailingLetterToken,
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const ENGLISH_CONTRACTION_MAP = new Map(
  Object.entries({
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
  }),
);
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

    const normalizedInput = tokenInfo.token.toLowerCase();
    const canonical = ENGLISH_CONTRACTION_MAP.get(normalizedInput);
    if (!canonical) {
      return null;
    }
    // "Jony Ive", "Ada Ill": a capitalized token following another capitalized
    // word is a name, not a contraction someone forgot an apostrophe in.
    if (/^[A-Z][a-z]/.test(tokenInfo.token)) {
      const beforeToken = tokenInfo.core.slice(0, tokenInfo.tokenStart);
      const lineStart = Math.max(beforeToken.lastIndexOf("\n"), beforeToken.lastIndexOf("\r")) + 1;
      // Only a capitalized word on the same line suggests a name; one that
      // merely ends the previous line says nothing about this token.
      const before = beforeToken.slice(lineStart).trimEnd();
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
    if (FORCE_PRONOUN_I_PREFIX.has(normalizedInput)) {
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
