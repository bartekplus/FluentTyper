import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  hasTrailingTokenBoundary,
  isEnglishLanguageContext,
  isLikelyCodeLikeContext,
  resolveInputAction,
  splitTrailingDelimiters,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const YOUR_WELCOME_REGEX = /\byour\s+welcome$/i;

export class EnglishYourWelcomeCorrectionRule implements GrammarRule {
  readonly id = "englishYourWelcomeCorrection" as const;
  readonly name = "English Your Welcome Correction";
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

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
    const match = core.match(YOUR_WELCOME_REGEX);
    if (!match) {
      return null;
    }

    const phrase = match[0];
    const phraseStart = core.length - phrase.length;
    if (isLikelyCodeLikeContext(core, phraseStart, core.length)) {
      return null;
    }

    const firstToken = phrase.split(/\s+/)[0] || "your";
    const style = detectWordCase(firstToken);
    const correctedFirst = style === "upper" ? "YOU'RE" : style === "title" ? "You're" : "you're";

    return {
      replacement: `${correctedFirst} ${applyWordCase("welcome", style === "upper" ? "upper" : "lower")}${trailing}`,
      deleteBackwards: input.length - phraseStart,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected your welcome phrase",
    };
  }
}
