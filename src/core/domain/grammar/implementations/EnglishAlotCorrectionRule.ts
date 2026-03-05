import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  hasTrailingTokenBoundary,
  isEnglishLanguageContext,
  isLikelyCodeLikeContext,
  resolveInputAction,
  resolveUserDictionarySet,
  splitTrailingDelimiters,
} from "./helpers/EnglishRuleShared";
import { detectWordCase } from "./helpers/GenericRuleShared";

const ALOT_REGEX = /\balot$/i;

export class EnglishAlotCorrectionRule implements GrammarRule {
  readonly id = "englishAlotCorrection" as const;
  readonly name = "English Alot Correction";
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  private readonly fallbackUserDictionary: Set<string>;

  constructor(userDictionaryList: string[] = []) {
    this.fallbackUserDictionary = new Set(
      userDictionaryList.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
    );
  }

  apply(context: GrammarContext): GrammarEdit | null {
    if (!isEnglishLanguageContext(context)) {
      return null;
    }
    if (resolveInputAction(context) === "delete") {
      return null;
    }
    if (!hasTrailingTokenBoundary(context.beforeCursor)) {
      return null;
    }

    const input = context.beforeCursor;
    const { core, trailing } = splitTrailingDelimiters(input);
    const match = core.match(ALOT_REGEX);
    if (!match) {
      return null;
    }

    const phrase = match[0];
    const phraseStart = core.length - phrase.length;
    if (isLikelyCodeLikeContext(core, phraseStart, core.length)) {
      return null;
    }

    const dictionarySet = resolveUserDictionarySet(context, this.fallbackUserDictionary);
    if (dictionarySet.has("alot")) {
      return null;
    }

    const style = detectWordCase(phrase);
    const replacementPhrase = style === "upper" ? "A LOT" : style === "title" ? "A lot" : "a lot";

    return {
      replacement: `${replacementPhrase}${trailing}`,
      deleteBackwards: input.length - phraseStart,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected alot typo",
    };
  }
}
