import { namedExampleBefore } from "./exampleCues";
import { finding } from "./finding";
import type { DetectContext, RawFinding } from "./reviewDetectors";

/** What makes a pair of numbers a code or a score in one language, not a range. */
export interface RangeDashGuards {
  /** The text before the pair ends in a label of a code: a phone, an ID, a reference, a law. */
  code: RegExp;
  /** The text before the pair ends in words of a result: "won 3-1". */
  score: RegExp;
  /** The text after the pair starts with words of a result: "2-3 dla gości". */
  scoreAfter?: RegExp;
  /** A pair shape that is a code in this language: "31-123" is a Polish postal code. */
  codeShape?: (a: string, b: string) => boolean;
}

// "pages 10-15", "1990-1995": two numbers of up to four digits joined by a hyphen. A dash, a
// colon, a slash or a digit group after the second number makes a date, a phone number or a
// code ("12-05-2020", "2024-05-01"); a decimal or a time ("8.00-9.00") stays.
const NUMBER_PAIR =
  /(?<![\p{L}\p{N}.,:/#+–—-])(\d{1,4})([-—])(\d{1,4})(?![\p{L}\p{N}_]|[-–—/:.,]\p{N})/gu;

/**
 * "10-15" -> "10–15": an ascending range of numbers takes an en dash (emdashShortcut, opt-in).
 * Shared by the language modules; each gives its own guards.
 */
export function rangeDashes(ctx: DetectContext, guards: RangeDashGuards): RawFinding[] {
  const findings: RawFinding[] = [];
  const regex = new RegExp(NUMBER_PAIR);
  regex.lastIndex = Math.max(0, ctx.from - 8);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    const [whole, a, dash, b] = m;
    if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) continue;
    // A leading zero or a 3-4 pair is a phone number or an ID: "0034-600", "12-05", "915-5512".
    if (a[0] === "0" || b[0] === "0" || (a.length === 3 && b.length === 4)) continue;
    if (guards.codeShape?.(a, b)) continue;
    // A range runs up: "1990-95" and the season "2014-15" end in 1995 and 2015; "3-1" does not.
    const last = a.length === 4 && b.length === 2 ? Number(a.slice(0, 2) + b) : Number(b);
    if (last <= Number(a)) continue;
    const before = ctx.text.slice(Math.max(0, m.index - 48), m.index);
    const after = ctx.text.slice(m.index + whole.length, m.index + whole.length + 12);
    if (guards.code.test(before) || guards.score.test(before) || guards.scoreAfter?.test(after))
      continue;
    const at = m.index + a.length;
    findings.push(
      finding("emdashShortcut", "review_msg_range_dash", at, at + dash.length, ["–"], {
        context: { start: m.index, end: m.index + whole.length },
      }),
    );
  }
  return findings;
}
