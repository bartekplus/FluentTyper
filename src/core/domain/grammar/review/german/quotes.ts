import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { englishWords, isGerman } from "./shared";

// German quotes open low and close high: „so“. English marks typed in German text get the
// German ones: “so” → „so“, ”so” → „so“, ,,so“ → „so“, ''so'' → „so“; a straight or English
// mark closing a German opening one becomes “ („so" → „so“).

const OPEN = "„";
const CLOSE = "“";
// A mark that opens: after the start, a space or a bracket, before a letter or digit.
const OPENING_AT = (text: string, at: number, length: number) =>
  /^$|[\s([{–—/]$/u.test(text.slice(Math.max(0, at - 1), at)) &&
  /^[\p{L}\p{N}]/u.test(text.slice(at + length, at + length + 1));

function finding(start: number, end: number, replacement: string): RawFinding {
  return {
    ruleId: "germanQuotes",
    messageKey: "review_msg_german_quotes",
    range: { start, end },
    alternatives: [replacement],
    context: { start: Math.max(0, start - 40), end: end + 40 },
  };
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
        findings.push(finding(at, at + 1, CLOSE));
        open--;
      }
      continue;
    }
    if (mark === CLOSE) {
      if (open > 0 || !opening) {
        if (open > 0) open--;
        continue;
      }
      findings.push(finding(at, at + 1, OPEN));
      open++;
      continue;
    }
    if (mark === "”") {
      if (opening && open === 0) {
        findings.push(finding(at, at + 1, OPEN));
        open++;
      } else {
        findings.push(finding(at, at + 1, CLOSE));
        if (open > 0) open--;
      }
      continue;
    }
    // ",,so" and "''so''": doubled commas or apostrophes as quotes.
    if (opening && open === 0) {
      findings.push(finding(at, at + 2, OPEN));
      open++;
    } else if (mark === "''" && open > 0 && /[\p{L}\p{N}.!?)]$/u.test(ctx.text.slice(at - 1, at))) {
      findings.push(finding(at, at + 2, CLOSE));
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

function nested(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const [start, end] of lines(ctx)) {
    for (const [open, close, innerOpen, innerClose] of NESTING) {
      const stack: number[] = [];
      let inner: Array<[number, number]> = [];
      for (let i = start; i < end; i++) {
        const c = ctx.text[i];
        if (c === open) stack.push(i);
        else if (c === close && stack.length > 0) {
          const from = stack.pop()!;
          if (stack.length > 0) inner.push([from, i]);
          else {
            // Only once the outer quotation closes too: an unclosed one may be the slip.
            for (const [a, b] of inner) {
              if (a >= ctx.from && a < ctx.to) findings.push(finding(a, a + 1, innerOpen));
              if (b >= ctx.from && b < ctx.to) findings.push(finding(b, b + 1, innerClose));
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
    for (let i = start; i < end; i++) {
      // "ein 16"-Monitor": inches.
      if (ctx.text[i] === '"' && !/\p{N}/u.test(ctx.text[i - 1] ?? "")) marks.push(i);
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
          findings.push({ ...finding(at, at + 1, mark), ruleId: "germanStraightQuotes" });
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
    findings.push(finding(m.index, m.index + m[0].length, replacement));
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanQuotes"], detect: (ctx) => [...quotes(ctx), ...speech(ctx)] },
  { rules: ["germanStraightQuotes"], detect: straight },
];
