import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, group, isLang, SPACE as S } from "../phraseTemplates";
import { DIGIT, invalidIsoDates } from "../isoDates";
import { NO_WORD_BEFORE } from "../markdownEmphasis";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  contextYear,
  daysInMonth,
  nearestDayOn,
  weekdayOf as clockWeekday,
  weekdaysFor,
  yearsFor,
  YEAR_DIGITS,
} from "../reviewClock";
import { finding } from "../finding";

// Calendar checks: a weekday that does not fall on the date written next to it, and a day the
// month does not have ("June 31", "2/30/2024"). A date with no year uses the Review clock.

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

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
const DAY = (name: string) => `(?<${name}>[0-9]{1,2})(?:st|nd|rd|th)?`;
const SEP = `(?:,?${S}|,)`;
// "Monday, 7th of October 2014", "Monday, October 7, 2014", "Monday, 31/10/2014",
// "Monday, 2014-10-31".
const WEEKDAY_DATE = new RegExp(
  `(?<![\\p{L}\\p{N}])${WEEKDAY}${SEP}(?:` +
    `${DAY("day1")}(?:${S}of)?${S}(?<month1>${MONTH})(?:,?${S}(?<year1>${YEAR_DIGITS}))?` +
    `|(?<month2>${MONTH})${S}${DAY("day2")}(?:,?${S}(?<year2>${YEAR_DIGITS}))?` +
    `|(?<a>[0-9]{1,2})(?<sep>[/.])(?<b>[0-9]{1,2})\\k<sep>(?<year3>${YEAR_DIGITS})` +
    // "Monday, 31/10": no year, a slash only ("Monday, 3.5" is a number).
    `|(?<na>[0-9]{1,2})/(?<nb>[0-9]{1,2})(?![/.,]?[0-9])` +
    `|(?<iso>(?<isoYear>${YEAR_DIGITS})-(?<isoMonth>[0-9]{2})-(?<isoDay>[0-9]{2})))(?![\\p{L}\\p{N}])`,
  "gdu",
);
// Days a month cannot have: "June 31", "the 31st of June", "Feb 30th, 2023".
const MONTH_DAY = `(?<target>(?<month1>${MONTH})${S}${DAY("day1")}|(?<![\\p{N}:.,/])${DAY("day2")}(?:${S}of)?${S}(?<month2>${MONTH}))(?:,?${S}(?<year>${YEAR_DIGITS}))?(?![\\p{L}\\p{N}]|[.,:][0-9])`;
// A preposition that a date takes: "on April 0", "by the 0th of April".
const DATE_CUE =
  /(?:^|[^\p{L}])(?:on|by|until|till|from|since|before|after|dated|due)[ \t\u00a0]{1,8}(?:the[ \t\u00a0]{1,8})?$/iu;
// Any four-digit year: an impossible day or month needs no calendar ("31/04/1500").
// Markdown emphasis before the date is not a word: "**31/04/2020**", "_31/04/2020_". Thus the
// frame has its own start, not WORD_START (an underscore continues a word there).
const NUMERIC = new RegExp(
  `(?<![.\\p{M}'’@#\\\\])${NO_WORD_BEFORE}(?<![\\p{N}.,/-])(?<a>[0-9]{1,2})(?<sep>[/.])(?<b>[0-9]{1,2})\\k<sep>(?<year>${YEAR_DIGITS})(?![\\p{N}]|[.,][0-9])`,
  "gdu",
);
/**
 * A date is prose, not a path or a dotted name, in any language: "2/30/2025",
 * "31.11.2025", "31/9/69", "31/سبتمبر/1969", Arabic-Indic digits.
 * Dotted forms need a four-digit year so versions ("1.12.31") stay technical.
 */
export const NUMERIC_DATE_TOKEN = new RegExp(
  "^(?:D{1,2}/(?:D{1,2}|\\p{L}{3,12})/(?:D{2}|D{4})|D{1,2}\\.D{1,2}\\.D{4})$".replace(/D/g, DIGIT),
  "u",
);

const monthIndex = (name: string) =>
  MONTHS.findIndex((month) => month.startsWith(name.replace(".", "").toLowerCase().slice(0, 3)));
const valid = (month: number, day: number, year?: number) =>
  month >= 0 && month < 12 && day >= 1 && day <= daysInMonth(month + 1, year);
/** The weekday of a date, Sunday = 0. Month is 0 to 11. */
const weekdayOf = (year: number, month: number, day: number) => clockWeekday(year, month + 1, day);
const ordinal = (day: number) =>
  day % 100 >= 11 && day % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
