import { frameMatches } from "../phraseTemplates";
import {
  contextYear,
  daysInMonth,
  nearestDayOn,
  weekdayOf,
  YEAR_DIGITS,
  yearsFor,
} from "../reviewClock";
import type { DetectContext, RawFinding } from "../reviewDetectors";

/**
 * Dates that do not exist: "31 de abril", "30/02/2020", "29 de fevereiro de 2023". Nothing
 * is proposed (the writer knows which day was meant); the finding only points at the date.
 * An all-number date is flagged only when neither day/month nor month/day reading exists,
 * so a US-style "12/25/2020" stays.
 * A weekday before a full date must be that date's weekday ("Segunda-feira, 7 de outubro
 * de 2014" -> "Terça-feira"); the other choice moves the day to the nearest such weekday.
 */

export const MONTHS = [
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
const NAMED = `(?<target>(?<day>\\d{1,2})[º°]?(?:${SEP}de${SEP}|${SEP}|[/-])${MONTH_NAME}(?![\\p{L}])(?:\\.?(?:,?${SEP}(?:de${SEP})?|[/-])(?<year>${YEAR_DIGITS})(?!\\d))?)`;
const NUMERIC = `(?<target>(?<day>\\d{1,2})(?<sep>[/.-])(?<month>\\d{1,2})\\k<sep>(?<year>${YEAR_DIGITS}|\\d{2}))(?![\\d/.-]\\d)`;

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const WEEKDAY = `(?<weekday>(?:segunda|terça|quarta|quinta|sexta)(?:-feira)?|sábado|domingo|seg|ter|qua|qui|sex|sáb|dom)\\.?(?:,?${SEP}|${SEP}\\()(?:dia${SEP})?`;
const WEEKDAY_NAMED = `${WEEKDAY}(?<day>\\d{1,2})(?=[º°]?(?:${SEP}de${SEP}|${SEP})${MONTH_NAME}(?![\\p{L}])\\.?,?${SEP}(?:de${SEP})?(?<year>${YEAR_DIGITS})(?!\\d))`;
const WEEKDAY_NUMERIC = `${WEEKDAY}(?<day>\\d{1,2})(?=/(?<month>\\d{1,2})/(?<year>${YEAR_DIGITS})(?![\\d/]))`;
// No year ("Segunda, 7 de outubro", "Seg, outubro 7", "Sexta, 31/10"): the Review clock gives it.
const WEEKDAY_NAMED_NO_YEAR = `${WEEKDAY}(?<day>\\d{1,2})(?=[º°]?(?:${SEP}de${SEP}|${SEP})${MONTH_NAME}(?![\\p{L}])(?!\\.?,?${SEP}(?:de${SEP})?\\d))`;
const WEEKDAY_MONTH_DAY = `${WEEKDAY}${MONTH_NAME}\\.?${SEP}(?<day>\\d{1,2})(?![\\d/º°]|,?${SEP}(?:de${SEP})?\\d)`;
const WEEKDAY_NUMERIC_NO_YEAR = `${WEEKDAY}(?<a>\\d{1,2})/(?<b>\\d{1,2})(?![\\d/]|[.,]\\d)`;

function exists(day: number, month: number, year?: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(month, year);
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

/**
 * "Segunda-feira, 7" before a date that fell on a Tuesday: the weekday or the day is wrong.
 * `dayGroup` names the day in the match. With no year, the weekday is checked against each
 * year the date can mean (reviewClock).
 */
function wrongWeekday(
  ctx: DetectContext,
  m: RegExpExecArray,
  month: number,
  dayGroup = "day",
): RawFinding | null {
  const { weekday, year } = m.groups!;
  const day = m.groups![dayGroup];
  if (!exists(Number(day), month, year === undefined ? undefined : Number(year))) return null;
  const years =
    year === undefined
      ? yearsFor(month, Number(day), contextYear(ctx.text, m.index))
      : [Number(year)];
  const weekdays = [...new Set(years.map((y) => weekdayOf(y, month, Number(day))))];
  const typed = WEEKDAYS.findIndex((name) => name.startsWith(weekday.toLowerCase().slice(0, 3)));
  if (!years.length || weekdays.includes(typed)) return null;
  const text = m[0];
  const alternatives = weekdays.map((actual) => {
    const full = WEEKDAYS[actual] + (actual % 6 === 0 ? "" : "-feira");
    const cased = /^\p{Lu}/u.test(weekday) ? full[0].toUpperCase() + full.slice(1) : full;
    return `${cased}${text.slice(weekday.length)}`;
  });
  // The nearest date with the typed weekday, when it falls in the same month.
  const shifted = nearestDayOn(years[0], month, Number(day), typed);
  const [dayStart, dayEnd] = m.indices!.groups![dayGroup].map((at) => at - m.index);
  if (shifted !== null)
    alternatives.push(`${text.slice(0, dayStart)}${shifted}${text.slice(dayEnd)}`);
  return {
    ruleId: "portugueseDates",
    messageKey: year === undefined ? "review_msg_weekday_no_year" : "review_msg_pt_weekday_date",
    range: { start: m.index, end: m.index + text.length },
    alternatives,
    requiresChoice: true,
  };
}

export function invalidDates(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  const monthOf = (name: string) =>
    MONTHS.findIndex((month) => month.startsWith(name.toLowerCase())) + 1;
  const found: (RawFinding | null)[] = [];
  for (const pattern of [WEEKDAY_NAMED, WEEKDAY_NAMED_NO_YEAR, WEEKDAY_MONTH_DAY])
    for (const m of frameMatches(ctx, pattern, "weekday"))
      found.push(wrongWeekday(ctx, m, monthOf(m.groups!.month)));
  for (const m of frameMatches(ctx, WEEKDAY_NUMERIC, "weekday"))
    found.push(wrongWeekday(ctx, m, Number(m.groups!.month)));
  for (const m of frameMatches(ctx, WEEKDAY_NUMERIC_NO_YEAR, "weekday")) {
    // Only a field above 12 says which one is the day: "Sexta, 31/10", "Sexta, 10/31".
    const [a, b] = [Number(m.groups!.a), Number(m.groups!.b)];
    if (a > 12 && b <= 12) found.push(wrongWeekday(ctx, m, b, "a"));
    else if (b > 12 && a <= 12) found.push(wrongWeekday(ctx, m, a, "b"));
  }
  for (const f of found) if (f) findings.push(f);
  for (const m of frameMatches(ctx, NAMED)) {
    const { day, month, year } = m.groups!;
    const index = MONTHS.findIndex((name) => name.startsWith(month.toLowerCase())) + 1;
    if (!exists(Number(day), index, year === undefined ? undefined : Number(year))) {
      findings.push(finding(m));
    }
  }
  for (const m of frameMatches(ctx, NUMERIC)) {
    const { day, month, sep } = m.groups!;
    // "00/00/0000" and "99/99/9999" are placeholders, not dates. "32/04/2020" is a date.
    if (/^(?:0+|9+)$/.test(day + month) && day[0] === month[0]) continue;
    const year = m.groups!.year.length === 4 ? Number(m.groups!.year) : undefined;
    // "1.10.24" is a version number; a dotted date needs a four-digit year.
    if (sep === "." && year === undefined) continue;
    // "2.45.2020" is a version number too: no dotted date has a part above 31.
    if (sep === "." && (Number(day) > 31 || Number(month) > 31)) continue;
    if (!exists(Number(day), Number(month), year) && !exists(Number(month), Number(day), year)) {
      findings.push(finding(m));
    }
  }
  return findings;
}
