import type { MatchFixer } from "../../engine/reviewRules";
import type { RawFinding } from "../reviewDetectors";
import { englishWords } from "./shared";
import { finding } from "../finding";

// German quotes open low and close high: „so“. English marks typed in German text get the
// German ones: “so” → „so“, ”so” → „so“, ,,so“ → „so“, ''so'' → „so“; a straight or English
// mark closing a German opening one becomes “ („so" → „so“).

const OPEN = "„";
const CLOSE = "“";
// A mark that opens: after the start, a space or a bracket, before a letter or digit.
const OPENING_AT = (text: string, at: number, length: number) =>
  /^$|[\s([{–—/]$/u.test(text.slice(Math.max(0, at - 1), at)) &&
  /^[\p{L}\p{N}]/u.test(text.slice(at + length, at + length + 1));

function quoteFinding(start: number, end: number, replacement: string): RawFinding {
  return finding("germanQuotes", "review_msg_german_quotes", start, end, [replacement], {
    context: { start: Math.max(0, start - 40), end: end + 40 },
  });
}

// Each mark changes the count of open „ for the next marks of its paragraph.
const MARKS = /“|”|,,|''|"/g;

/** The count of open „ after `chars`; a line break closes them all. */
function track(open: number, chars: string): number {
  for (const c of chars) {
    if (c === OPEN) open++;
    else if (c === CLOSE && open > 0) open--;
    else if (c === "\n") open = 0;
  }
  return open;
}

/**
 * The line (paragraph) of a line frame match, as [start, end) offsets. The frame matches each
 * line that touches the chunk from the chunk start, so the first match may start inside its line.
 */
function lineOf(m: RegExpExecArray, text: string): [number, number] {
  const end = m.index + m[0].length - (m[0].endsWith("\n") ? 1 : 0);
  return [text.lastIndexOf("\n", m.index - 1) + 1, end];
}

/** The marks of one paragraph from the chunk start: English marks become German ones. */
const quoteMarks: MatchFixer = (line, ctx) => {
  const findings: RawFinding[] = [];
  const [paragraphStart, paragraphEnd] = lineOf(line, ctx.text);
  const base = line.index;
  const stop = Math.min(ctx.to, paragraphEnd);
  // The scan reads only this paragraph. A mark of two characters may end after the chunk.
  const scan = ctx.scanText.slice(base, Math.min(ctx.to + 1, paragraphEnd));
  const marks = MARKS;
  marks.lastIndex = 0;
  // Whether a German „ is open in this paragraph, read from its start.
  let open = track(0, ctx.text.slice(paragraphStart, base));
  let scanned = base;
  for (let m = marks.exec(scan); m && base + m.index < stop; m = marks.exec(scan)) {
    const at = base + m.index;
    open = track(open, ctx.text.slice(scanned, at));
    scanned = at + m[0].length;
    const [mark] = m;
    const opening = OPENING_AT(ctx.text, at, mark.length);
    // A quoted English phrase may keep its English marks: “I love you”.
    if (opening && open === 0 && mark !== '"') {
      const close = /[“”"]|''|\n/.exec(ctx.text.slice(scanned, scanned + 200));
      if (
        close &&
        close[0] !== "\n" &&
        englishWords(ctx.text.slice(scanned, scanned + close.index))
      ) {
        scanned += close.index + close[0].length;
        marks.lastIndex = scanned - base;
        continue;
      }
    }
    if (mark === '"') {
      // A straight mark only closes a German opening one: „so" → „so“.
      if (open > 0 && !opening) {
        findings.push(quoteFinding(at, at + 1, CLOSE));
        open--;
      }
      continue;
    }
    if (mark === CLOSE) {
      if (open > 0 || !opening) {
        if (open > 0) open--;
        continue;
      }
      findings.push(quoteFinding(at, at + 1, OPEN));
      open++;
      continue;
    }
    if (mark === "”") {
      if (opening && open === 0) {
        findings.push(quoteFinding(at, at + 1, OPEN));
        open++;
      } else {
        findings.push(quoteFinding(at, at + 1, CLOSE));
        if (open > 0) open--;
      }
      continue;
    }
    // ",,so" and "''so''": doubled commas or apostrophes as quotes.
    if (opening && open === 0) {
      findings.push(quoteFinding(at, at + 2, OPEN));
      open++;
    } else if (mark === "''" && open > 0 && /[\p{L}\p{N}.!?)]$/u.test(ctx.text.slice(at - 1, at))) {
      findings.push(quoteFinding(at, at + 2, CLOSE));
      open--;
    }
  }
  return findings;
};

// A quotation inside a quotation takes the single marks: „Er sagte ‚Hallo‘.“, »… ›…‹ …«.
const NESTING = [
  ["„", "“", "‚", "‘"],
  ["»", "«", "›", "‹"],
] as const;
// The outer marks of each row: the scan jumps from mark to mark, not from character to character.
const OUTER_MARKS = NESTING.map(([open, close]) => new RegExp(`[${open}${close}]`, "g"));

/** The quotations inside quotations of one line. */
const nestedQuotes: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const [start, end] = lineOf(m, ctx.text);
  const line = ctx.text.slice(start, end);
  for (const [row, [open, , innerOpen, innerClose]] of NESTING.entries()) {
    const stack: number[] = [];
    let inner: Array<[number, number]> = [];
    for (const mark of line.matchAll(OUTER_MARKS[row])) {
      const i = start + mark.index;
      if (mark[0] === open) stack.push(i);
      else if (stack.length > 0) {
        const from = stack.pop()!;
        if (stack.length > 0) inner.push([from, i]);
        else {
          // Only once the outer quotation closes too: an unclosed one may be the slip.
          for (const [a, b] of inner) {
            if (a >= ctx.from && a < ctx.to) findings.push(quoteFinding(a, a + 1, innerOpen));
            if (b >= ctx.from && b < ctx.to) findings.push(quoteFinding(b, b + 1, innerClose));
          }
          inner = [];
        }
      }
    }
  }
  return findings;
};

/** Straight quotes in pairs on one line: "so" → „so“ (opt-in). */
const straightQuotes: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const [start, end] = lineOf(m, ctx.text);
  const marks: number[] = [];
  const line = ctx.text.slice(start, end);
  for (let i = line.indexOf('"'); i >= 0; i = line.indexOf('"', i + 1)) {
    // "ein 16"-Monitor": inches.
    if (!/\p{N}/u.test(ctx.text[start + i - 1] ?? "")) marks.push(start + i);
  }
  if (marks.length % 2 === 1) return null;
  for (let k = 0; k < marks.length; k += 2) {
    const [a, b] = [marks[k], marks[k + 1]];
    if (!OPENING_AT(ctx.text, a, 1) || /\s/.test(ctx.text[b - 1])) continue;
    if (englishWords(ctx.text.slice(a + 1, b))) continue;
    for (const [at, mark] of [
      [a, OPEN],
      [b, CLOSE],
    ] as const) {
      if (at >= ctx.from && at < ctx.to)
        findings.push({ ...quoteFinding(at, at + 1, mark), ruleId: "germanStraightQuotes" });
    }
  }
  return findings;
};

// The partner of each mark, and the mark of the same kind that may not stand between them.
const PARTNERS: Record<string, [string, string]> = {
  "„": ["“", "„"],
  "»": ["«", "»"],
  "(": [")", "("],
  "“": ["„", "“"],
  "«": ["»", "«"],
  ")": ["(", ")"],
};

/** The named frame fixes of the quote rules of grammar/rules/de.yaml. */
export const FIXERS = {
  quoteMarks,
  nestedQuotes,
  straightQuotes,
  speech: (m, ctx) => {
    // The quotation must open with „ on the same line.
    const line = ctx.text.slice(ctx.text.lastIndexOf("\n", m.index) + 1, m.index);
    if (!line.includes(OPEN)) return null;
    const { period, after } = m.groups!;
    // "z. B.“": a dot that ends an abbreviation stays.
    if (
      period &&
      /(?:(?<!\p{L})\p{L}{1,3}|\d)$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
    )
      return null;
    const replacement = period || after ? "" : "“,";
    return quoteFinding(m.index, m.index + m[0].length, replacement);
  },
  innerSpacing: (m, ctx) => {
    const start = m.index;
    const end = start + m[0].length;
    const opening = /[„»(]/.test(ctx.text[start - 1]);
    const mark = opening ? ctx.text[start - 1] : ctx.text[end];
    const [partner, same] = PARTNERS[mark];
    const lineStart = ctx.text.lastIndexOf("\n", start) + 1;
    const lineEnd = ctx.text.indexOf("\n", end);
    const line = opening
      ? ctx.text.slice(end, lineEnd < 0 ? ctx.text.length : lineEnd)
      : ctx.text.slice(lineStart, start);
    // The partner nearest the mark, with no other mark of the same kind between.
    const at = opening ? line.indexOf(partner) : line.lastIndexOf(partner);
    if (at < 0) return null;
    const between = opening ? line.slice(0, at) : line.slice(at + 1);
    if (between.includes(same)) return null;
    // A smiley ":(" or ";-(" is no bracket.
    const open = opening ? start - 1 : lineStart + at;
    if (ctx.text[open] === "(" && /[:;=-]/.test(ctx.text[open - 1] ?? "")) return null;
    return finding("germanQuotes", "review_msg_german_inner_spacing", start, end, [""], {
      context: { start: Math.max(0, start - 20), end: end + 20 },
    });
  },
} satisfies Record<string, MatchFixer>;
