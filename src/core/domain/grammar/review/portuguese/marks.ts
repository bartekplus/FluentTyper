import { finding } from "../finding";
import { resolveMeasurementLocale } from "../../measurement/registry";
import type { MatchFixer } from "../../engine/reviewRules";

/**
 * Portuguese spacing around marks and units. commaPeriodSpacing: no space before a colon or
 * a semicolon ("possíveis :"), a space after an ellipsis glued to the next word
 * ("todos...exceto") and none before a closing one ("chegada …").
 * measurementUnitFormatting: a space between a number and a data or energy unit (5 kB).
 * The frames are in grammar/rules/pt_BR.yaml.
 */

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  markBefore: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    return finding("commaPeriodSpacing", "review_msg_space_before_mark", start, end, [
      ctx.source[end - 1],
    ]);
  },
  markGlued: (m) => {
    const [start, end] = m.indices!.groups!.target;
    return finding("commaPeriodSpacing", "review_msg_space_after_mark", start, end, [
      `${m.groups!.target} `,
    ]);
  },
  markSpaced: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    // A line that opens with "…" quotes an excerpt: its closing "…" marks an omission too.
    const line = ctx.text.slice(ctx.text.lastIndexOf("\n", start) + 1, start);
    if (/^[ \t ]*(?:…|\.{3}|\[…\])/u.test(line)) return null;
    return finding("commaPeriodSpacing", "review_msg_space_before_mark", start, end, ["…"]);
  },
  dataUnit: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    if (ctx.dictionary.has(m.groups!.target.toLowerCase())) return null;
    // The shared measurement check's space (its locale registry): "5 kB" as "5 kWh".
    const separator = resolveMeasurementLocale(ctx.lang)?.separator ?? " ";
    return finding("measurementUnitFormatting", "review_msg_measurement_spacing", start, end, [
      `${m.groups!.number}${separator}${m.groups!.unit}`,
    ]);
  },
} satisfies Record<string, MatchFixer>;
