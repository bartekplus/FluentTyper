import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  findTrailingLetterToken,
  isPartOfTechnicalToken,
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
    if (isPartOfTechnicalToken(tokenInfo.core, tokenInfo.tokenStart, tokenInfo.tokenEnd)) {
      return null;
    }

    const normalizedToken = normalizeContractionToken(
      tokenInfo.token,
      tokenInfo.core.slice(0, tokenInfo.tokenStart),
    );
    if (!normalizedToken) {
      return null;
    }

    return {
      replacement: `${normalizedToken}${tokenInfo.trailing}`,
      deleteBackwards: boundaryContext.input.length - tokenInfo.tokenStart,
      deleteForwards: 0,
    };
  }
}

/**
 * The apostrophe form of `token` ("dont" -> "don't", "Im" -> "I'm"), or null.
 * `beforeToken` is the text before it: a capitalized word after another
 * capitalized word on the same line is a name ("Jony Ive"), not a contraction.
 */
export function normalizeContractionToken(token: string, beforeToken: string): string | null {
  const normalizedInput = token.toLowerCase();
  const canonical = ENGLISH_CONTRACTION_MAP.get(normalizedInput);
  if (!canonical) {
    return null;
  }
  // "Jony Ive", "Ada Ill": a capitalized token following another capitalized
  // word is a name, not a contraction someone forgot an apostrophe in.
  if (/^[A-Z][a-z]/.test(token)) {
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
  if (FORCE_PRONOUN_I_PREFIX.has(normalizedInput) && token === token.toUpperCase()) {
    return null;
  }

  let normalizedToken = applyWordCase(canonical, detectWordCase(token));
  if (FORCE_PRONOUN_I_PREFIX.has(normalizedInput)) {
    normalizedToken = `I${normalizedToken.slice(1)}`;
  }
  return normalizedToken === token ? null : normalizedToken;
}
