import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { matchTrailingEnglishPhrase, replaceFrom } from "./helpers/EnglishRuleShared";
import { detectWordCase, normalizeWordSet } from "./helpers/GenericRuleShared";

export const ALOT_REGEX = /\balot$/i;

export class EnglishAlotCorrectionRule implements GrammarRule {
  readonly id = "englishAlotCorrection" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const matched = matchTrailingEnglishPhrase(context, ALOT_REGEX);
    if (!matched) {
      return null;
    }
    const { boundary: boundaryContext, match, phraseStart } = matched;
    const phrase = match[0];

    const dictionarySet = normalizeWordSet(context.hints?.userDictionary ?? []);
    if (dictionarySet.has("alot")) {
      return null;
    }

    const replacementPhrase = correctAlot(phrase);

    return replaceFrom(boundaryContext, phraseStart, replacementPhrase);
  }
}

/** "a lot" in the case of the typed "alot". */
export function correctAlot(phrase: string): string {
  const style = detectWordCase(phrase);
  return style === "upper" ? "A LOT" : style === "title" ? "A lot" : "a lot";
}
