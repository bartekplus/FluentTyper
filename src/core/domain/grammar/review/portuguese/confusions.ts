import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { ReviewMessageKey } from "../types";

/**
 * The helpers of the `portuguese` frame style (engine/frameStyles.ts). The frames and their
 * code are in grammar/rules/pt_BR.yaml.
 */

export const CLAUSE_BEFORE = /(?:^|[.!?:;][ \t\r\n\u00a0"”»)]{0,8}|\n[ \t\u00a0]{0,8})$/;

/** A finding for the `target` group of `m`, in the typed casing; user-dictionary words stay. */
export function pushFinding(
  ctx: DetectContext,
  findings: RawFinding[],
  m: RegExpExecArray,
  alternatives: string[],
  messageKey: ReviewMessageKey,
  ruleId: RawFinding["ruleId"] = "portugueseConfusions",
): void {
  const [start, end] = m.indices!.groups!.target;
  const typed = ctx.text.slice(start, end);
  if (ctx.dictionary.has(typed.toLowerCase())) return;
  findings.push({
    ruleId,
    messageKey,
    range: { start, end },
    alternatives: alternatives.map((alt) => applyWordCase(alt, detectWordCase(typed))),
    context: { start: m.index, end: Math.max(end, m.index + m[0].length) },
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  });
}
