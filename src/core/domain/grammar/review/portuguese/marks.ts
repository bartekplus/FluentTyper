import { finding } from "../finding";
import { frameMatches, isLang } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";

/**
 * Portuguese spacing around marks and units. commaPeriodSpacing: no space before a colon or
 * a semicolon ("possíveis :"), a space after an ellipsis glued to the next word
 * ("todos...exceto") and none before a closing one ("chegada …").
 * measurementUnitFormatting: a space between a number and a data or energy unit (5 kB).
 */

// After a lowercase word: a capitalized title ("History of the Caribbean : a study") may follow
// the library convention of a spaced colon.
const BEFORE_MARK = /(?<=(?<![\p{L}])\p{Ll}\p{L}*)(?<target>[  ]+[:;])(?=[ \t \n]|$)/dgu;
const GLUED_ELLIPSIS = /(?<=\p{L})(?<target>\.{3}|…)(?=\p{Ll}{2})/dgu;
// After a word of 4 letters or more: "e o …", "do …" mark an omission.
const SPACED_ELLIPSIS = /(?<=\p{L}{4})(?<target>[  ]+…)(?=[ \t ]*(?:\n|$|["”»)]))/dgu;
const DATA_UNIT =
  /(?<![\p{L}\p{N}.,])(?<target>(?<number>\d+(?:[.,]\d+)*)(?<unit>kB|KB|MB|GB|TB|kbps|Mbps|Gbps|MWh|GWh))(?![\p{L}\p{N}])/dgu;

export function markSpacing(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, BEFORE_MARK)) {
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding("commaPeriodSpacing", "review_msg_space_before_mark", start, end, [
        ctx.source[end - 1],
      ]),
    );
  }
  for (const m of frameMatches(ctx, GLUED_ELLIPSIS)) {
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding("commaPeriodSpacing", "review_msg_space_after_mark", start, end, [
        `${m.groups!.target} `,
      ]),
    );
  }
  for (const m of frameMatches(ctx, SPACED_ELLIPSIS)) {
    const [start, end] = m.indices!.groups!.target;
    // A line that opens with "…" quotes an excerpt: its closing "…" marks an omission too.
    const line = ctx.text.slice(ctx.text.lastIndexOf("\n", start) + 1, start);
    if (/^[ \t\u00a0]*(?:…|\.{3}|\[…\])/u.test(line)) continue;
    findings.push(finding("commaPeriodSpacing", "review_msg_space_before_mark", start, end, ["…"]));
  }
  return findings;
}

export function unitSpacing(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, DATA_UNIT)) {
    const [start, end] = m.indices!.groups!.target;
    if (ctx.dictionary.has(m.groups!.target.toLowerCase())) continue;
    findings.push(
      finding("measurementUnitFormatting", "review_msg_measurement_spacing", start, end, [
        `${m.groups!.number} ${m.groups!.unit}`,
      ]),
    );
  }
  return findings;
}
