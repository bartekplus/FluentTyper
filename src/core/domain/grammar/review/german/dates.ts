import { invalidIsoDates } from "../isoDates";
import type { Detector, MatchFixer } from "../../engine/reviewRules";
import type { RawFinding } from "../reviewDetectors";
import { contextYear, daysInMonth, utcDate, weekdayOf, yearsFor } from "../reviewClock";

// German dates: an impossible day ("31. November", "29.2.2014"), a weekday that does not fit
// its date ("Sonntag, 23.08.2014" was a Saturday), a weekday before its date without the comma
// ("Samstag den 23. August"), and a day-month date without its closing dot ("am 13.12 um").
// A weekday before a date with no year is checked with the Review clock.

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const MONTHS: Readonly<Record<string, number>> = {
  januar: 1,
  jänner: 1,
  jan: 1,
  jän: 1,
  februar: 2,
  feb: 2,
  märz: 3,
  mär: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};
const SHORT_MONTHS = new Set([
  "jan",
  "jän",
  "feb",
  "mär",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "okt",
  "nov",
  "dez",
]);
// A preposition or article that a date takes: "am", "vom", "bis zum", "seit dem".
const DATE_PREPOSITION = /(?:^|[^\p{L}])(?:am|vom|zum|bis|ab|dem|den|seit)[ \t\u00a0]{1,8}$/iu;

type Parsed = { day: number; month: number; year?: number };
function parse(g: Record<string, string | undefined>): Parsed | null {
  if (g.isoYear) return { day: +g.isoDay!, month: +g.isoMonth!, year: +g.isoYear };
  const day = Number(g.day);
  const month = g.month ? Number(g.month) : MONTHS[g.name!.toLowerCase()];
  const year = g.year ?? g.year2;
  return { day, month, year: year ? Number(year) : undefined };
}
const valid = ({ day, month, year }: Parsed) =>
  month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, year);

function dateFinding(
  start: number,
  end: number,
  alternatives: string[],
  key: RawFinding["messageKey"],
) {
  return {
    ruleId: "germanDates" as const,
    messageKey: key,
    range: { start, end },
    alternatives,
    ...(alternatives.length === 0 ? { warningOnly: true as const } : {}),
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  };
}

/** The named frame fixes of the de.dates and de.dateDots rules (grammar/rules/de.yaml). */
export const FIXERS = {
  weekdayDate: (m, ctx) => {
    const findings: RawFinding[] = [];
    const g = m.groups!;
    const date = parse(g);
    const [start] = m.indices!.groups!.target;
    if (!date || !valid(date)) return null;
    const weekdayEnd = m.indices!.groups!.weekday[1];
    // "Samstag den 23. August": the date after a weekday is set off by a comma.
    if (!g.sep.startsWith(",")) {
      const weekdayStart = m.indices!.groups!.weekday[0];
      findings.push(
        dateFinding(
          weekdayStart,
          weekdayEnd,
          [`${g.weekday},`],
          "review_msg_german_date_punctuation",
        ),
      );
    }
    // A year before the Gregorian calendar ("4004 v. Chr."): nothing to compare.
    if (date.year !== undefined && date.year < 1583) return findings;
    if (/^[ \t ]*v\./.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 4)))
      return findings;
    // No year: the years the date can mean (reviewClock), nearest first.
    const years =
      date.year === undefined
        ? yearsFor(date.month, date.day, contextYear(ctx.text, start, ctx.lang))
        : [date.year];
    const weekdays = [...new Set(years.map((y) => weekdayOf(y, date.month, date.day)))];
    const typed = g.weekday.replace(/\.$/, "");
    const index =
      typed === "Sonnabend" ? 6 : Math.max(WEEKDAYS.indexOf(typed), SHORT.indexOf(typed));
    if (!years.length || weekdays.includes(index)) return findings;
    const actual = weekdays[0];
    // The weekday the date has, or the nearest date with the weekday typed.
    let shift = (index - actual + 7) % 7;
    if (shift > 3) shift -= 7;
    const moved = utcDate(years[0], date.month, date.day + shift);
    const typedDate = m.groups!.date;
    const dayText = g.isoYear ? moved.toISOString().slice(0, 10) : String(moved.getUTCDate());
    const dayStart = g.isoYear ? 0 : typedDate.indexOf(g.day);
    const dayEnd = g.isoYear ? typedDate.length : dayStart + g.day.length;
    const sep = g.sep.startsWith(",") ? g.sep : `,${g.sep}`;
    // Only the weekday and the day change: the range ends after the day.
    const end = m.indices!.groups!.date[0] + dayEnd;
    const head = typedDate.slice(0, dayStart);
    findings.push(
      dateFinding(
        start,
        end,
        [
          ...weekdays.map((w) => `${WEEKDAYS[w]}${sep}${head}${g.isoYear ? typedDate : g.day}`),
          `${g.weekday}${sep}${head}${dayText}`,
        ],
        date.year === undefined ? "review_msg_weekday_no_year" : "review_msg_german_weekday_date",
      ),
    );
    return findings;
  },
  // A date after a weekday has the same text and parse, so a valid one (the weekday frame's)
  // is never reported here.
  loneDate: (m, ctx) => {
    const g = m.groups!;
    const date = parse(g);
    // invalidIsoDates checks the ISO form ("2025-02-30") below.
    if (!date || g.isoYear || valid(date)) return null;
    // "1.0.", "0.5.": version numbers and decimals. A month past 12 only with a year
    // ("11.13.2014"), so "3.14." stays. With a four-digit year, a zero day or month is a wrong
    // date ("Am 0.5.2020"); a version word before it keeps it technical before this check.
    // A month name after a date preposition makes day 0 a wrong date with no year:
    // "am 0. April".
    const namedZero =
      g.name !== undefined &&
      date.day === 0 &&
      DATE_PREPOSITION.test(ctx.text.slice(Math.max(0, m.index - 12), m.index));
    if (
      date.year === undefined &&
      !namedZero &&
      (date.day === 0 || date.month === 0 || date.month > 12)
    ) {
      return null;
    }
    const [start, targetEnd] = m.indices!.groups!.target;
    // A stop after a full month name ends the sentence ("am 0. April."): the range ends at the
    // name. A stop after a short name is part of it ("am 0. Apr.").
    const end =
      g.name && !g.year2 && !SHORT_MONTHS.has(g.name.toLowerCase())
        ? m.indices!.groups!.name[1]
        : targetEnd;
    return dateFinding(start, end, [], "review_msg_german_invalid_date");
  },
  // A lowercase name is a date only with a four-digit year or after a date preposition.
  lowerDate: (m, ctx) => {
    const g = m.groups!;
    const date = parse(g);
    if (!date || valid(date)) return null;
    if (!g.year2 && !DATE_PREPOSITION.test(ctx.text.slice(Math.max(0, m.index - 12), m.index)))
      return null;
    const [start, end] = m.indices!.groups!.target;
    return dateFinding(start, end, [], "review_msg_german_invalid_date");
  },
  dateDot: (m) => {
    const day = Number(m.groups!.day);
    const month = Number(m.groups!.month);
    if (!valid({ day, month })) return null;
    const [start, end] = m.indices!.groups!.target;
    return dateFinding(start, end, [`${m.groups!.target}.`], "review_msg_german_date_punctuation");
  },
} satisfies Record<string, MatchFixer>;

export const PREDICATES = {
  isoDates: (ctx) =>
    invalidIsoDates(ctx).map(({ start, end }) =>
      dateFinding(start, end, [], "review_msg_german_invalid_date"),
    ),
} satisfies Record<string, Detector>;
