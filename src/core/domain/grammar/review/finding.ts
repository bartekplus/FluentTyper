import type { RawFinding } from "./reviewDetectors";

/** The optional parts of a finding: its evidence context and flags. */
type FindingExtra = Omit<RawFinding, "ruleId" | "messageKey" | "range" | "alternatives">;

/** A finding that replaces [start, end) with each alternative. */
export function finding(
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
  start: number,
  end: number,
  alternatives: string[],
  extra?: FindingExtra,
): RawFinding {
  return { ruleId, messageKey, range: { start, end }, alternatives, ...extra };
}
