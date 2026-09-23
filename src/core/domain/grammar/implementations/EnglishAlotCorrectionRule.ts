import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { matchTrailingEnglishPhrase, resolveUserDictionarySet } from "./helpers/EnglishRuleShared";
import { detectWordCase, normalizeWordSet } from "./helpers/GenericRuleShared";

const ALOT_REGEX = /\balot$/i;

export class EnglishAlotCorrectionRule implements GrammarRule {
  readonly id = "englishAlotCorrection" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  private readonly fallbackUserDictionary: Set<string>;

  constructor(userDictionaryList: string[] = []) {
    this.fallbackUserDictionary = normalizeWordSet(userDictionaryList);
  }

  apply(context: GrammarContext): GrammarEdit | null {
    const matched = matchTrailingEnglishPhrase(context, ALOT_REGEX);
    if (!matched) {
      return null;
    }
    const { boundary: boundaryContext, match, phraseStart } = matched;
    const phrase = match[0];

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
    };
  }
}
