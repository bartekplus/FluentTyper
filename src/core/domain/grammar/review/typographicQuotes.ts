import { resolveTypographyProfile } from "../typographyProfiles";
import { ELIDED_QUOTE_START } from "./quotationWarnings";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "./reviewDetectors";
import { finding } from "./finding";

// Straight quotes and apostrophes become the typographic marks of the text language, from the
// same profiles as the typing rule (smartQuoteNormalization): "so" → “so” (en), „so“ (de),
// « so » (fr); 'so' and a quote inside a quote take the nested pair; it's → it’s. Each line
// must pair cleanly: an unbalanced or ambiguous mark leaves the line's quotes as they are.

const RULE = "typographicQuotes" as const;
const APOSTROPHE = "’";
const MASK = "￼";
const LETTER = /\p{L}/u;
const DIGIT = /\p{N}/u;
const SPACE = /\s/u;
// A mark opens after these and closes before these.
const OPEN_AFTER = /[\s([{<\-–—/„“‚‘«»‹›¿¡]/u;
const CLOSE_BEFORE = /[\s.,;:!?…)\]}>\-–—/"'“”„«»‹›‘’]/u;

type Open = { at: number; kind: "double" | "single" | "typographic"; nested: boolean };

function quoteFinding(at: number, replacement: string, context: [number, number]): RawFinding {
  return finding(RULE, "review_msg_typographic_quotes", at, at + 1, [replacement], {
    context: { start: context[0], end: context[1] + 1 },
  });
}

/** The lines that overlap the chunk, as [start, end) offsets. */
function* lines(ctx: DetectContext): Generator<[number, number]> {
  let start = ctx.text.lastIndexOf("\n", ctx.from - 1) + 1;
  while (start < ctx.to) {
    const newline = ctx.text.indexOf("\n", start);
    const end = newline < 0 ? ctx.text.length : newline;
    yield [start, end];
    start = end + 1;
  }
}

function quotes(ctx: DetectContext): RawFinding[] {
  const lang = ctx.lang.slice(0, 2);
  const profile = resolveTypographyProfile(ctx.lang);
  const [open, close] = profile.double;
  const [innerOpen, innerClose] = profile.single;
  const pad = profile.quoteSpace;
  // Swedish ”…” opens and closes with one mark: it pairs by position, like a straight one.
  const symmetric = open === close;
  // Spanish «…» is spanishQuotes' advice; this rule then fixes apostrophes only.
  const pairs = !(lang === "es" && (ctx.rules?.has("spanishQuotes") ?? true));
  const text = ctx.text;
  const findings: RawFinding[] = [];
  const keep = (at: number, replacement: string, context: [number, number]) => {
    if (at >= ctx.from && at < ctx.to) findings.push(quoteFinding(at, replacement, context));
  };

  for (const [start, end] of lines(ctx)) {
    const stack: Open[] = [];
    const edits: Array<[number, string, [number, number]]> = [];
    let clean = pairs;
    const depth = () => stack.filter((o) => o.kind !== "single").length;
    const pair = (from: Open, to: number, openMark: string, closeMark: string) => {
      // Code and other protected text keeps its marks.
      if (text.slice(from.at, to).includes(MASK)) return;
      // A typographic opener changes only when it moves to the inner pair.
      if (from.kind !== "typographic" || openMark === innerOpen)
        if (openMark !== text[from.at]) edits.push([from.at, openMark, [from.at, to]]);
      if (closeMark !== text[to]) edits.push([to, closeMark, [from.at, to]]);
    };
    // Unpaired single marks left on top were elisions ('ne, '90s): drop them.
    const closeDouble = () => {
      while (stack.at(-1)?.kind === "single") stack.pop();
      return stack.pop();
    };

    for (let i = start; i < end; i++) {
      const mark = text[i];
      if (mark !== '"' && mark !== "'" && mark !== open && mark !== close) continue;
      const prev = i > start ? text[i - 1] : "";
      const next = i + 1 < end ? text[i + 1] : "";
      if (prev === MASK || next === MASK) continue;
      // "it's", "aujourd'hui", "Rock'n'Roll".
      if (mark === "'" && LETTER.test(prev) && LETTER.test(next)) {
        edits.push([i, APOSTROPHE, [i, i]]);
        continue;
      }
      // Deeper nesting than real prose has: leave the line alone.
      if (!clean || stack.length > 16) {
        clean = false;
        continue;
      }
      const opens = (prev === "" || OPEN_AFTER.test(prev)) && next !== "" && !SPACE.test(next);
      const closes = prev !== "" && !SPACE.test(prev) && (next === "" || CLOSE_BEFORE.test(next));
      const nested = depth() > 0;

      if (mark === "'") {
        if (opens && lang === "en" && ELIDED_QUOTE_START.test(text.slice(i + 1, i + 8))) {
          edits.push([i, APOSTROPHE, [i, i]]); // 'tis, '90s
        } else if (opens && !closes) {
          // An earlier single mark that nothing closed was an elision ('ne Wurst).
          if (stack.at(-1)?.kind === "single") stack.pop();
          stack.push({ at: i, kind: "single", nested });
        } else if (closes && !opens && stack.at(-1)?.kind === "single") {
          pair(stack.pop()!, i, innerOpen, innerClose);
        } else if (DIGIT.test(prev) || DIGIT.test(next)) {
          // 5'10, 54°14.03'N: feet and minutes.
        } else if (closes && LETTER.test(prev) && !stack.some((o) => o.kind === "single")) {
          // geh', Felix', the dogs': an apostrophe that ends a word. Greek ' after a letter
          // is often the numeral sign (Β' = 2nd).
          if (lang !== "el") edits.push([i, APOSTROPHE, [i, i]]);
        } else clean = false;
        continue;
      }

      const typographic = mark !== '"';
      if (typographic && !symmetric) {
        // The profile's own marks keep count of nesting; a nested pair becomes the inner one.
        if (mark === open) stack.push({ at: i, kind: "typographic", nested });
        else {
          const from = depth() > 0 ? closeDouble()! : undefined;
          if (!from) clean = false;
          else if (from.nested) {
            if (!pad) pair(from, i, innerOpen, innerClose);
          } else pair(from, i, open + pad, close);
        }
      } else if (opens && !closes) {
        stack.push({ at: i, kind: typographic ? "typographic" : "double", nested });
      } else if (closes && !opens && depth() > 0) {
        const from = closeDouble()!;
        if (from.nested) pair(from, i, innerOpen, innerClose);
        else pair(from, i, open + pad, pad + close);
      } else if (!opens && DIGIT.test(prev)) {
        // 31", 5'10": inches.
      } else clean = false;
    }
    if (stack.some((o) => o.kind !== "single")) clean = false;
    for (const [at, replacement, context] of edits)
      // An apostrophe inside or before a word does not depend on the pairs.
      if (clean || (context[0] === context[1] && LETTER.test(text[at + 1] ?? "")))
        keep(at, replacement, context);
  }
  return findings;
}

export const TYPOGRAPHIC_QUOTES: ReviewDetectorEntry = { rules: [RULE], detect: quotes };
