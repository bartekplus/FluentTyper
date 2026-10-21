// The rule library (library.ts): the findings of another frame rule of the rule files, for a
// rule whose frames defer to it. Review sets the detector builder when it builds its English
// detectors (review/english/ruleDetectors.ts): an import of the engine here makes an import
// cycle.
import type { DetectContext, RawFinding } from "../../review/reviewDetectors";

type Detector = (ctx: DetectContext) => RawFinding[];

let build: ((id: string) => Detector) | undefined;
const detectors = new Map<string, Detector>();

/** Sets the builder of the frame rule detectors that `enFrameRuleFindings` runs. */
export function useEnFrameRules(builder: (id: string) => Detector): void {
  build = builder;
}

/** The findings of the frame rule `id` in the chunk of `ctx`; its detector is built once. */
export function enFrameRuleFindings(id: string, ctx: DetectContext): RawFinding[] {
  let detect = detectors.get(id);
  if (!detect) {
    if (!build) throw new Error("enFrameRuleFindings: Review did not set the frame rule builder");
    detectors.set(id, (detect = build(id)));
  }
  return detect(ctx);
}
