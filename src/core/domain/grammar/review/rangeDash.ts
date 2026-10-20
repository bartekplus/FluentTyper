import { namedExampleBefore } from "./exampleCues";
import { finding } from "./finding";
import type { MatchFixer } from "../engine/reviewRules";

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

/**
 * "10-15" -> "10–15": an ascending range of numbers takes an en dash (emdashShortcut, opt-in).
 * The fixer of the range dash frames of grammar/rules/*.yaml (an owned scan 8 characters back,
 * groups 1 to 3: the numbers and the dash). Each language module gives its own guards.
 */
export const rangeDashFixer =
  (guards: RangeDashGuards): MatchFixer =>
  (m, ctx) => {
    const [whole, a, dash, b] = m;
    if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) return null;
    // A leading zero or a 3-4 pair is a phone number or an ID: "0034-600", "12-05", "915-5512".
    if (a[0] === "0" || b[0] === "0" || (a.length === 3 && b.length === 4)) return null;
    if (guards.codeShape?.(a, b)) return null;
    // A range runs up: "1990-95" and the season "2014-15" end in 1995 and 2015; "3-1" does not.
    const last = a.length === 4 && b.length === 2 ? Number(a.slice(0, 2) + b) : Number(b);
    if (last <= Number(a)) return null;
    const before = ctx.text.slice(Math.max(0, m.index - 48), m.index);
    const after = ctx.text.slice(m.index + whole.length, m.index + whole.length + 12);
    if (guards.code.test(before) || guards.score.test(before) || guards.scoreAfter?.test(after))
      return null;
    const at = m.index + a.length;
    return finding("emdashShortcut", "review_msg_range_dash", at, at + dash.length, ["–"], {
      context: { start: m.index, end: m.index + whole.length },
    });
  };
