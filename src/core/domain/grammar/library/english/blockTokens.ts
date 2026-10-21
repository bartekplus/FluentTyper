// The rule library (library/english.ts): the tokens around a target inside its text block. A
// wrapped line continues its sentence; a blank line or a list, heading or quote line does not.
import type { DetectContext, RawFinding } from "../../review/reviewDetectors";
import { wordKey } from "../../implementations/helpers/GenericRuleShared";

/** A word or one punctuation mark: its text, its key (lowercase, ’ as '), and its range. */
export type BlockToken = { text: string; w: string; start: number; end: number };

/** A replacement of [start, end) with the alternatives, and the message key when it is not the rule's. */
export type BlockHit = {
  start: number;
  end: number;
  alts: string[];
  key?: RawFinding["messageKey"];
};

const TOKEN = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*|[^\s\p{L}\p{N}]/gu;

function tokens(ctx: DetectContext, from: number, to: number): BlockToken[] {
  const slice = ctx.text.slice(from, to);
  const out: BlockToken[] = [];
  for (const m of slice.matchAll(TOKEN)) {
    const lower = m[0].toLowerCase();
    out.push({
      text: m[0],
      // wordKey, without its replace when the token has no ’ (most tokens).
      w: lower.includes("’") ? wordKey(lower) : lower,
      start: from + m.index,
      end: from + m.index + m[0].length,
    });
  }
  return out;
}

const BLOCK_START = /^[ \t]*(?:\r?\n|[-*+#>|][ \t]|\d+[.)][ \t])/;
const blockBreak = (text: string, nl: number) =>
  BLOCK_START.test(text.slice(nl + 1, nl + 8)) ||
  /\n[ \t]*\r?$/.test(text.slice(Math.max(0, nl - 8), nl));

/** The tokens of the 72 characters before `start` in its block, the nearest first. */
export function blockTokensBefore(ctx: DetectContext, start: number): BlockToken[] {
  let from = Math.max(0, start - 72);
  // Line breaks inside the window only, nearest first: a search of the whole text
  // before every target would grow with its position.
  const window = ctx.text.slice(from, start);
  for (
    let nl = window.lastIndexOf("\n");
    nl >= 0;
    nl = nl > 0 ? window.lastIndexOf("\n", nl - 1) : -1
  )
    if (blockBreak(ctx.text, from + nl)) {
      from += nl + 1;
      break;
    }
  const list = tokens(ctx, from, start);
  // A word cut by the window is not a word.
  if (from > 0 && list[0]?.start === from && /[\p{L}\p{N}]/u.test(ctx.text[from - 1] ?? ""))
    list.shift();
  return list.reverse();
}

/** The tokens of the 72 characters after `end` in its block. */
export function blockTokensAfter(ctx: DetectContext, end: number): BlockToken[] {
  let to = Math.min(ctx.text.length, end + 72);
  const window = ctx.text.slice(end, to);
  for (let nl = window.indexOf("\n"); nl >= 0; nl = window.indexOf("\n", nl + 1))
    if (blockBreak(ctx.text, end + nl)) {
      to = end + nl;
      break;
    }
  const list = tokens(ctx, end, to);
  if (to < ctx.text.length && list.at(-1)?.end === to && /[\p{L}\p{N}]/u.test(ctx.text[to] ?? ""))
    list.pop();
  return list;
}

/** A token that is a word (it starts with a letter or a digit). */
export const isBlockWord = (t: BlockToken | undefined): t is BlockToken =>
  !!t && /^[\p{L}\p{N}]/u.test(t.text);
