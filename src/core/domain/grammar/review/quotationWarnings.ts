import type { RawFinding } from "./reviewDetectors";

const PAIRS: Readonly<Record<string, string>> = {
  '"': '"',
  "“": "”",
  "‘": "’",
  "«": "»",
  "‹": "›",
};
const CLOSERS = new Set(Object.values(PAIRS));
const LETTER = /[\p{L}\p{M}]/u;
export const ELIDED_QUOTE_START = /^(?:tis|twas|em|cause|bout|til|round|\d{2}s)\b/i;

/** One full, unprotected field. Uncertain conventions abort; no closing location is invented. */
export function unclosedQuotations(text: string): RawFinding[] {
  const stack: Array<{ open: string; close: string; start: number }> = [];
  let lineStart = 0;
  for (let index = 0; index < text.length; index++) {
    const mark = text[index];
    if (mark === "\n") {
      lineStart = index + 1;
      continue;
    }
    // Low/reversed quotation styles have competing conventions; do not pair them as English.
    if (/[„‚‟‛]/u.test(mark)) return [];
    if (!(mark in PAIRS) && !CLOSERS.has(mark)) continue;
    const before = text[index - 1] ?? "";
    const after = text[index + 1] ?? "";
    if (before === "\\") return [];
    if (mark === "’" && LETTER.test(before) && LETTER.test(after)) continue;
    if (mark === "‘" && ELIDED_QUOTE_START.test(text.slice(index + 1, index + 12))) return [];
    if (
      /\b(?:character|symbol|mark|quote)(?:[ \t]+is)?[ :\t]*$/i.test(
        text.slice(Math.max(0, index - 48), index),
      )
    )
      return [];
    const top = stack.at(-1);
    const paragraphOpening = lineStart > 0 && /^[ \t\u00a0]*$/.test(text.slice(lineStart, index));
    // Traditional multi-paragraph quotations reopen the same style at each paragraph.
    if (top?.open === mark && paragraphOpening && /\S/.test(after)) continue;
    if (top?.close === mark) {
      stack.pop();
      continue;
    }
    if (/[0-9]/.test(before) && (mark === '"' || mark === "”" || mark === "’")) continue;
    if (mark in PAIRS) {
      if (mark === '"' && ((before && !/[\s([{:;,–—]/u.test(before)) || !after || /\s/.test(after)))
        return [];
      if (top?.open === mark || stack.length >= 8) return [];
      stack.push({ open: mark, close: PAIRS[mark], start: index });
    } else {
      // Right apostrophes outside a single quotation can be possessive/elided text.
      if (mark === "’" && LETTER.test(before)) continue;
      return [];
    }
  }
  return stack
    .filter((open) => text.slice(open.start + 1).trim().length > 0)
    .map((open) => ({
      ruleId: "unclosedQuotation",
      messageKey: "review_msg_unclosed_quote",
      range: { start: open.start, end: open.start + 1 },
      alternatives: [],
      warningOnly: true,
      context: { start: 0, end: text.length },
    }));
}
