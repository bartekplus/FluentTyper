import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const YOUR_WELCOME_REGEX = /\byour\s+welcome$/i;

export class EnglishYourWelcomeCorrectionRule implements GrammarRule {
  readonly id = "englishYourWelcomeCorrection" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const boundaryContext = resolveEnglishBoundaryContext(context);
    if (!boundaryContext) {
      return null;
    }

    const match = boundaryContext.core.match(YOUR_WELCOME_REGEX);
    if (!match) {
      return null;
    }

    const phrase = match[0];
    const phraseStart = boundaryContext.core.length - phrase.length;
    if (isLikelyCodeLikeContext(boundaryContext.core, phraseStart, boundaryContext.core.length)) {
      return null;
    }

    // "Your welcome email arrived" is possessive; only the sentence-final phrase
    // is unambiguously "you're welcome".
    if (!/^[.!?\n]/.test(boundaryContext.trailing)) {
      return null;
    }

    const firstToken = phrase.split(/\s+/)[0];
    const style = detectWordCase(firstToken);
    const correctedFirst = style === "upper" ? "YOU'RE" : style === "title" ? "You're" : "you're";

    return {
      replacement: `${correctedFirst} ${applyWordCase("welcome", style === "upper" ? "upper" : "lower")}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
    };
  }
}
