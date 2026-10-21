import { namedExampleBefore } from "../exampleCues";
import type { MatchFixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { ReviewMessageKey } from "../types";

// The glued and spaced units are the measurement.de and currency.de frames of
// grammar/rules/common.yaml. The German number rules are code in grammar/rules/de.yaml.
const BYTES = /^(?:[kKMGT]B|[KMGT]iB)$/;

/** A finding of a German unit frame: the match, outside a named example. */
function unitFinding(
  ctx: DetectContext,
  m: RegExpExecArray,
  alternatives: string[],
  key: ReviewMessageKey,
): RawFinding | null {
  if (m.index < ctx.from || m.index >= ctx.to || namedExampleBefore(ctx.text, m.index)) return null;
  const end = m.index + m[0].length;
  return {
    ruleId: key === "review_msg_currency_spacing" ? "currencySpacing" : "measurementUnitFormatting",
    messageKey: key,
    range: { start: m.index, end },
    alternatives,
    requiresChoice: alternatives.length > 1 || undefined,
    context: { start: Math.max(0, m.index - 30), end: end + 30 },
  };
}

// "75.000$" → "75.000 $", "5kB" → "5 kB". The frame's check picks the currency or the bytes.
const gluedUnit: MatchFixer = (m, ctx, frame) => {
  const { n, unit } = m.groups!;
  const line = ctx.text.slice(ctx.text.lastIndexOf("\n", m.index) + 1, m.index + 200);
  // "$x = 5$": math or a shell line.
  if (unit === "$" && line.split("$").length > 2) return null;
  const currency = unit === "$" || unit === "£";
  if (!currency && !BYTES.test(unit)) return null;
  if ((currency ? "currencySpacing" : "measurementUnitFormatting") !== frame.ruleId) return null;
  return unitFinding(
    ctx,
    m,
    [`${n} ${unit}`],
    currency ? "review_msg_currency_spacing" : "review_msg_measurement_spacing",
  );
};

// "25 °" → "25°" (an angle) or "25 °C" (a temperature).
const spacedDegree: MatchFixer = (m, ctx) => {
  const { n } = m.groups!;
  return unitFinding(ctx, m, [`${n}°`, `${n} °C`], "review_msg_measurement_spacing");
};

/** The fixes of the measurement.de and currency.de rules of grammar/rules/common.yaml. */
export const FIXERS = {
  gluedUnit,
  spacedDegree,
} satisfies Record<string, MatchFixer>;
