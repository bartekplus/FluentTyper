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
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanQuotes"], detect: quotes },
];
