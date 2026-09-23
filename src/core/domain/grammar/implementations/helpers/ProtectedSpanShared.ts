// Characters after which a quote opens a string literal (`text = "`, `f("`)
// rather than prose quotation.
const LITERAL_OPENERS = new Set(["=", "(", ",", "[", "{", ":", "+"]);
const FENCE_OPEN_REGEX = /^ {0,3}(`{3,}|~{3,})/;
// Prose quotation marks and their closers. A straight single quote is left out:
// it is also an apostrophe ("don't", "the 90's").
const PROSE_QUOTE_CLOSERS: Record<string, string> = { '"': '"', "“": "”", "‘": "’" };

/**
 * True when the end of `text` (the text before the cursor) sits inside Markdown
 * code or a string literal that has not been closed yet. Conservative: an
 * unclosed delimiter counts as open, since its closer may simply not be typed.
 *
 * - Fenced blocks (CommonMark 4.5): a run of 3+ backticks or tildes opens; only a
 *   line holding a run of the same character, at least as long, closes it.
 *   Everything inside is protected, including backticks.
 * - Code spans (CommonMark 6.1): a backtick run closes only at a run of the same
 *   length, so ``a `b` c`` stays open across the inner single backticks.
 * - String literals: a quote opened after code punctuation stays open until the
 *   same quote, skipping backslash escapes, so `"it's a` and `'say "hi" a` are
 *   still inside the string.
 * - Prose quotations, only with `quotations`: a double or curly quote opened at
 *   a word start stays open, across lines, until its closing mark.
 */
export function isInsideProtectedSpan(
  text: string,
  options: { quotations?: boolean } = {},
): boolean {
  let fence: { char: string; length: number } | null = null;
  let spanRun = 0;
  let proseCloser = "";
  const lines = text.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (spanRun === 0) {
      const fenceRun = line.match(FENCE_OPEN_REGEX)?.[1];
      if (fence) {
        if (
          fenceRun &&
          fenceRun[0] === fence.char &&
          fenceRun.length >= fence.length &&
          line.trim() === fenceRun
        ) {
          fence = null;
        }
        continue;
      }
      if (fenceRun) {
        fence = { char: fenceRun[0], length: fenceRun.length };
        continue;
      }
    }

    // A string literal cannot span lines, so the quote state starts fresh.
    let quote = "";
    let lastNonSpace = "";
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === "`" && !quote) {
        let run = 1;
        while (line[i + run] === "`") run += 1;
        i += run - 1;
        if (spanRun === 0) spanRun = run;
        else if (spanRun === run) spanRun = 0;
      } else if (spanRun > 0) {
        continue;
      } else if (quote) {
        if (ch === "\\") i += 1;
        else if (ch === quote) quote = "";
      } else if ((ch === '"' || ch === "'") && LITERAL_OPENERS.has(lastNonSpace)) {
        quote = ch;
      } else if (proseCloser) {
        if (ch === proseCloser) proseCloser = "";
      } else if (
        options.quotations &&
        ch in PROSE_QUOTE_CLOSERS &&
        /^[\s([]?$/.test(line[i - 1] ?? "")
      ) {
        proseCloser = PROSE_QUOTE_CLOSERS[ch];
      }
      if (ch.trim()) lastNonSpace = ch;
    }
    if (lineIndex === lines.length - 1 && quote) return true;
  }
  return fence !== null || spanRun > 0 || proseCloser !== "";
}
