import type { GrammarContext, GrammarEdit, GrammarEventType, GrammarRule } from "../types";
import {
  findTrailingLetterToken,
  isPartOfTechnicalToken,
  resolveEnglishBoundaryContext,
} from "./helpers/EnglishRuleShared";
import { applyWordCase, detectWordCase } from "./helpers/GenericRuleShared";

const ENGLISH_CONTRACTION_MAP = new Map(
  Object.entries({
    im: "i'm",
    ive: "i've",
    dont: "don't",
    isnt: "isn't",
    arent: "aren't",
    wasnt: "wasn't",
    werent: "weren't",
    didnt: "didn't",
    doesnt: "doesn't",
    havent: "haven't",
    hasnt: "hasn't",
    hadnt: "hadn't",
    shouldnt: "shouldn't",
    couldnt: "couldn't",
    wouldnt: "wouldn't",
    mustnt: "mustn't",
  }),
);
// "ill", "cant" and "wont" are ordinary English words; expanding them corrupts
// valid input, and no context available here disambiguates them. Finished text
// has the word after them: see normalizeContractionInContext.
const FORCE_PRONOUN_I_PREFIX = new Set(["im", "ive"]);

export class EnglishContractionNormalizationRule implements GrammarRule {
  readonly id = "englishContractionNormalization" as const;
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  apply(context: GrammarContext): GrammarEdit | null {
    const boundaryContext = resolveEnglishBoundaryContext(context);
    if (!boundaryContext) {
      return null;
    }

    const tokenInfo = findTrailingLetterToken(boundaryContext.input);
    if (!tokenInfo) {
      return null;
    }
    if (isPartOfTechnicalToken(tokenInfo.core, tokenInfo.tokenStart, tokenInfo.tokenEnd)) {
      return null;
    }

    const normalizedToken = normalizeContractionToken(
      tokenInfo.token,
      tokenInfo.core.slice(0, tokenInfo.tokenStart),
    );
    if (!normalizedToken) {
      return null;
    }

    return {
      replacement: `${normalizedToken}${tokenInfo.trailing}`,
      deleteBackwards: boundaryContext.input.length - tokenInfo.tokenStart,
      deleteForwards: 0,
    };
  }
}

/**
 * The apostrophe form of `token` ("dont" -> "don't", "Im" -> "I'm"), or null.
 * `beforeToken` is the text before it: a capitalized word after another
 * capitalized word on the same line is a name ("Jony Ive"), not a contraction.
 */
export function normalizeContractionToken(token: string, beforeToken: string): string | null {
  const normalizedInput = token.toLowerCase();
  const canonical = ENGLISH_CONTRACTION_MAP.get(normalizedInput);
  if (!canonical) {
    return null;
  }
  // "Jony Ive", "Ada Ill": a capitalized token following another capitalized
  // word is a name, not a contraction someone forgot an apostrophe in.
  if (/^[A-Z][a-z]/.test(token)) {
    const lineStart = Math.max(beforeToken.lastIndexOf("\n"), beforeToken.lastIndexOf("\r")) + 1;
    // Only a capitalized word on the same line suggests a name; one that
    // merely ends the previous line says nothing about this token.
    const before = beforeToken.slice(lineStart).trimEnd();
    if (/[A-Z][a-z]*$/.test(before)) {
      return null;
    }
  }

  // "IM" is an acronym, not a missing apostrophe. Unambiguous forms such as
  // "DONT" stay corrected.
  if (FORCE_PRONOUN_I_PREFIX.has(normalizedInput) && token === token.toUpperCase()) {
    return null;
  }

  let normalizedToken = applyWordCase(canonical, detectWordCase(token));
  if (FORCE_PRONOUN_I_PREFIX.has(normalizedInput)) {
    normalizedToken = `I${normalizedToken.slice(1)}`;
  }
  return normalizedToken === token ? null : normalizedToken;
}

// Also ordinary words ("fell ill", "the cant of a roof", "as is his wont"),
// so only finished text, where the next word is known, can tell.
const CONTEXT_CONTRACTION_MAP = new Map(
  Object.entries({ cant: "can't", wont: "won't", ill: "i'll" }),
);
// Verbs that follow "can't"/"won't"/"I'll" in their bare form; none of them is
// a noun that "ill" or "cant" would modify ("ill will", "ill health").
const BARE_VERBS = new Set(
  (
    "be go do get see find wait believe stop help make say tell think understand remember " +
    "sleep come have work let take give use open load start run hear figure afford imagine " +
    "explain decide read write send call try keep leave know change fix happen hurt matter " +
    "stay agree check bring look need"
  ).split(" "),
);
// One adverb may sit between: "I cant really say".
const ADVERBS = new Set("really even just ever always possibly still actually".split(" "));
const SUBJECT_BEFORE =
  /(?:^|[^\p{L}\p{N}_'’])(?:i|you|we|they|he|she|it|who|that|this|there|someone|nobody|everyone)[ \t]+$/iu;
const CLAUSE_OPENER = /(?:^|[^\p{L}])(?:and|but|so|then|maybe|ok|okay|yes|no|well|or)$/iu;

/** True when `before` leaves the next word at the start of a clause. */
function opensClause(before: string): boolean {
  const trimmed = before.replace(/[ \t]+$/u, "");
  return trimmed === "" || /[.!?;:,\n]["'”’)\]]*$/u.test(trimmed) || CLAUSE_OPENER.test(trimmed);
}

/**
 * Finished text only (review): "cant", "wont" and "ill" as contractions,
 * decided by the word AFTER them, which typing never has. Each needs a bare
 * verb next ("i cant go", "it wont work", "ill be there"); "cant"/"wont"
 * also need a subject or a clause start before them ("Cant wait"), and "ill",
 * its own subject, a clause start. Returns the apostrophe form or null.
 */
export function normalizeContractionInContext(
  token: string,
  before: string,
  after: string,
): string | null {
  const lower = token.toLowerCase();
  const canonical = CONTEXT_CONTRACTION_MAP.get(lower);
  // All capitals may be an acronym ("ILL", "WONT" as a label).
  if (!canonical || (token === token.toUpperCase() && token.length > 1)) return null;
  const words = /^[ \t]+(\p{L}+)(?:[ \t]+(\p{L}+))?/u.exec(after);
  if (!words) return null;
  const verb = (ADVERBS.has(words[1].toLowerCase()) ? words[2] : words[1])?.toLowerCase();
  if (!verb || !BARE_VERBS.has(verb)) return null;
  if (
    lower === "ill" ? !opensClause(before) : !SUBJECT_BEFORE.test(before) && !opensClause(before)
  ) {
    return null;
  }
  // "Ada Ill" on one line is a name, as in normalizeContractionToken.
  if (/^[A-Z][a-z]/.test(token)) {
    const line = before.slice(before.lastIndexOf("\n") + 1).trimEnd();
    if (/[A-Z][a-z]*$/.test(line)) return null;
  }
  const cased = applyWordCase(canonical, detectWordCase(token));
  return lower === "ill" ? `I${cased.slice(1)}` : cased;
}
