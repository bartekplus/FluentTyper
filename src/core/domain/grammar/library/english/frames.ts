// The rule library (library/english.ts): the types of the English frame fixes.
import type { DetectContext, RawFinding } from "../../review/reviewDetectors";

/** The check and the message of a finding. */
export type Rule = Pick<RawFinding, "ruleId" | "messageKey">;

/** Replacements for the `target` group (or `range`); `raw` keeps their casing as given. */
export type Fix = {
  alternatives: readonly string[];
  range?: readonly [number, number];
  raw?: true;
};
export type FixResult = string | readonly string[] | Fix | null;
export type Frame = {
  rule: Rule;
  /** The frame runs only when one of these words occurs near the chunk. */
  cue?: readonly string[];
  pattern: string | RegExp;
  fix: string | readonly string[] | ((m: RegExpExecArray, ctx: DetectContext) => FixResult);
};
