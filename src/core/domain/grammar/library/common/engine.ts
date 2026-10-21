// The rule library (library.ts): engine machinery that rule expressions call.
import type { DetectContext, RawFinding } from "../../review/reviewDetectors";

type Scan = (ctx: DetectContext) => RawFinding[];

// The phrase row scan reads the phrase tables of every language: Review sets it when it builds
// its detectors (review/reviewDetectors.ts). An import here would put the tables into each
// bundle that holds a typing rule (the content scripts).
let rows: Scan | undefined;

/** Sets the scan of `phraseRows`. */
export function usePhraseRows(scan: Scan): void {
  rows = scan;
}

/** The findings of the phrase rows of the rule files (`phrases:` tables) in the chunk. */
export function phraseRows(ctx: DetectContext): RawFinding[] {
  if (!rows) throw new Error("phraseRows: Review did not set the phrase row scan");
  return rows(ctx);
}
