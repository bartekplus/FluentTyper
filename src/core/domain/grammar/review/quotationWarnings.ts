import { MARK_CUE } from "./exampleCues";
import type { RawFinding } from "./reviewDetectors";

// Opening mark -> its closing marks per language. A closer that opens elsewhere
// (German „…“ closes with the English opener) is only safe with its own table.
const EN_PAIRS: Readonly<Record<string, string>> = {
  '"': '"',
  "“": "”",
  "‘": "’",
  "«": "»",
  "‹": "›",
};
const PAIRS_BY_LANGUAGE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // „…“ is standard in German and „…” in Polish and Croatian; both are common in each.
  de: { '"': '"', "„": "“”", "‚": "‘’", "»": "«", "«": "»" },
  pl: { '"': '"', "„": "”“", "«": "»" },
  hr: { '"': '"', "„": "”“", "»": "«" },
  // Swedish opens and closes with the same mark: ”…”, »…».
  sv: { '"': '"', "”": "”", "»": "»" },
};
const LOW_QUOTES = /[„‚‟‛]/u;
const LETTER = /[\p{L}\p{M}]/u;
export const ELIDED_QUOTE_START = /^(?:tis|twas|em|cause|bout|til|round|\d{2}s)\b/i;

/** One full, unprotected field. Uncertain conventions abort; no closing location is invented. */
export function unclosedQuotations(text: string, lang: string): RawFinding[] {
  const PAIRS = PAIRS_BY_LANGUAGE[lang.slice(0, 2)] ?? EN_PAIRS;
  const CLOSERS = new Set(Object.values(PAIRS).join(""));
  const stack: Array<{ open: string; close: string; start: number }> = [];
  let lineStart = 0;
  for (let index = 0; index < text.length; index++) {
    const mark = text[index];
    if (mark === "\n") {
      lineStart = index + 1;
      continue;
    }
    // Low/reversed quotation styles have competing conventions; do not pair them as English.
    if (LOW_QUOTES.test(mark) && !(mark in PAIRS)) return [];
    if (!(mark in PAIRS) && !CLOSERS.has(mark)) continue;
    const before = text[index - 1] ?? "";
    const after = text[index + 1] ?? "";
    if (before === "\\") return [];
    if (mark === "’" && LETTER.test(before) && LETTER.test(after)) continue;
    if (mark === "‘" && ELIDED_QUOTE_START.test(text.slice(index + 1, index + 12))) return [];
    if (MARK_CUE.test(text.slice(Math.max(0, index - 48), index))) return [];
    const top = stack.at(-1);
    const paragraphOpening = lineStart > 0 && /^[ \t\u00a0]*$/.test(text.slice(lineStart, index));
    // Traditional multi-paragraph quotations reopen the same style at each paragraph.
    if (top?.open === mark && paragraphOpening && /\S/.test(after)) continue;
    if (top?.close.includes(mark)) {
      stack.pop();
      continue;
    }
    if (/[0-9]/.test(before) && (mark === '"' || mark === "”" || mark === "’")) continue;
    if (mark in PAIRS) {
      if (
        PAIRS[mark] === mark &&
        ((before && !/[\s([{:;,–—]/u.test(before)) || !after || /\s/.test(after))
      )
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
