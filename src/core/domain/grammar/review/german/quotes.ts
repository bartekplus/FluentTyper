import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { englishWords, isGerman } from "./shared";
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

function quotes(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  const marks = /“|”|,,|''|"/g;
  marks.lastIndex = ctx.from;
  // Whether a German „ is open in this paragraph, read from its start.
  const paragraphStart = ctx.text.lastIndexOf("\n", ctx.from - 1) + 1;
  let open = 0;
  for (const c of ctx.text.slice(paragraphStart, ctx.from)) {
    if (c === OPEN) open++;
    else if (c === CLOSE && open > 0) open--;
    else if (c === "\n") open = 0;
  }
  let scanned = ctx.from;
  for (let m = marks.exec(ctx.scanText); m && m.index < ctx.to; m = marks.exec(ctx.scanText)) {
    for (const c of ctx.text.slice(scanned, m.index)) {
      if (c === OPEN) open++;
      else if (c === CLOSE && open > 0) open--;
      else if (c === "\n") open = 0;
    }
    scanned = m.index + m[0].length;
    const [mark] = m;
    const at = m.index;
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
        marks.lastIndex = scanned;
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
  return [...findings, ...nested(ctx)];
}

/** The lines (paragraphs) that overlap the chunk, as [start, end) offsets. */
function* lines(ctx: DetectContext): Generator<[number, number]> {
  let start = ctx.text.lastIndexOf("\n", ctx.from - 1) + 1;
  while (start < ctx.to) {
    const newline = ctx.text.indexOf("\n", start);
    const end = newline < 0 ? ctx.text.length : newline;
    yield [start, end];
    start = end + 1;
  }
}

// A quotation inside a quotation takes the single marks: „Er sagte ‚Hallo‘.“, »… ›…‹ …«.
const NESTING = [
  ["„", "“", "‚", "‘"],
  ["»", "«", "›", "‹"],
] as const;
// The outer marks of each row: the scan jumps from mark to mark, not from character to character.
const OUTER_MARKS = NESTING.map(([open, close]) => new RegExp(`[${open}${close}]`, "g"));

function nested(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const [start, end] of lines(ctx)) {
    const line = ctx.text.slice(start, end);
    for (const [row, [open, , innerOpen, innerClose]] of NESTING.entries()) {
      const stack: number[] = [];
      let inner: Array<[number, number]> = [];
      for (const m of line.matchAll(OUTER_MARKS[row])) {
        const i = start + m.index;
        if (m[0] === open) stack.push(i);
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
  }
  return findings;
}

/** Straight quotes in pairs on one line: "so" → „so“ (opt-in). */
function straight(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const [start, end] of lines(ctx)) {
    const marks: number[] = [];
    const line = ctx.text.slice(start, end);
    for (let i = line.indexOf('"'); i >= 0; i = line.indexOf('"', i + 1)) {
      // "ein 16"-Monitor": inches.
      if (!/\p{N}/u.test(ctx.text[start + i - 1] ?? "")) marks.push(start + i);
    }
    if (marks.length % 2 === 1) continue;
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
  }
  return findings;
}

// Verbs of saying after a quotation: „Komm!“, rief sie.
const SAYING =
  "sagte|sagt|sagten|rief|ruft|riefen|fragte|fragt|fragten|dachte|denkt|meinte|meint|antwortete|" +
  "antwortet|erwiderte|erwidert|flüsterte|flüstert|schrie|schreit|murmelte|murmelt|erklärte|" +
  "erklärt|behauptete|behauptet|seufzte|lachte|rief|bat|befahl";
// Inside a „…“ quotation: a period before the closing mark and a comma or another mark after
// it („Ich gehe.“, sagte er → „Ich gehe“, sagte er; „Ich gehe.“. → „Ich gehe.“), a comma
// before the closing mark („Ich gehe,“ sagte er → „Ich gehe“, sagte er), and the comma a
// question or exclamation needs before the verb of saying („Wirklich?“ fragte sie).
const SPEECH = new RegExp(
  `(?<period>\\.)(?=“[ \\t]*[,!?])|(?<=\\.“)(?<after>\\.)|(?<=\\p{L})(?<comma>,“)(?=[ \\t]+\\p{Ll})|(?<=[!?])(?<close>“)(?=[ \\t]+(?:${SAYING})(?![\\p{L}]))`,
  "gdu",
);

function speech(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  SPEECH.lastIndex = ctx.from;
  for (let m = SPEECH.exec(ctx.scanText); m && m.index < ctx.to; m = SPEECH.exec(ctx.scanText)) {
    // The quotation must open with „ on the same line.
    const line = ctx.text.slice(ctx.text.lastIndexOf("\n", m.index) + 1, m.index);
    if (!line.includes(OPEN)) continue;
    const { period, after } = m.groups!;
    // "z. B.“": a dot that ends an abbreviation stays.
    if (
      period &&
      /(?:(?<!\p{L})\p{L}{1,3}|\d)$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
    )
      continue;
    const replacement = period || after ? "" : "“,";
    findings.push(quoteFinding(m.index, m.index + m[0].length, replacement));
  }
  return findings;
}

// No space goes right inside quotation marks or brackets: „ Der Hund …“ → „Der Hund …“,
// (nur kleine ) → (nur kleine). The mark must have its partner on the same line, so a lone
// mark, a smiley ":( " and Swiss «…» quotes stay alone.
const INNER = /(?<=[„»(])[ \t]+(?=\p{L})|(?<=[\p{L}.!?…])[ \t]+(?=[“«)])/gu;
const PARTNERS: Record<string, [string, string]> = {
  "„": ["“", "„"],
  "»": ["«", "»"],
  "(": [")", "("],
  "“": ["„", "“"],
  "«": ["»", "«"],
  ")": ["(", ")"],
};

function innerSpacing(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  INNER.lastIndex = ctx.from;
  for (let m = INNER.exec(ctx.scanText); m && m.index < ctx.to; m = INNER.exec(ctx.scanText)) {
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
    if (at < 0) continue;
    const between = opening ? line.slice(0, at) : line.slice(at + 1);
    if (between.includes(same)) continue;
    // A smiley ":(" or ";-(" is no bracket.
    const open = opening ? start - 1 : lineStart + at;
    if (ctx.text[open] === "(" && /[:;=-]/.test(ctx.text[open - 1] ?? "")) continue;
    findings.push(
      finding("germanQuotes", "review_msg_german_inner_spacing", start, end, [""], {
        context: { start: Math.max(0, start - 20), end: end + 20 },
      }),
    );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["germanQuotes"],
    detect: (ctx) => [...quotes(ctx), ...speech(ctx), ...innerSpacing(ctx)],
  },
  { rules: ["germanStraightQuotes"], detect: straight },
];
