import type { TextRange } from "./types";
import { ELIDED_QUOTE_START } from "./quotationWarnings";

/** One pass over masked prose; code punctuation cannot open or close a quotation. */
export function proseQuotations(text: string): { ranges: TextRange[]; examples: TextRange[] } {
  const ranges: TextRange[] = [];
  const examples: TextRange[] = [];
  const closers: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’", "«": "»" };
  let start = -1;
  let closer = "";
  let example = false;
  let previousExampleEnd = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (closer) {
      // Apostrophes inside a single quotation do not end its evidence. A plural
      // possessive before a lowercase word is ambiguous: keep protecting it.
      if (
        /['’]/.test(text[i]) &&
        /[\p{L}\p{M}]/u.test(text[i - 1] ?? "") &&
        (/^[\p{L}\p{M}]/u.test(text.slice(i + 1, i + 2)) ||
          (/[sS]/.test(text[i - 1]) && /^[ \t]+\p{L}/u.test(text.slice(i + 1, i + 12))))
      )
        continue;
      const paragraphEnd = text[i] === "\n" && /^\r?\n/.test(text.slice(i + 1, i + 3));
      if (text[i] !== closer && !paragraphEnd) continue;
      const range = { start, end: paragraphEnd ? i : i + 1 };
      ranges.push(range);
      if (example) {
        examples.push(range);
        previousExampleEnd = range.end;
      }
      closer = "";
    } else if (text[i] in closers && /^[\s([–—]?$/.test(text[i - 1] ?? "")) {
      start = i;
      closer = closers[text[i]];
      const before = text.slice(Math.max(0, i - 160), i);
      example =
        /\b(?:writes?|types?|spells?|phrases?|words?|examples?|literals?|texts?|terms?|forms?|headings?|titles?|labels?)(?:[ \t]+(?:such[ \t]+as|like|is|was|are))?[ :\t]*$/i.test(
          before,
        ) ||
        (previousExampleEnd >= 0 &&
          /^[ \t]*(?:,[ \t]*(?:(?:and|or)[ \t]+)?|(?:and|or)[ \t]+)$/.test(
            text.slice(previousExampleEnd, i),
          ));
      if (!example && /['‘]/.test(text[i]) && ELIDED_QUOTE_START.test(text.slice(i + 1, i + 12)))
        closer = "";
    }
  }
  if (closer) {
    const range = { start, end: text.length };
    ranges.push(range);
    if (example) examples.push(range);
  }
  return { ranges, examples };
}
