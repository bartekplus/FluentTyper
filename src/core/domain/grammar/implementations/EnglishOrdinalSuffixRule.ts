import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  isLikelyCodeLikeContext,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { isInsideProtectedSpan } from "./helpers/ProtectedSpanShared";

// Only a whole token of digits plus a lowercase "nd" or "th" is a candidate. It
// must start after a space, an opening bracket or the text start, so "v1th",
// "1.1th", "x=2th" and a token wrapped in quotes are never touched.
//
// Other suffixes are preserved on purpose, because they have other meanings:
// "st" is also stone ("He is 11st", "11st 4lb"), "rd" is also rod ("a 16rd
// chain"), and uppercase or mixed case is also an abbreviation ("42RD" for
// road). None of them can be told apart from a typo by the text alone.
const ORDINAL_REGEX = /(?<=^|[\s([])(\d+)(nd|th)$/;

export function ordinalSuffix(digits: string): string {
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
    if (suffix === expected) {
      return null;
    }
    const tokenStart = match.index;
    const beforeToken = core.slice(0, tokenStart);
    // Quoted text is often a deliberate example ("never write "3th""). Unquoted
    // examples are still corrected once the user opts in to this rule.
    if (
      isInsideProtectedSpan(beforeToken, { quotations: true }) ||
      isLikelyCodeLikeContext(core, tokenStart, core.length)
    ) {
      return null;
    }

    return {
      replacement: `${digits}${expected}${boundaryContext.trailing}`,
      deleteBackwards: token.length + boundaryContext.trailing.length,
      deleteForwards: 0,
    };
  }
}
