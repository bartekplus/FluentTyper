import { frameMatches, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { contextYear, weekdayOf, yearsFor } from "../reviewClock";
import { isGerman } from "./shared";

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
const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .map((m) => `${m[0].toUpperCase()}${m.slice(1)}`)
  .join("|");
const WEEKDAY = `(?<weekday>${WEEKDAYS.join("|")}|Sonnabend|(?:${SHORT.join("|")})\\.?)`;
// "23.08.2014", "23.8.", "23. August 2014", "23. Aug. 2014", "2015-09-28".
const DATE =
  `(?:(?<day>\\d{1,3})\\.(?:(?<month>\\d{1,2})\\.(?<year>\\d{4})?|[ \\t\\u00a0]?(?<name>${MONTH_NAMES})\\.?(?:[ \\t\\u00a0](?<year2>\\d{4}))?)` +
  `|(?<isoYear>\\d{4})-(?<isoMonth>\\d{2})-(?<isoDay>\\d{2}))(?!\\d)`;
const WEEKDAY_DATE = new RegExp(
  `${WORD_START}(?<target>${WEEKDAY}(?<sep>,?[ \\t\\u00a0]+(?:(?:den|der|dem)[ \\t\\u00a0]+)?)(?<date>${DATE}))`,
  "gdu",
);
const LONE_DATE = new RegExp(`(?<![\\d.])(?<target>${DATE})`, "gdu");
const NO_DOT = new RegExp(
  `(?<=(?:^|[^\\p{L}])(?:am|vom|zum|bis|dem|den|seit)[ \\t\\u00a0]{1,8})(?<target>(?<day>\\d{1,2})\\.(?<month>\\d{1,2}))(?=[ \\t\\u00a0]+[^\\d\\s.]|[ \\t\\u00a0]*[,)]|$)`,
  "gdu",
);

const daysIn = (month: number, year?: number) =>
  month === 2
    ? year === undefined || (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

type Parsed = { day: number; month: number; year?: number };
function parse(g: Record<string, string | undefined>): Parsed | null {
  if (g.isoYear) return { day: +g.isoDay!, month: +g.isoMonth!, year: +g.isoYear };
  const day = Number(g.day);
  const month = g.month ? Number(g.month) : MONTHS[g.name!.toLowerCase()];
  const year = g.year ?? g.year2;
  return { day, month, year: year ? Number(year) : undefined };
}
const valid = ({ day, month, year }: Parsed) =>
  month >= 1 && month <= 12 && day >= 1 && day <= daysIn(month, year);

function finding(
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

function dates(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  const claimed: number[] = [];
  for (const m of frameMatches(ctx, WEEKDAY_DATE)) {
    const g = m.groups!;
    const date = parse(g);
    const [start] = m.indices!.groups!.target;
    if (!date || !valid(date)) continue;
    claimed.push(m.indices!.groups!.date[0]);
    const weekdayEnd = m.indices!.groups!.weekday[1];
    // "Samstag den 23. August": the date after a weekday is set off by a comma.
    if (!g.sep.startsWith(",")) {
      const weekdayStart = m.indices!.groups!.weekday[0];
      findings.push(
        finding(weekdayStart, weekdayEnd, [`${g.weekday},`], "review_msg_german_date_punctuation"),
      );
    }
    // A year before the Gregorian calendar ("4004 v. Chr."): nothing to compare.
    if (date.year !== undefined && date.year < 1583) continue;
    if (/^[ \t\u00a0]*v\./.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 4)))
      continue;
    // No year: the years the date can mean (reviewClock), nearest first.
    const years =
      date.year === undefined
        ? yearsFor(date.month, date.day, contextYear(ctx.text, start))
        : [date.year];
    const weekdays = [...new Set(years.map((y) => weekdayOf(y, date.month, date.day)))];
    const typed = g.weekday.replace(/\.$/, "");
    const index =
      typed === "Sonnabend" ? 6 : Math.max(WEEKDAYS.indexOf(typed), SHORT.indexOf(typed));
    if (!years.length || weekdays.includes(index)) continue;
    const actual = weekdays[0];
    // The weekday the date has, or the nearest date with the weekday typed.
    let shift = (index - actual + 7) % 7;
    if (shift > 3) shift -= 7;
    const moved = new Date(Date.UTC(years[0], date.month - 1, date.day + shift));
    const typedDate = m.groups!.date;
    const dayText = g.isoYear ? moved.toISOString().slice(0, 10) : String(moved.getUTCDate());
    const dayStart = g.isoYear ? 0 : typedDate.indexOf(g.day);
    const dayEnd = g.isoYear ? typedDate.length : dayStart + g.day.length;
    const sep = g.sep.startsWith(",") ? g.sep : `,${g.sep}`;
    // Only the weekday and the day change: the range ends after the day.
    const end = m.indices!.groups!.date[0] + dayEnd;
    const head = typedDate.slice(0, dayStart);
    findings.push(
      finding(
        start,
        end,
        [
          ...weekdays.map((w) => `${WEEKDAYS[w]}${sep}${head}${g.isoYear ? typedDate : g.day}`),
          `${g.weekday}${sep}${head}${dayText}`,
        ],
        date.year === undefined ? "review_msg_weekday_no_year" : "review_msg_german_weekday_date",
      ),
    );
  }
  for (const m of frameMatches(ctx, LONE_DATE)) {
    const g = m.groups!;
    const date = parse(g);
    if (!date || valid(date) || claimed.includes(m.index)) continue;
    // "1.0.", "0.5.": version numbers and decimals. A month past 12 only with a year
    // ("11.13.2014"), so "3.14." stays.
    if (date.day === 0 || date.month === 0 || (date.month > 12 && date.year === undefined)) {
      continue;
    }
    const [start, end] = m.indices!.groups!.target;
    findings.push(finding(start, end, [], "review_msg_german_invalid_date"));
  }
  for (const m of frameMatches(ctx, NO_DOT)) {
    const day = Number(m.groups!.day);
    const month = Number(m.groups!.month);
    if (!valid({ day, month })) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding(start, end, [`${m.groups!.target}.`], "review_msg_german_date_punctuation"),
    );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanDates"], detect: dates },
];
