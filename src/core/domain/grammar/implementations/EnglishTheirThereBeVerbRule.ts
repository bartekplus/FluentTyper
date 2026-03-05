import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  hasTrailingTokenBoundary,
  isEnglishLanguageContext,
  isLikelyCodeLikeContext,
  resolveInputAction,
  splitTrailingDelimiters,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const THEIR_THERE_BE_REGEX = /\btheir\s+(is|are|was|were)$/i;

export class EnglishTheirThereBeVerbRule implements GrammarRule {
  readonly id = "englishTheirThereBeVerb" as const;
  readonly name = "English Their There Be Verb";
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
    const match = core.match(THEIR_THERE_BE_REGEX);
    if (!match) {
      return null;
    }

    const phrase = match[0];
    const phraseStart = core.length - phrase.length;
    if (isLikelyCodeLikeContext(core, phraseStart, core.length)) {
      return null;
    }

    const firstToken = phrase.split(/\s+/)[0] || "their";
    const verb = match[1] || "is";
    const style = detectWordCase(firstToken);

    return {
      replacement: `${applyWordCase("there", style)} ${applyWordCase(verb.toLowerCase(), detectWordCase(verb))}${trailing}`,
      deleteBackwards: input.length - phraseStart,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected their/there phrase",
    };
  }
}
