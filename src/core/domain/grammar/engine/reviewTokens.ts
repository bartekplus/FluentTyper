import { tokenize } from "./tokenizer";
import type { Token } from "./types";

/** The part of a Review chunk context that the tokens of the chunk depend on. */
export interface ChunkText {
  text: string;
  scanText: string;
  from: number;
  to: number;
}

// Context read around a chunk; a rule is far shorter.
const WINDOW = 256;
// One tokenizer pass per chunk serves the pattern rules and the phrase tables.
const TOKENS = new WeakMap<ChunkText, Token[]>();

/**
 * The tokens around the chunk of `ctx`: from 256 characters before it (at whitespace, so no
 * token is cut in two) to 256 characters after it. Computed once per chunk context.
 */
export function chunkTokens(ctx: ChunkText): Token[] {
  let tokens = TOKENS.get(ctx);
  if (!tokens) {
    let from = Math.max(0, ctx.from - WINDOW);
    while (from > 0 && !/\s/.test(ctx.text[from - 1])) from -= 1;
    tokens = tokenize(ctx.scanText, from, Math.min(ctx.scanText.length, ctx.to + WINDOW));
    TOKENS.set(ctx, tokens);
  }
  return tokens;
}
