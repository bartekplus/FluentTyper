import { invalidIsoDates } from "../isoDates";
import type { MatchFixer } from "../../engine/reviewRules";
import { contextYear, daysInMonth, nearestDayOn, weekdayOf, yearsFor } from "../reviewClock";
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
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
// A word that puts a date after it: "em", "desde", "até", "dia", "data", "prazo", "vence", with
// an optional verb or colon ("A data é", "Prazo:").
const DATE_CUE =
  /(?:^|[\s(])(?:em|desde|até|dia|data|prazo|vence)(?:[ \t]+(?:é|era|foi|será))?[ \t]*:?[ \t]{1,8}$/iu;

function exists(day: number, month: number, year?: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(month, year);
}

function finding(range: { start: number; end: number }): RawFinding {
  return {
    ruleId: "portugueseDates",
    messageKey: "review_msg_pt_invalid_date",
    range,
    alternatives: [],
    warningOnly: true,
  };
}
const matchRange = (m: RegExpExecArray) => ({ start: m.index, end: m.index + m[0].length });

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
      ? yearsFor(month, Number(day), contextYear(ctx.text, m.index, ctx.lang))
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

const monthOf = (name: string) =>
  MONTHS.findIndex((month) => month.startsWith(name.toLowerCase())) + 1;

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  weekdayNamed: (m, ctx) => wrongWeekday(ctx, m, monthOf(m.groups!.month)),
  weekdayNumeric: (m, ctx) => wrongWeekday(ctx, m, Number(m.groups!.month)),
  weekdayNumericNoYear: (m, ctx) => {
    // Only a field above 12 says which one is the day: "Sexta, 31/10", "Sexta, 10/31".
    const [a, b] = [Number(m.groups!.a), Number(m.groups!.b)];
    if (a > 12 && b <= 12) return wrongWeekday(ctx, m, b, "a");
    if (b > 12 && a <= 12) return wrongWeekday(ctx, m, a, "b");
    return null;
  },
  namedDate: (m) => {
    const { day, month, year } = m.groups!;
    const index = MONTHS.findIndex((name) => name.startsWith(month.toLowerCase())) + 1;
    if (exists(Number(day), index, year === undefined ? undefined : Number(year))) return null;
    return finding(matchRange(m));
  },
  numericDate: (m, ctx) => {
    const { day, month, sep } = m.groups!;
    // "00/00/0000" and "99/99/9999" are placeholders, not dates. "32/04/2020" is a date.
    if (/^(?:0+|9+)$/.test(day + month) && day[0] === month[0]) return null;
    const year = m.groups!.year.length === 4 ? Number(m.groups!.year) : undefined;
    // "1.10.24" is a version number; a dotted date needs a four-digit year.
    if (sep === "." && year === undefined) return null;
    // "2.45.2020" is a version number too: no dotted date has a part above 31. After a date
    // cue ("A data é 32.04.2020", "em 32.04.2020") it is a date. A version word before it
    // ("versão 2.45.2020") keeps it technical before this check.
    if (
      sep === "." &&
      (Number(day) > 31 || Number(month) > 31) &&
      !DATE_CUE.test(ctx.text.slice(Math.max(0, m.index - 16), m.index))
    )
      return null;
    if (exists(Number(day), Number(month), year) || exists(Number(month), Number(day), year))
      return null;
    return finding(matchRange(m));
  },
} satisfies Record<string, MatchFixer>;

/** ISO dates that do not exist ("2023-02-29"): the shared scan of review/isoDates.ts. */
export function isoDates(ctx: DetectContext): RawFinding[] {
  return invalidIsoDates(ctx).map(finding);
}
