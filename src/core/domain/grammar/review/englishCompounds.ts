import type { DetectContext, RawFinding } from "./reviewDetectors";
/** Only curated grammatical slots; dictionary membership never determines compound boundaries. */
/** The findings filters of common.yaml (`filter:`). */
export const FILTERS = {
  contextualCompounds: (ctx: DetectContext, findings: RawFinding[]) => {
    const starts = new Set<number>();
    return findings.filter(({ range: { start, end } }) => {
      const typed = ctx.text.slice(start, end);
      if (typed !== typed.toLowerCase() || starts.has(start)) return false;
      starts.add(start);
      return true;
    });
  },
};
