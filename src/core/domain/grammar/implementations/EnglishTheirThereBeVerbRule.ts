import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const THEIR_THERE_BE_REGEX = /\btheir\s+(is|are|was|were)$/i;

export class EnglishTheirThereBeVerbRule implements GrammarRule {
  readonly id = "englishTheirThereBeVerb" as const;
  readonly name = "English Their There Be Verb";
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const boundaryContext = resolveEnglishBoundaryContext(context);
    if (!boundaryContext) {
      return null;
    }

    const match = boundaryContext.core.match(THEIR_THERE_BE_REGEX);
    if (!match) {
      return null;
    }

    const phrase = match[0];
    const phraseStart = boundaryContext.core.length - phrase.length;
    if (isLikelyCodeLikeContext(boundaryContext.core, phraseStart, boundaryContext.core.length)) {
      return null;
    }

    const firstToken = phrase.split(/\s+/)[0] || "their";
    const verb = match[1] || "is";
    const style = detectWordCase(firstToken);

    return {
      replacement: `${applyWordCase("there", style)} ${applyWordCase(verb.toLowerCase(), detectWordCase(verb))}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
      confidence: "high",
      safetyTier: "safe",
      description: "Corrected their/there phrase",
    };
  }
}
