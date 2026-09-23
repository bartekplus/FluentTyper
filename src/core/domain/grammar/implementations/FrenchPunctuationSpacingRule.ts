import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import { NBSP, NNBSP, usesFrenchPunctuationSpacing } from "../typographyProfiles";
import {
  getLastToken,
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

const WORD_CHAR_REGEX = /[\p{L}\p{N}]/u;

/**
 * France-style spacing: a no-break space before ":" and a narrow no-break space
 * before ";", "!" and "?". A plain space the writer typed there is replaced.
 */
export class FrenchPunctuationSpacingRule implements GrammarRule {
  readonly id = "frenchPunctuationSpacing" as const;
  // ":" and ";" don't end a word on their own (see below); "!" and "?" do, but
  // may still need undoing once more of the same word turns up (see retraction).
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    if (
      !usesFrenchPunctuationSpacing(context.hints?.lang) ||
      isDeleteInputAction(context) ||
      context.hints?.measurementContext === "protected"
    ) {
      return null;
    }

    const input = context.beforeCursor;

    const retraction = retractMidWordMark(input);
    if (retraction) {
      return retraction;
    }

    const last = input.charAt(input.length - 1);
    let typed: string;
    let beforeMark: string;

    if (last === "!" || last === "?") {
      // "!" and "?" end a word themselves, so act as soon as they're typed.
      typed = last;
      beforeMark = input.slice(0, -1);
    } else if (last === " ") {
      const prev = input.charAt(input.length - 2);
      if (prev !== ":" && prev !== ";" && prev !== "!" && prev !== "?") {
        return null;
      }
      // ":" and ";" don't end a word on their own; wait for the space that
      // confirms one, so "C:\Users" or "localhost:3000" are left alone.
      typed = prev;
      beforeMark = input.slice(0, -2);
    } else {
      return null;
    }

    const { core, trailingSpaces } = splitTrailingSpaces(beforeMark, [" ", NBSP, NNBSP]);
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
      isInsideProtectedSpan(core) ||
      // ":smile:" and similar: the word right before already carries an
      // unspaced mark, so this is one token, not a sentence boundary.
      /[:;!?]/.test(getLastToken(core))
    ) {
      return null;
    }

    return {
      replacement: last === " " ? `${space}${typed} ` : `${space}${typed}`,
      deleteBackwards: trailingSpaces.length + (last === " " ? 2 : 1),
      deleteForwards: 0,
    };
  }
}

/**
 * Undoes an eager "!"/"?" space once the next character shows the mark was
 * mid-word, not word-final: "x?y" must stay "x?y", not "x ?y".
 */
function retractMidWordMark(input: string): GrammarEdit | null {
  if (input.length < 3) {
    return null;
  }
  const space = input.charAt(input.length - 3);
  const mark = input.charAt(input.length - 2);
  const justTyped = input.charAt(input.length - 1);
  if (
    (space === NBSP || space === NNBSP) &&
    (mark === "!" || mark === "?") &&
    WORD_CHAR_REGEX.test(justTyped)
  ) {
    return { replacement: `${mark}${justTyped}`, deleteBackwards: 3, deleteForwards: 0 };
  }
  return null;
}
