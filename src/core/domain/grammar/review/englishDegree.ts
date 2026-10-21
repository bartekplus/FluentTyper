import { frameRuleDetector } from "../engine/reviewRules";
import type { DetectContext, RawFinding } from "./reviewDetectors";

// Built at the first call: the rule files import this module (an import cycle).
let rule: ((ctx: DetectContext) => RawFinding[]) | undefined;

/** The findings of the English doubledDegree frames ("this is more faster"). */
export const doubledDegree = (ctx: DetectContext): RawFinding[] =>
  (rule ??= frameRuleDetector("doubledDegree", {}))(ctx);
