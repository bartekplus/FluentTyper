// Blockquote markers and a list item marker may precede a fence ("> ~~~",
// "- ```"); CommonMark treats both as container prefixes, not content.
const CONTAINER_PREFIX_REGEX = /^(?: {0,3}> ?)*(?: {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+)?/;
const FENCE_REGEX = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** The fence run on `line`, or null. A backtick fence's info string cannot hold a backtick. */
function readFence(line: string): { run: string; rest: string } | null {
  const match = line.replace(CONTAINER_PREFIX_REGEX, "").match(FENCE_REGEX);
  if (!match || (match[1][0] === "`" && match[2].includes("`"))) {
    return null;
  }
  return { run: match[1], rest: match[2] };
}

// Prose quotation marks and their closers. A straight single quote is left out:
// it is also an apostrophe ("don't", "the 90's").
const PROSE_QUOTE_CLOSERS: Record<string, string> = {
  '"': '"',
  "“": "”",
  "‘": "’",
  "«": "»",
};

/**
 * True when the end of `text` (the text before the cursor) sits inside Markdown
 * code that has not been closed yet. Conservative: an unclosed delimiter counts
 * as open, since its closer may simply not be typed.
 *
 * - Fenced blocks (CommonMark 4.5): a run of 3+ backticks or tildes opens, also
 *   inside a blockquote or list item; only a line holding a run of the same
 *   character, at least as long, closes it. Everything inside is protected,
 *   including backticks. "```x```" is an inline span, not a fence.
 * - Code spans (CommonMark 6.1): a backtick run closes only at a run of the same
 *   length, so ``a `b` c`` stays open across the inner single backticks. An
 *   escaped backtick (\`) outside a span is literal (CommonMark 2.4).
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
      const found = readFence(line);
      if (fence) {
        if (
          found &&
          found.run[0] === fence.char &&
          found.run.length >= fence.length &&
          found.rest.trim() === ""
        ) {
          fence = null;
        }
        continue;
      }
      if (found) {
        fence = { char: found.run[0], length: found.run.length };
        continue;
      }
    }

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === "\\" && spanRun === 0) {
        // Escapes the next character; inside a code span a backslash is literal.
        i += 1;
      } else if (ch === "`") {
        let run = 1;
        while (line[i + run] === "`") run += 1;
        i += run - 1;
        if (spanRun === 0) spanRun = run;
        else if (spanRun === run) spanRun = 0;
      } else if (spanRun > 0) {
        continue;
      } else if (proseCloser) {
        if (ch === proseCloser) proseCloser = "";
      } else if (
        options.quotations &&
        ch in PROSE_QUOTE_CLOSERS &&
        /^[\s([–—]?$/.test(line[i - 1] ?? "")
      ) {
        proseCloser = PROSE_QUOTE_CLOSERS[ch];
      }
    }
  }
  return fence !== null || spanRun > 0 || proseCloser !== "";
}

/** True when the cursor (end of `text`) sits in a Markdown fence or code span. */
export function isInsideMarkdownCode(text: string): boolean {
  // Cheap precheck: most prose has neither delimiter, so skip the full scan.
  return (text.includes("`") || text.includes("~~~")) && isInsideProtectedSpan(text);
}
