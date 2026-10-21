// The rule library (library/english.ts): English word classes and text checks that many rules
// read.
import type { DetectContext, RawFinding } from "../../review/reviewDetectors";
import { namedExampleBefore } from "../../review/exampleCues";
import { afterBreak, wordBefore } from "../../review/english/slotWords";

// Nouns that name a group and may take a plural verb: "the team are".
export const COLLECTIVE = new Set(
  "team staff family police government committee crew band audience public class group majority folk blues rest number couple pair lot jury army navy board council club company firm management media data total variety range series species means news remainder masters woods belt".split(
    " ",
  ),
);

/** The word before `index` matches `cue`, or a clause break comes right before it. */
export function opensClause(ctx: DetectContext, index: number, cue: RegExp): boolean {
  const before = wordBefore(ctx, index);
  return before ? cue.test(before) : afterBreak(ctx, index);
}

/** A finding inside a named example ("the word 'teh'") is a mention, not a slip. */
export function quotedMention(ctx: DetectContext, finding: RawFinding): boolean {
  return namedExampleBefore(ctx.text, finding.range.start);
}

/** The alternative in the case of the typed words: all capitals, a capital first, or as given. */
export function recase(typed: string, alternative: string, whole: string): string {
  const letters = typed.replace(/\P{L}/gu, "");
  const all = whole.replace(/\P{L}/gu, "");
  if (
    letters &&
    letters === letters.toUpperCase() &&
    (letters.length > 1 || all === all.toUpperCase())
  )
    return alternative.toUpperCase();
  return /^\P{L}*\p{Lu}/u.test(typed)
    ? alternative.replace(/\p{L}/u, (c) => c.toUpperCase())
    : alternative;
}