/** "Mo" -> 1: a two-letter weekday. */
const two = (form: string) => WEEKDAYS.findIndex((name) => name.startsWith(form));

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
    let yearAt: string;
    if (g.iso) {
      [year, month, day, dayAt, yearAt] = [
        +g.isoYear,
        +g.isoMonth - 1,
        +g.isoDay,
        "isoDay",
        "isoYear",
      ];
    } else if (g.a || g.na) {
      const [a, b] = g.a ? [+g.a, +g.b] : [+g.na, +g.nb];
      const [aAt, bAt] = g.a ? ["a", "b"] : ["na", "nb"];
      [year, yearAt] = [+(g.year3 ?? NaN), "year3"];
      // Only a field above 12 says which one is the day; "03/04/2014" stays ambiguous.
      if (a > 12 && b <= 12) [month, day, dayAt] = [b - 1, a, aAt];
      else if (b > 12 && a <= 12) [month, day, dayAt] = [a - 1, b, bAt];
      else continue;
    } else {
      [year, yearAt] = [+(g.year1 ?? g.year2 ?? NaN), g.year1 ? "year1" : "year2"];
      month = monthIndex(g.month1 ?? g.month2);
      day = +(g.day1 ?? g.day2);
      dayAt = g.day1 ? "day1" : "day2";
    }
    if (named < 0) continue;
    // No year: the weekday is checked against the years the date can mean (reviewClock).
    if (Number.isNaN(year)) {
      const found = weekdayNoYear(ctx, m, named, month + 1, day, dayAt);
      if (found) findings.push(found);
      continue;
    }
    if (!valid(month, day, year)) continue;
    const actual = weekdayOf(year, month, day);
    if (actual === named) continue;
    const [start, weekdayEnd] = group(m, "weekday");
    const [dayStart, dayEnd] = group(m, dayAt);
    const suffix = /^(?:st|nd|rd|th)/.exec(ctx.text.slice(dayEnd, dayEnd + 2))?.[0] ?? "";
    const [yearStart, yearEnd] = group(m, yearAt);
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
    if (other !== undefined) alternatives.push(edit(yearStart, yearEnd, String(other)));
    findings.push(
      finding("englishDateConsistency", "review_msg_weekday_mismatch", start, end, alternatives, {
        requiresChoice: true,
        context: { start, end: m.index + m[0].length },
      }),
    );
  }
  return findings;
}

/**
 * "Monday, 7 October" with no year: wrong only when no year the date can mean has that weekday.
 * The fixes are the weekday of each such year, then the nearest day on the typed weekday.
 */
function weekdayNoYear(
  ctx: DetectContext,
  m: RegExpExecArray,
  named: number,
  month: number,
  day: number,
  dayAt: string,
): RawFinding | null {
  const [start, weekdayEnd] = group(m, "weekday");
  const context = contextYear(ctx.text, start, ctx.lang);
  const years = yearsFor(month, day, context);
  const weekdays = weekdaysFor(month, day, context);
  if (!years.length || weekdays.includes(named)) return null;
  const [dayStart, dayEnd] = group(m, dayAt);
  const suffix = /^(?:st|nd|rd|th)/.exec(ctx.text.slice(dayEnd, dayEnd + 2))?.[0] ?? "";
  const end = dayEnd + suffix.length;
  const edit = (from: number, to: number, value: string) =>
    ctx.text.slice(start, from) + value + ctx.text.slice(to, end);
  const alternatives = weekdays.map((weekday) => edit(start, weekdayEnd, WEEKDAYS[weekday]));
  const near = nearestDayOn(years[0], month, day, named);
  if (near !== null)
    alternatives.push(
      edit(
        dayStart,
        end,
        String(near).padStart(dayEnd - dayStart, "0") + (suffix ? ordinal(near) : ""),
      ),
    );
  return finding("englishDateConsistency", "review_msg_weekday_no_year", start, end, alternatives, {
    requiresChoice: true,
    context: { start, end: m.index + m[0].length },
  });
}

function impossibleDates(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const flag = (start: number, end: number) =>
    findings.push(
      finding("englishDateConsistency", "review_msg_impossible_date", start, end, [], {
        warningOnly: true,
      }),
    );
  for (const m of frameMatches(ctx, MONTH_DAY)) {
    const g = m.groups!;
    const monthName = g.month1 ?? g.month2;
    const cued = DATE_CUE.test(ctx.text.slice(Math.max(0, m.index - 16), m.index));
    // A lowercase name is a word ("march 40 miles"), but a four-digit year or a date cue makes
    // it a date ("march 32, 2020", "on april 31"): the casing rule reports the name. "May 32"
    // may still be the verb. With a four-digit year, "May 32, 2020" is a date.
    if (!/^\p{Lu}/u.test(monthName) && !g.year && !cued) continue;
    if (g.month1 && /^may$/i.test(monthName) && !g.year) continue;
    const day = +(g.day1 ?? g.day2);
    const end = m.index + m[0].length;
    // "In March 37," and "38 Jan" (a size in a listing) are a year and a count, not a day;
    // "September 31 BC" counts years too. A four-digit year makes it a full date: "June 32, 2020".
    if (day > 31 && !g.year && !/[0-9](?:st|nd|rd|th)/.test(m[0])) continue;
    if (/^[ \t\u00a0]*(?:AD|BC|BCE|CE|A\.D\.|B\.C\.)/.test(ctx.text.slice(end, end + 8))) continue;
    // Day 0 is a wrong day in a full date ("June 0, 2020", "0 June 2020") or after a date
    // cue ("on April 0", "by 0 April").
    if (
      (day < 1 && !g.year && !cued) ||
      valid(monthIndex(monthName), day, g.year ? +g.year : undefined)
    )
      continue;
    flag(m.index, end);
  }
  for (const m of frameMatches(ctx, NUMERIC, (match) => match.index)) {
    const [a, b, year] = [+m.groups!.a, +m.groups!.b, +m.groups!.year];
    if (valid(a - 1, b, year) || valid(b - 1, a, year)) continue;
    flag(m.index, m.index + m[0].length);
  }
  // "2025-02-30", also after a weekday ("Friday, 2025-02-30"): the weekday check skips it.
  for (const { start, end } of invalidIsoDates(ctx)) flag(start, end);
  return findings;
}
function detect(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "en")) return [];
  return [...weekdayMismatch(ctx), ...impossibleDates(ctx)];
}

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishDateConsistency"], detect },
];
