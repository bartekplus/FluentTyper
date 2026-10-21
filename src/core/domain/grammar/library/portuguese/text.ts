// The rule library (library.ts): Portuguese text helpers.
import type { DetectContext } from "../../review/reviewDetectors";

/** The flagged text, or the token around it, is in the user's dictionary. */
export function userWord(ctx: DetectContext, start: number, end: number): boolean {
  const before = /\S*$/.exec(ctx.text.slice(Math.max(0, start - 24), start))![0];
  const after = /^\S*/.exec(ctx.text.slice(end, end + 24))![0];
  const token = `${before}${ctx.text.slice(start, end)}${after}`.replace(/[.,;:!?]+$/, "");
  return [ctx.text.slice(start, end), token].some((word) =>
    ctx.dictionary.has(word.trim().toLowerCase()),
  );
}
