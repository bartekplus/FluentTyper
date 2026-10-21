// The rule library (library.ts): the Arabic lexicon and Arabic word helpers.
import type { DetectContext, RawFinding } from "../review/reviewDetectors";
import { reviewData } from "../review/reviewLanguageData";
import { graphWords, WordGraph } from "../review/wordGraph";
import type * as Lexicon from "../review/arabic/lexicon.generated";

export { digitValue, invalidIsoDate } from "../review/isoDates";
export { contextYear, daysInMonth, weekdayOf, yearsFor } from "../review/reviewClock";

/** A finding without its rule id: the rule file adds the id of its frame. */
export type ArabicFinding = Omit<RawFinding, "ruleId">;

/** A word of the text and the text between it and the word before it. */
export type ArabicToken = { word: string; start: number; end: number; gap: string };

/** A token step of a rule file: the findings of the word at `i` of the token list. */
export type ArabicStep = (
  ctx: DetectContext,
  list: readonly ArabicToken[],
  i: number,
) => ArabicFinding | readonly ArabicFinding[] | null | undefined;

// Whole unvowelled words: a vowelled word is left to the writer. A trailing tanwin
// fath ("رجلاً") is kept apart so the word itself still reads.
const TOKEN = /(?<![\p{L}\p{M}\p{N}])\p{L}+(?=ً?(?![\p{L}\p{M}\p{N}]))/gu;
const TOKENS = new WeakMap<DetectContext, ArabicToken[]>();

/** The words from 96 characters before the chunk to 160 after it (one list per chunk). */
export function arabicTokens(ctx: DetectContext): readonly ArabicToken[] {
  let list = TOKENS.get(ctx);
  if (!list) {
    list = [];
    TOKEN.lastIndex = Math.max(0, ctx.from - 96);
    const limit = Math.min(ctx.text.length, ctx.to + 160);
    for (let m = TOKEN.exec(ctx.text); m && m.index < limit; m = TOKEN.exec(ctx.text)) {
      const previous = list.at(-1);
      list.push({
        word: m[0],
        start: m.index,
        end: m.index + m[0].length,
        gap: previous ? ctx.text.slice(previous.end, m.index) : "",
      });
    }
    TOKENS.set(ctx, list);
  }
  return list;
}

/** The index of the token that starts at `start` (a binary search), or -1. */
export function arabicTokenAt(list: readonly { start: number }[], start: number): number {
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (list[mid].start === start) return mid;
    if (list[mid].start < start) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

let classes: WordGraph | undefined;
/** The lexicon tags of a bare word ("قميص" -> "m"; see scripts/generate-arabic-lexicon.ts). */
export const arabicTags = (word: string) =>
  (classes ??= new WordGraph(reviewData<typeof Lexicon>("ar").WORD_CLASSES)).completions(
    `${word}|`,
  )[0] ?? "";

let femininePlurals: Set<string> | undefined;
/** The lexicon has an -ات plural for the noun in ة of this stem ("ساع" of "ساعات"). */
export const arabicFemininePluralStem = (stem: string) =>
  (femininePlurals ??= new Set(
    graphWords(reviewData<typeof Lexicon>("ar").FEMININE_PLURAL_STEMS),
  )).has(stem);
