// "Now" for the date checks that need today's date: a weekday next to a date with no year,
// and a verb tense against a date in the future or in the past.
// The system clock is the default. Tests and the LT harness fix "now" with setReviewClock.

const DAY = 86_400_000;
let fixed: number | null = null;

/** Fixes "now" to a time in ms since the epoch. Null goes back to the system clock. */
export function setReviewClock(now: number | null): void {
  fixed = now;
}

/** Today's local date as a count of days since the epoch, with its year. */
function today(): { day: number; year: number } {
  const now = new Date(fixed ?? Date.now());
  const year = now.getFullYear();
  return { day: Date.UTC(year, now.getMonth(), now.getDate()) / DAY, year };
}

/** The date as a count of days since the epoch, or null when the month has no such day. */
export function dayCount(year: number, month: number, day: number): number | null {
  const time = Date.UTC(year, month - 1, day);
  const back = new Date(time);
  return back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? time / DAY : null;
}

/** The weekday of a date, Sunday = 0. Month is 1 to 12. */
export const weekdayOf = (year: number, month: number, day: number): number =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay();

/**
 * "future" when the date is more than one day after today, "past" when it is more than one
 * day before today, otherwise null. The margin of one day keeps out a date written in another
 * time zone.
 */
export function dateSide(year: number, month: number, day: number): "future" | "past" | null {
  const count = dayCount(year, month, day);
  if (count === null) return null;
  const now = today().day;
  return count > now + 1 ? "future" : count < now - 1 ? "past" : null;
}

/** True when the date is in the past, but not more than `years` years before today. */
export function recentPast(year: number, month: number, day: number, years = 3): boolean {
  const count = dayCount(year, month, day);
  return (
    count !== null && dateSide(year, month, day) === "past" && today().day - count <= years * 366
  );
}

// A date with no year can mean the last year near the turn of the year: in January,
// "Monday, 28 December" is usually the December that just went by.
const TURN_OF_YEAR = 90;

/**
 * The years that a date with no year can mean, nearest to today first: this year; the last
 * year when that date is not more than 90 days before today; the next year when the date
 * this year has already gone by ("Sunday, 13 June" written in October can mean next June).
 * A year written near the date (`context`) comes first. An empty list: no year has the date.
 */
export function yearsFor(month: number, day: number, context?: number): number[] {
  const { day: now, year } = today();
  const thisYear = dayCount(year, month, day);
  const years: [number, number][] = [];
  for (const candidate of [year, year - 1, year + 1]) {
    const count = dayCount(candidate, month, day);
    if (count === null) continue;
    const distance = Math.abs(count - now);
    const plausible =
      candidate === year ||
      (candidate < year ? distance <= TURN_OF_YEAR : thisYear === null || thisYear < now);
    if (plausible) years.push([candidate, distance]);
  }
  const sorted = years.sort((a, b) => a[1] - b[1]).map(([y]) => y);
  if (context === undefined || dayCount(context, month, day) === null) return sorted;
  return [context, ...sorted.filter((y) => y !== context)];
}

const YEAR = /(?<![\p{L}\p{N}.,/-])(?:1[6-9]|2[01])\d{2}(?![\p{L}\p{N}]|[.,/-]\d)/gu;

/**
 * A four-digit year (1600 to 2199) written near `index` in the same paragraph: the last one
 * before it, else the first one after it ("Monday, March 18 or Tuesday, March 19, 2002").
 */
export function contextYear(text: string, index: number): number | undefined {
  const before = /[^\n]*$/.exec(text.slice(Math.max(0, index - 400), index))![0].match(YEAR);
  if (before) return Number(before[before.length - 1]);
  const after = /^[^\n]*/.exec(text.slice(index, index + 200))![0].match(YEAR);
  return after ? Number(after[0]) : undefined;
}

/**
 * The weekdays (Sunday = 0) that a date with no year has in the years it can mean, in the
 * order of `yearsFor`. A weekday that matches one of them is correct.
 */
export function weekdaysFor(month: number, day: number, context?: number): number[] {
  return [...new Set(yearsFor(month, day, context).map((year) => weekdayOf(year, month, day)))];
}

/**
 * The days in the same month near `day` that fall on `weekday` in `year`, nearest first.
 * Used for the second fix: keep the weekday and change the day.
 */
export function nearestDayOn(
  year: number,
  month: number,
  day: number,
  weekday: number,
): number | null {
  const actual = weekdayOf(year, month, day);
  const back = (actual - weekday + 7) % 7;
  const ahead = (weekday - actual + 7) % 7;
  for (const candidate of back <= ahead ? [day - back, day + ahead] : [day + ahead, day - back])
    if (dayCount(year, month, candidate) !== null) return candidate;
  return null;
}
