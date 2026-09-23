import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { isInsideProtectedSpan } from "./helpers/ProtectedSpanShared";

// A whole token of digits plus a lowercase or uppercase suffix. It must start
// after a space, an opening quote or bracket, or the text start, so "v1th",
// "1.1th" and "x=2st" are never touched.
const ORDINAL_REGEX = /(?<=^|[\s(["'“‘])(\d+)(st|nd|rd|th|ST|ND|RD|TH)$/;
// "11st" is also 11 stone, the British body-weight unit.
// ponytail: only the preceding verb is checked, so "He is 11st" still becomes
// "11th"; look at the next token too if that shows up in practice.
const WEIGHT_WORD_REGEX =
  /(?:^|\s)(?:weighs?|weighed|weighing|lost|lose|loses|losing|gained|gains?|gaining)\s+$/i;

function ordinalSuffix(digits: string): string {
  const lastTwo = Number(digits.slice(-2));
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  return ["th", "st", "nd", "rd"][lastTwo % 10] ?? "th";
}

export class EnglishOrdinalSuffixRule implements GrammarRule {
  readonly id = "englishOrdinalSuffix" as const;
  readonly triggers: GrammarEventType[] = ["wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (context.hints?.measurementContext === "protected") {
      return null;
    }
    const boundaryContext = resolveEnglishBoundaryContext(context);
    if (!boundaryContext) {
      return null;
    }

    const { core } = boundaryContext;
    const match = core.match(ORDINAL_REGEX);
    if (!match || match.index === undefined) {
      return null;
    }

    const [token, digits, suffix] = match;
    const expected = ordinalSuffix(digits);
    if (suffix.toLowerCase() === expected) {
      return null;
    }
    const tokenStart = match.index;
    const beforeToken = core.slice(0, tokenStart);
    if (
      (suffix.toLowerCase() === "st" && WEIGHT_WORD_REGEX.test(beforeToken)) ||
      isInsideProtectedSpan(beforeToken) ||
      isLikelyCodeLikeContext(core, tokenStart, core.length)
    ) {
      return null;
    }

    const fixed = suffix === suffix.toUpperCase() ? expected.toUpperCase() : expected;
    return {
      replacement: `${digits}${fixed}${boundaryContext.trailing}`,
      deleteBackwards: token.length + boundaryContext.trailing.length,
      deleteForwards: 0,
    };
  }
}
