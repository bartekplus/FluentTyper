import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { NBSP, NNBSP, usesFrenchPunctuationSpacing } from "../typographyProfiles";
import {
  isDeleteInputAction,
  shouldSkipGenericReplacement,
  splitTrailingSpaces,
} from "./helpers/GenericRuleShared";
import { isInsideProtectedSpan } from "./helpers/ProtectedSpanShared";

// Only after a word, number or closing mark, so "?!" stays together and ":)" is left alone.
const SPACED_AFTER_REGEX = /[\p{L}\p{N}»)\]’”]$/u;
// "https:" is a URL still being typed, also as "(https:" or "[ici](https:".
// ponytail: fixed scheme list; "localhost:3000" in prose still gets a space.
const URL_SCHEME_REGEX = /(?:^|[^\p{L}\p{N}])(?:https?|ftps?|mailto|file|tel|data)$/iu;
// "&nbsp;", "&#160;", "&#xA0;": the semicolon ends an HTML character reference.
const CHARACTER_REFERENCE_REGEX = /&(?:[a-z][a-z\d]*|#\d+|#x[\da-f]+)$/i;

/**
 * France-style spacing: a no-break space before ":" and a narrow no-break space
 * before ";", "!" and "?". A plain space the writer typed there is replaced.
 */
export class FrenchPunctuationSpacingRule implements GrammarRule {
  readonly id = "frenchPunctuationSpacing" as const;
  readonly triggers: GrammarEventType[] = ["insertChar"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (
      !usesFrenchPunctuationSpacing(context.hints?.lang) ||
      isDeleteInputAction(context) ||
      context.hints?.measurementContext === "protected"
    ) {
      return null;
    }

    const input = context.beforeCursor;
    const typed = input.charAt(input.length - 1);
    if (typed !== ":" && typed !== ";" && typed !== "!" && typed !== "?") {
      return null;
    }

    const { core, trailingSpaces } = splitTrailingSpaces(input.slice(0, -1), [" ", NBSP, NNBSP]);
    const space = typed === ":" ? NBSP : NNBSP;
    if (trailingSpaces === space || !SPACED_AFTER_REGEX.test(core)) {
      return null;
    }
    // "12:30" is a time; "Chapitre 2 :" with a typed space still gets fixed.
    if (typed === ":" && !trailingSpaces && /\p{N}$/u.test(core)) {
      return null;
    }
    if (
      (typed === ":" && URL_SCHEME_REGEX.test(core)) ||
      (typed === ";" && CHARACTER_REFERENCE_REGEX.test(core)) ||
      shouldSkipGenericReplacement(core) ||
      isInsideProtectedSpan(core)
    ) {
      return null;
    }

    return {
      replacement: `${space}${typed}`,
      deleteBackwards: 1 + trailingSpaces.length,
      deleteForwards: 0,
    };
  }
}
