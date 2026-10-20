import { namedExampleBefore } from "../exampleCues";
import type { MatchFixer } from "../../engine/reviewRules";
import type { RawFinding } from "../reviewDetectors";
import { finding } from "../finding";

// Spanish typography quotes with angle marks first («así»), and with curly single marks inside
// them (‘así’). Typewriter pairs typed on one line get the typographic ones. Opt-in: straight
// quotes are common and accepted in informal text.

const RULE = "spanishQuotes" as const;

function mark(start: number, replacement: string, pairEnd: number): RawFinding {
  return finding(RULE, "review_msg_spanish_quotes", start, start + 1, [replacement], {
    context: { start: Math.max(0, start - 1), end: pairEnd },
  });
}

/** The straight pair of match `m` gets the marks `open` and `close`. */
const pair =
  (open: string, close: string): MatchFixer =>
  (m, ctx) => {
    const start = m.index;
    const end = start + m[0].length;
    if (start < ctx.from) return null;
    // Protected text, code and quoted examples keep their marks.
    if (ctx.text.slice(start, end).includes("￼") || namedExampleBefore(ctx.text, start))
      return null;
    return [mark(start, open, end), mark(end - 1, close, end)];
  };

/** The named frame fixes of grammar/rules/es.yaml (`fixer:`). */
export const FIXERS = {
  doubleQuotes: pair("«", "»"),
  singleQuotes: pair("‘", "’"),
} satisfies Record<string, MatchFixer>;
