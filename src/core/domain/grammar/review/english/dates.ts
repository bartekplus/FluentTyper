import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

// Calendar checks: a weekday that does not fall on the date written next to it (this year's
// when no year is written), and a day the month does not have ("June 31", "2/30/2024").

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const S = SPACE;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Abbreviations, longest first; two-letter ones only with the comma after them ("Mo, 7").
const WEEKDAY_FORMS: readonly (readonly [string, number])[] = [
  ...WEEKDAYS.map((name, day) => [name, day] as const),
  ...["Sun", "Mon", "Tues", "Tue", "Wed", "Thurs", "Thur", "Thu", "Fri", "Sat"].map(
    (abbr) => [abbr, WEEKDAYS.findIndex((name) => name.startsWith(abbr.slice(0, 2)))] as const,
  ),
];
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December|(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)(?:\\.(?=[ \\t\\u00a0,]))?)";
// A full name takes no stop ("We met on Monday. 7 October was…" is two sentences).
const WEEKDAY = `(?<weekday>${WEEKDAYS.join("|")}|(?:${WEEKDAY_FORMS.slice(7)
  .map(([form]) => form)
  .join("|")})\\.?|(?:Mo|Tu|We|Th|Fr|Sa|Su)(?=,))`;
const YEAR = "(?:1[6-9]|2[0-9])[0-9]{2}";
const DAY = (name: string) => `(?<${name}>[0-9]{1,2})(?:st|nd|rd|th)?`;
const SEP = `(?:,?${S}|,)`;
// "Monday, 7th of October 2014", "Monday, October 7, 2014", "Monday, 31/10/2014",
// "Monday, 2014-10-31".
const WEEKDAY_DATE = new RegExp(
  `(?<![\\p{L}\\p{N}])${WEEKDAY}${SEP}(?:` +
    `${DAY("day1")}(?:${S}of)?${S}(?<month1>${MONTH})(?:,?${S}(?<year1>${YEAR}))?` +
    `|(?<month2>${MONTH})${S}${DAY("day2")}(?:,?${S}(?<year2>${YEAR}))?` +
    `|(?<a>[0-9]{1,2})(?<sep>[/.])(?<b>[0-9]{1,2})\\k<sep>(?<year3>${YEAR})` +
    `|(?<iso>(?<isoYear>[0-9]{4})-(?<isoMonth>[0-9]{2})-(?<isoDay>[0-9]{2})))(?![\\p{L}\\p{N}])`,
  "gdu",
);
// Days a month cannot have: "June 31", "the 31st of June", "Feb 30th, 2023".
const MONTH_DAY = `(?<target>(?<month1>${MONTH})${S}${DAY("day1")}|(?<![\\p{N}:.,/])${DAY("day2")}(?:${S}of)?${S}(?<month2>${MONTH}))(?:,?${S}(?<year>${YEAR}))?(?![\\p{L}\\p{N}]|[.,:][0-9])`;
const NUMERIC = `(?<![\\p{N}.,/-])(?<a>[0-9]{1,2})(?<sep>[/.])(?<b>[0-9]{1,2})\\k<sep>(?<year>${YEAR})(?![\\p{N}]|[.,][0-9])`;
/**
 * A date is prose, not a path or a dotted name, in any language: "2/30/2025",
 * "31.11.2025", "31/9/69", "31/سبتمبر/1969", Arabic-Indic digits.
 * Dotted forms need a four-digit year so versions ("1.12.31") stay technical.
 */
export const NUMERIC_DATE_TOKEN = new RegExp(
  "^(?:D{1,2}/(?:D{1,2}|\\p{L}{3,12})/(?:D{2}|D{4})|D{1,2}\\.D{1,2}\\.D{4})$".replace(
    /D/g,
    "[0-9\u0660-\u0669\u06f0-\u06f9]",
  ),
  "u",
);

const monthIndex = (name: string) =>
  MONTHS.findIndex((month) => month.startsWith(name.replace(".", "").toLowerCase().slice(0, 3)));
const daysIn = (month: number, year?: number) =>
  month === 1
    ? year === undefined || (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))
      ? 29
      : 28
    : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
const valid = (month: number, day: number, year?: number) =>
  month >= 0 && month < 12 && day >= 1 && day <= daysIn(month, year);
const weekdayOf = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day)).getUTCDay();
const ordinal = (day: number) =>
  day % 100 >= 11 && day % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
const group = (m: RegExpExecArray, name: string) => m.indices!.groups![name];
/** "Mo" -> 1: a two-letter weekday. */
const two = (form: string) => WEEKDAYS.findIndex((name) => name.startsWith(form));

/** The last year written in the paragraph before the date or in its sentence after it. */
function yearNear(ctx: DetectContext, start: number, end: number): number | undefined {
  const before = ctx.text
    .slice(Math.max(0, start - 400), start)
    .split(/\n\s*\n/)
    .at(-1)!;
  const after = /^[^.!?\n]*/.exec(ctx.text.slice(end, end + 200))![0];
  const years = [
    ...`${before} ${after}`.matchAll(/(?<![\p{L}\p{N}])((?:19|20)[0-9]{2})(?![\p{L}\p{N}])/gu),
  ];
  return years.length ? +years[years.length - 1][1] : undefined;
}

/** The nearest date to `day` in the same month that falls on `weekday`, or null. */
function nearestOn(year: number, month: number, day: number, weekday: number): number | null {
  const actual = weekdayOf(year, month, day);
  const back = (actual - weekday + 7) % 7;
  const ahead = (weekday - actual + 7) % 7;
  for (const candidate of back <= ahead ? [day - back, day + ahead] : [day + ahead, day - back])
    if (valid(month, candidate, year)) return candidate;
  return null;
}

