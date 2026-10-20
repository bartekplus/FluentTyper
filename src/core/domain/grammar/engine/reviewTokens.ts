import { tokenize } from "./tokenizer";
import type { Token } from "./types";

/** The part of a Review chunk context that the tokens of the chunk depend on. */
export interface ChunkText {
  text: string;
  scanText: string;
  from: number;
  to: number;
}

// Context read before a chunk: patterns read at most the token before a match. After it: a
// pattern that starts in the chunk ends within 96 characters (the old phrase window). Repair
// rescans many small windows, so a larger margin costs more than the window itself.
const BEFORE = 32;
const AFTER = 96;
// One tokenizer pass per chunk serves the pattern rules and the phrase tables.
const TOKENS = new WeakMap<ChunkText, Token[]>();

/**
 * The tokens around the chunk of `ctx`: from 32 characters before it (at whitespace, so no
 * token is cut in two) to 96 characters after it. Computed once per chunk context.
 */
export function chunkTokens(ctx: ChunkText): Token[] {
  let tokens = TOKENS.get(ctx);
  if (!tokens) {
    let from = Math.max(0, ctx.from - BEFORE);
    while (from > 0 && !/\s/.test(ctx.text[from - 1])) from -= 1;
    tokens = tokenize(ctx.scanText, from, Math.min(ctx.scanText.length, ctx.to + AFTER));
    TOKENS.set(ctx, tokens);
  }
  return tokens;
}
