import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { matchTrailingEnglishPhrase } from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

export const YOUR_WELCOME_REGEX = /\byour\s+welcome$/i;

export class EnglishYourWelcomeCorrectionRule implements GrammarRule {
  readonly id = "englishYourWelcomeCorrection" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const matched = matchTrailingEnglishPhrase(context, YOUR_WELCOME_REGEX);
    if (!matched) {
      return null;
    }
    const { boundary: boundaryContext, match, phraseStart } = matched;
    const phrase = match[0];

    // "Your welcome email arrived" is possessive; only the sentence-final phrase
    // is unambiguously "you're welcome".
    if (!/^[.!?\n]/.test(boundaryContext.trailing)) {
      return null;
    }

    const [correctedFirst, correctedWelcome] = correctYourWelcome(phrase.split(/\s+/)[0]);

    return {
      replacement: `${correctedFirst} ${correctedWelcome}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
    };
  }
}

/** ["you're", "welcome"] in the case of the typed "your". */
export function correctYourWelcome(firstToken: string): [string, string] {
  const style = detectWordCase(firstToken);
  const correctedFirst = style === "upper" ? "YOU'RE" : style === "title" ? "You're" : "you're";
  return [correctedFirst, applyWordCase("welcome", style === "upper" ? "upper" : "lower")];
}