function weekdayMismatch(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, WEEKDAY_DATE, "weekday")) {
    const g = m.groups!;
    const typedWeekday = g.weekday.replace(".", "");
    const named = WEEKDAY_FORMS.find(([form]) => form === typedWeekday)?.[1] ?? two(typedWeekday);
    let year: number;
    let month: number;
    let day: number;
    // The day and year fields a fix rewrites.
    let dayAt: string;
    let yearAt: string | undefined;
    if (g.iso) {
      [year, month, day, dayAt, yearAt] = [
        +g.isoYear,
        +g.isoMonth - 1,
        +g.isoDay,
        "isoDay",
        "isoYear",
      ];
    } else if (g.a) {
      [year, yearAt] = [+g.year3, "year3"];
      const [a, b] = [+g.a, +g.b];
      // Only a field above 12 says which one is the day; "03/04/2014" stays ambiguous.
      if (a > 12 && b <= 12) [month, day, dayAt] = [b - 1, a, "a"];
      else if (b > 12 && a <= 12) [month, day, dayAt] = [a - 1, b, "b"];
      else continue;
    } else {
      const typedYear = g.year1 ?? g.year2;
      // With no year the date is in the year the paragraph names ("…or Tuesday, March 19,
      // 2002"), else this year. This year's date that falls on the weekday last or next year
      // may mean that year ("Monday, 29 December" written in January).
      const nearYear = typedYear ? undefined : yearNear(ctx, m.index, m.index + m[0].length);
      year = typedYear ? +typedYear : (nearYear ?? new Date().getUTCFullYear());
      yearAt = typedYear ? (g.year1 ? "year1" : "year2") : undefined;
      month = monthIndex(g.month1 ?? g.month2);
      day = +(g.day1 ?? g.day2);
      dayAt = g.day1 ? "day1" : "day2";
      if (
        !typedYear &&
        !nearYear &&
        [year - 1, year + 1].some((y) => valid(month, day, y) && weekdayOf(y, month, day) === named)
      )
        continue;
    }
    if (!valid(month, day, year) || named < 0) continue;
    const actual = weekdayOf(year, month, day);
    if (actual === named) continue;
    const [start, weekdayEnd] = group(m, "weekday");
    const [dayStart, dayEnd] = group(m, dayAt);
    const suffix = /^(?:st|nd|rd|th)/.exec(ctx.text.slice(dayEnd, dayEnd + 2))?.[0] ?? "";
    const [yearStart, yearEnd] = yearAt ? group(m, yearAt) : [0, 0];
    const end = Math.max(dayEnd + suffix.length, yearEnd);
    /** The date with one field replaced. */
    const edit = (from: number, to: number, value: string) =>
      ctx.text.slice(start, from) + value + ctx.text.slice(to, end);
    // The weekday, the nearest day on the typed weekday, or the nearest year it fell on.
    const alternatives = [edit(start, weekdayEnd, WEEKDAYS[actual])];
    const near = nearestOn(year, month, day, named);
    if (near !== null)
      alternatives.push(
        edit(
          dayStart,
          dayEnd + suffix.length,
          String(near).padStart(dayEnd - dayStart, "0") + (suffix ? ordinal(near) : ""),
        ),
      );
    const other = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]
      .map((step) => year + step)
      .find((y) => valid(month, day, y) && weekdayOf(y, month, day) === named);
    if (other !== undefined && yearAt) alternatives.push(edit(yearStart, yearEnd, String(other)));
    findings.push({
      ruleId: "englishDateConsistency",
      messageKey: "review_msg_weekday_mismatch",
      range: { start, end },
      alternatives,
      requiresChoice: true,
      context: { start, end: m.index + m[0].length },
    });
  }
  return findings;
}

function impossibleDates(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const flag = (start: number, end: number) =>
    findings.push({
      ruleId: "englishDateConsistency",
      messageKey: "review_msg_impossible_date",
      range: { start, end },
      alternatives: [],
      warningOnly: true,
    });
  for (const m of frameMatches(ctx, MONTH_DAY)) {
    const g = m.groups!;
    const monthName = g.month1 ?? g.month2;
    // A lowercase name is a word ("march 40 miles"); "May 32" may still be the verb.
    if (!/^\p{Lu}/u.test(monthName) || (g.month1 && /^may$/i.test(monthName))) continue;
    const day = +(g.day1 ?? g.day2);
    const end = m.index + m[0].length;
    // "In March 37," and "38 Jan" (a size in a listing) are a year and a count, not a day;
    // "September 31 BC" counts years too.
    if (day > 31 && !/[0-9](?:st|nd|rd|th)/.test(m[0])) continue;
    if (/^[ \t\u00a0]*(?:AD|BC|BCE|CE|A\.D\.|B\.C\.)/.test(ctx.text.slice(end, end + 8))) continue;
    if (day < 1 || valid(monthIndex(monthName), day, g.year ? +g.year : undefined)) continue;
    flag(m.index, end);
  }
  for (const m of frameMatches(ctx, NUMERIC, (match) => match.index)) {
    const [a, b, year] = [+m.groups!.a, +m.groups!.b, +m.groups!.year];
    if (valid(a - 1, b, year) || valid(b - 1, a, year)) continue;
    flag(m.index, m.index + m[0].length);
  }
  return findings;
}
function detect(ctx: DetectContext): RawFinding[] {
  if (!ctx.lang.startsWith("en")) return [];
  return [...weekdayMismatch(ctx), ...impossibleDates(ctx)];
}

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishDateConsistency"], detect },
];
