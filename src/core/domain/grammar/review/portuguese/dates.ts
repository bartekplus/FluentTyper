import { frameMatches } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";

/**
 * Dates that do not exist: "31 de abril", "30/02/2020", "29 de fevereiro de 2023". Nothing
 * is proposed (the writer knows which day was meant); the finding only points at the date.
 * An all-number date is flagged only when neither day/month nor month/day reading exists,
 * so a US-style "12/25/2020" stays.
 */

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const MONTH_NAME = `(?<month>${MONTHS.join("|")}|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)`;
const SEP = "[ \\t\\u00a0]{1,4}";
const NAMED = `(?<target>(?<day>\\d{1,2})[º°]?(?:${SEP}de${SEP}|${SEP}|[/-])${MONTH_NAME}(?![\\p{L}])(?:\\.?(?:,?${SEP}(?:de${SEP})?|[/-])(?<year>\\d{4})(?!\\d))?)`;
const NUMERIC = `(?<target>(?<day>\\d{1,2})(?<sep>[/.-])(?<month>\\d{1,2})\\k<sep>(?<year>\\d{4}|\\d{2}))(?![\\d/.-]\\d)`;

const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
function exists(day: number, month: number, year?: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const length =
    month === 2
      ? year === undefined || leap(year)
        ? 29
        : 28
      : [4, 6, 9, 11].includes(month)
        ? 30
        : 31;
  return day <= length;
}

function finding(m: RegExpExecArray): RawFinding {
  return {
    ruleId: "portugueseDates",
    messageKey: "review_msg_pt_invalid_date",
    range: { start: m.index, end: m.index + m[0].length },
    alternatives: [],
    warningOnly: true,
  };
}

export function invalidDates(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, NAMED)) {
    const { day, month, year } = m.groups!;
    const index = MONTHS.findIndex((name) => name.startsWith(month.toLowerCase())) + 1;
    if (!exists(Number(day), index, year === undefined ? undefined : Number(year))) {
      findings.push(finding(m));
    }
  }
  for (const m of frameMatches(ctx, NUMERIC)) {
    const { day, month, sep } = m.groups!;
    // "00/00/0000" and "99/99/9999" are placeholders, not dates.
    if (/^0+$/.test(day) || /^0+$/.test(month) || Number(day) > 31 || Number(month) > 31) continue;
    const year = m.groups!.year.length === 4 ? Number(m.groups!.year) : undefined;
    // "1.10.24" is a version number; a dotted date needs a four-digit year.
    if (sep === "." && year === undefined) continue;
    if (!exists(Number(day), Number(month), year) && !exists(Number(month), Number(day), year)) {
      findings.push(finding(m));
    }
  }
  return findings;
}
