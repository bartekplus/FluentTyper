import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  type EnglishBoundaryContext,
  resolveEnglishBoundaryContext,
  findTrailingLetterToken,
  isPartOfTechnicalToken,
} from "./helpers/EnglishRuleShared";

const ENGLISH_APOSTROPHE_PRONOUN_REGEX = /(^|[^A-Za-z0-9_])(i)(['’](?:m|ve|ll|d))$/;
// A lone "i" before a space is the pronoun or a loop variable. The next word
// decides: the pronoun takes a verb, so "i is"/"i in"/"i of" is `i` the
// identifier ("for i in range", "if i is None"), never the English pronoun.
const DEFERRED_PRONOUN_I_REGEX = /(?:^|[^\p{L}\p{N}_'’])i([ \t]+)(\S+)$/u;
export const NON_PRONOUN_FOLLOWERS = new Set(["is", "in", "are", "of", "not"]);

export class EnglishPronounICapitalizationRule implements GrammarRule {
  readonly id = "englishPronounICapitalization" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const boundaryContext = resolveEnglishBoundaryContext(context, {
      ignoreDeleteInputAction: true,
    });
    if (!boundaryContext) {
      return null;
    }

    const apostropheCorrection = this.applyApostrophePronoun(boundaryContext);
    if (apostropheCorrection) {
      return apostropheCorrection;
    }

    const deferred = this.applyDeferredPronoun(boundaryContext);
    if (deferred) {
      return deferred;
    }

    const tokenInfo = findTrailingLetterToken(boundaryContext.input);
    if (!tokenInfo || tokenInfo.token !== "i") {
      return null;
    }
    // A bare "i." is the pronoun or the start of "i.e."; the next character
    // tells us which, and by then the token is no longer "i".
    if (tokenInfo.trailing === ".") {
      return null;
    }
    // Whitespace alone does not disambiguate; wait for the following word.
    if (/^[ \t]+$/.test(tokenInfo.trailing)) {
      return null;
    }
    if (isPartOfTechnicalToken(tokenInfo.core, tokenInfo.tokenStart, tokenInfo.tokenEnd)) {
      return null;
    }

    const replacement = `I${tokenInfo.trailing}`;
    return {
      replacement,
      deleteBackwards: boundaryContext.input.length - tokenInfo.tokenStart,
      deleteForwards: 0,
    };
  }

  /** Capitalizes a deferred "i" once the following word identifies it. */
  private applyDeferredPronoun(boundaryContext: EnglishBoundaryContext): GrammarEdit | null {
    const { core, trailing, input } = boundaryContext;
    const match = DEFERRED_PRONOUN_I_REGEX.exec(core);
    if (!match) {
      return null;
    }

    const [gap, following] = [match[1], match[2]];
    if (!/^\p{L}+$/u.test(following) || NON_PRONOUN_FOLLOWERS.has(following.toLowerCase())) {
      return null;
    }

    const pronounIndex = core.length - (1 + gap.length + following.length);
    if (core[pronounIndex] !== "i") {
      return null;
    }
    if (isPartOfTechnicalToken(core, pronounIndex, pronounIndex + 1)) {
      return null;
    }

    return {
      replacement: `I${gap}${following}${trailing}`,
      deleteBackwards: input.length - pronounIndex,
      deleteForwards: 0,
    };
  }

  private applyApostrophePronoun(boundaryContext: EnglishBoundaryContext): GrammarEdit | null {
    const { core, trailing, input } = boundaryContext;
    const match = core.match(ENGLISH_APOSTROPHE_PRONOUN_REGEX);
    if (!match) {
      return null;
    }

    const suffix = match[3];
    const replaceStart = core.length - (1 + suffix.length);
    if (replaceStart < 0 || core[replaceStart] !== "i") {
      return null;
    }
    if (isPartOfTechnicalToken(core, replaceStart, replaceStart + 1)) {
      return null;
    }

    const replacement = `I${core.slice(replaceStart + 1)}${trailing}`;
    return {
      replacement,
      deleteBackwards: input.length - replaceStart,
      deleteForwards: 0,
    };
  }
}
