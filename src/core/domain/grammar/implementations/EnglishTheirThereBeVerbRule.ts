import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { matchTrailingEnglishPhrase } from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

export const THEIR_THERE_BE_REGEX = /\btheir\s+(is|are|was|were)$/i;

export class EnglishTheirThereBeVerbRule implements GrammarRule {
  readonly id = "englishTheirThereBeVerb" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const matched = matchTrailingEnglishPhrase(context, THEIR_THERE_BE_REGEX);
    if (!matched) {
      return null;
    }
    const { boundary: boundaryContext, match, phraseStart } = matched;
    const phrase = match[0];

    const firstToken = phrase.split(/\s+/)[0];
    const verb = match[1];

    const [there, normalizedVerb] = correctTheirBeVerb(firstToken, verb);
    return {
      replacement: `${there} ${normalizedVerb}${boundaryContext.trailing}`,
      deleteBackwards: boundaryContext.input.length - phraseStart,
      deleteForwards: 0,
    };
  }
}

/** ["there", verb], each in the case it was typed in. */
export function correctTheirBeVerb(their: string, verb: string): [string, string] {
  return [applyWordCase("there", detectWordCase(their)), applyWordCase(verb, detectWordCase(verb))];
}
