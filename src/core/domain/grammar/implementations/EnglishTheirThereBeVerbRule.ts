import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const THEIR_THERE_BE_REGEX = /\btheir\s+(is|are|was|were)$/i;

export class EnglishTheirThereBeVerbRule implements GrammarRule {
  readonly id = "englishTheirThereBeVerb" as const;
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

    const firstToken = phrase.split(/\s+/)[0];
    const verb = match[1];

    return {
      replacement: `${applyWordCase("there", detectWordCase(firstToken))} ${applyWordCase(verb, detectWordCase(verb))}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
    };
  }
}
