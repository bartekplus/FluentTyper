import type { DetectContext, RawFinding } from "./reviewDetectors";

/** Conventional meanings only; unknown metaphors and literal peak constructions abstain. */
/** The findings filters of common.yaml (`filter:`). */
export const FILTERS = {
  usagePhrases: (ctx: DetectContext, findings: RawFinding[]) =>
    findings.filter(
      (finding) =>
        // A capitalized "New" after a pronoun starts a name ("they New Yorkers").
        finding.alternatives[0] !== "Knew" &&
        !/\b(?:metaphor|poetic|creative|deliberate|deliberately|dialect|invented)\b/i.test(
          ctx.scanText.slice(finding.context!.start, finding.context!.end),
        ),
    ),
};
