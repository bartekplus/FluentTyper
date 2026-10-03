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

/**
 * The date at midnight UTC. Month is 1 to 12. Date.UTC changes the years 0 to 99 to 1900 to
 * 1999. Thus setUTCFullYear sets the real year again ("1 janvier 0099" is in the year 99).
 */
export function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

/** The date as a count of days since the epoch, or null when the month has no such day. */
export function dayCount(year: number, month: number, day: number): number | null {
  const date = utcDate(year, month, day);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime() / DAY
    : null;
}

/** The weekday of a date, Sunday = 0. Month is 1 to 12. */
export const weekdayOf = (year: number, month: number, day: number): number =>
  utcDate(year, month, day).getUTCDay();

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

// The end of a sentence: a line break, or a stop, "!" or "?" with a space and a capital letter
// (or a letter with no case, as in Arabic) after it. A stop after a day number ("am 4. Mai")
// or after a short capitalized abbreviation ("Mr.", "Jan.") does not end the sentence.
const SENTENCE_END =
  /\n|(?:(?<!(?<![\p{L}\p{N}])(?:\p{N}{1,2}|\p{Lu}\p{Ll}{0,2}))\.|[!?…؟])[.!?…؟]*["'”’»)\]]*\s+(?=[¿¡«"'“‘(]*[\p{Lu}\p{Lt}\p{Lo}])/gu;

/**
 * A four-digit year (1600 to 2199) written in the same sentence as the date at `index`: the
 * last one before it, else the first one after it ("Monday, March 18 or Tuesday, March 19,
 * 2002"). A year in another sentence does not count: "The company began in 1990. Sunday,
 * March 18 is our next meeting." has no year for March 18.
 */
export function contextYear(text: string, index: number): number | undefined {
  const from = Math.max(0, index - 400);
  const window = text.slice(from, index + 200);
  const at = index - from;
  let start = 0;
  let end = window.length;
  for (const m of window.matchAll(SENTENCE_END)) {
    if (m.index >= at) {
      end = m.index;
      break;
    }
    start = m.index + m[0].length;
  }
  const before = window.slice(Math.min(start, at), at).match(YEAR);
  if (before) return Number(before[before.length - 1]);
  const after = window.slice(at, end).match(YEAR);
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
