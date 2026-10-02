import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

// Spanish typography quotes with angle marks first («así»), and with curly single marks inside
// them (‘así’). Typewriter pairs typed on one line get the typographic ones. Opt-in: straight
// quotes are common and accepted in informal text.

const RULE = "spanishQuotes" as const;

// A straight pair around a phrase on one line: opening after a space, a bracket or a dash and
// before a letter, closing after a letter, digit or sentence mark.
const DOUBLE =
  /(?<=^|[\s([{¿¡—–-])"(?=[\p{L}\p{N}¿¡])([^"\n]{1,200}?)(?<=[\p{L}\p{N}.!?…])"(?![\p{L}\p{N}])/gu;
const SINGLE =
  /(?<=^|[\s([{¿¡—–-])'(?=[\p{L}\p{N}¿¡])([^'\n]{1,200}?)(?<=[\p{L}\p{N}.!?…])'(?![\p{L}\p{N}])/gu;

function mark(start: number, replacement: string, pairEnd: number): RawFinding {
  return {
    ruleId: RULE,
    messageKey: "review_msg_spanish_quotes",
    range: { start, end: start + 1 },
    alternatives: [replacement],
    context: { start: Math.max(0, start - 1), end: pairEnd },
  };
}

function quotes(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const findings: RawFinding[] = [];
  for (const [regex, open, close] of [
    [DOUBLE, "«", "»"],
    [SINGLE, "‘", "’"],
  ] as const) {
    regex.lastIndex = Math.max(0, ctx.from - 256);
    for (let m = regex.exec(ctx.scanText); m; m = regex.exec(ctx.scanText)) {
      const start = m.index;
      const end = start + m[0].length;
      if (start < ctx.from) continue;
      if (start >= ctx.to) break;
      // Protected text, code and quoted examples keep their marks.
      if (ctx.text.slice(start, end).includes("\uFFFC") || namedExampleBefore(ctx.text, start))
        continue;
      findings.push(mark(start, open, end), mark(end - 1, close, end));
    }
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: quotes }];
