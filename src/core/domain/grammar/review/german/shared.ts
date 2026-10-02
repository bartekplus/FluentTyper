import type { DetectContext } from "../reviewDetectors";

export const isGerman = (ctx: DetectContext) => ctx.lang.slice(0, 2) === "de";

export const wordSet = (list: string) => new Set(list.split(" "));

/** A token that ends a clause, or no token at all. */
export const BOUNDARY = /^(?:[.!?:;,()"“”„«»–—\n-]|$)/;

// A word of letters, not glued into a number, path, mention or dotted token.
const WORD =
  /(?<![\p{L}\p{M}\p{N}_@/#\\.-])\p{L}[\p{L}\p{M}]*(?![\p{L}\p{M}\p{N}_@/#\\]|\.\p{L})/gu;

/** The words whose start the chunk owns. */
export function* words(ctx: DetectContext): Generator<RegExpExecArray> {
  WORD.lastIndex = ctx.from;
  for (let m = WORD.exec(ctx.scanText); m && m.index < ctx.to; m = WORD.exec(ctx.scanText)) {
    yield m;
  }
}

// Words (with "_" or "/" joins: "Pädagog_in", "Partner/in"), line breaks and single marks.
const TOKEN = /\n|[\p{L}\p{M}\p{N}_]+(?:\/[\p{L}\p{M}\p{N}_]+)*|[^\s\p{L}\p{M}\p{N}_]/gu;

/** Up to `n` tokens right before `index`, nearest last; a line break is a token. */
export function tokensBefore(text: string, index: number, n: number): string[] {
  const start = Math.max(0, index - 16 * n);
  const tokens = text.slice(start, index).match(TOKEN) ?? [];
  // The first token may be cut by the window.
  return tokens.slice(Math.max(start > 0 ? 1 : 0, tokens.length - n));
}

/** Up to `n` tokens right after `index`. */
export function tokensAfter(text: string, index: number, n: number): string[] {
  return (text.slice(index, index + 16 * n).match(TOKEN) ?? []).slice(0, n);
}
