import {
  periodEndsSentence,
  SENTENCE_CLOSERS,
  SENTENCE_OPENERS,
} from "../implementations/CapitalizeSentenceStartRule";

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

/**
 * The number of days in a month (1 to 12). With no year, February has 29. The calendar repeats
 * every 400 years, so 2000 + year % 400 has the leap years of `year` (Date.UTC reads the years
 * 0 to 99 as 1900 to 1999).
 */
export const daysInMonth = (month: number, year = 2000): number =>
  new Date(Date.UTC(2000 + (year % 400), month, 0)).getUTCDate();

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

/**
 * A four-digit year, as the date detectors read it. `contextYear` reads the same pattern, so a
 * year that a detector accepts in a date is also a year for a date with no year near it.
 */
export const YEAR_DIGITS = "[0-9]{4}";

const YEAR = new RegExp(
  `(?<![\\p{L}\\p{N}.,/-])${YEAR_DIGITS}(?![\\p{L}\\p{N}]|[.,/-][0-9])`,
  "gu",
);

// Month names that can come after a day number with a stop: German "18. März", Polish
// "18. marca", English "18. March". The first letter can be a capital or not.
const MONTH_AFTER_DAY = [
  "januar",
  "jänner",
  "februar",
  "feber",
  "märz",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "dezember",
  "jan",
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
  "stycznia",
  "lutego",
  "marca",
  "kwietnia",
  "maja",
  "czerwca",
  "lipca",
  "sierpnia",
  "września",
  "października",
  "listopada",
  "grudnia",
  "january",
  "february",
  "march",
  "may",
  "june",
  "july",
  "october",
  "december",
]
  .map((month) => `[${month[0].toUpperCase()}${month[0]}]${month.slice(1)}`)
  .join("|");

// A German article or contracted preposition before an ordinal ("der 2. Weltkrieg", "im 3.
// Stock", "am 4. Mai"). The number with a stop is an ordinal before a noun, as "Nr." is.
const ORDINAL_CUE =
  "[Dd]e[rmns]|[Dd]ie|[Dd]as|[Aa]m|[Ii]m|[Zz]um|[Zz]ur|[Vv]om|[Bb]eim|[Ii]ns|[Aa]ns|[Ee]in(?:e[mnrs]?)?|[Jj]ede[mnrs]?|[Ss]eine[mnrs]?|[Ii]hre[mnrs]?|[Uu]nsere[mnrs]?";

// The end of a sentence: a line break, or a stop, "!" or "?" with a space and a letter after
// it. The case of the letter has no effect: "in 1990. sunday, ..." has two sentences. These
// stops do not end the sentence: a stop after a day number before a month name ("am 18. März",
// "18. marca"), and after an ordinal number before a noun ("der 2. Weltkrieg"). A stop after
// another number ends the sentence ("employed 10. Sunday, ..."). `contextYear` also keeps a
// stop after an initial or a continuation abbreviation ("Mr.", "Jan. 5"), but not after a short
// name ("with Tom."). An abbreviation that can end a sentence ends it before a capital letter
// ("paper, etc. Sunday"), not before a lowercase letter ("e.g. the").
const SENTENCE_END = new RegExp(
  `\\n|(?:(?<!(?<![\\p{L}\\p{N}])(?:${ORDINAL_CUE})[ \\t]+\\p{N}{1,2})(?<!(?<![\\p{L}\\p{N}])\\p{N}{1,2}(?=\\.[ \\t]+(?:${MONTH_AFTER_DAY})(?![\\p{L}\\p{N}])))\\.|[!?…؟])${SENTENCE_CLOSERS}\\s+(?=${SENTENCE_OPENERS}\\p{L})`,
  "gu",
);

// A dotted token before a stop: "example.com", "notes.txt", "e.g", "U.S".
const DOTTED_TOKEN = /[\p{L}\p{N}]+(?:\.[\p{L}\p{N}]+)+$/u;

/**
 * True when the stop at `index` closes a dotted technical token: a hostname, a file name or a
 * version ("example.com.", "notes.txt.", "v1.2."). A dotted abbreviation has only short parts
 * of letters ("e.g.", "U.S.", "Ph.D."). Thus a part of three or more characters or a part with
 * a number makes the token technical. The stop after it is a sentence end, not an abbreviation.
 */
function closesDottedToken(text: string, index: number): boolean {
  const token = DOTTED_TOKEN.exec(text.slice(Math.max(0, index - 64), index))?.[0];
  // ponytail: a length test, not a list; a run-together abbreviation such as "Dr.med." also ends
  // the sentence. Add a list of run-together abbreviations if that gives wrong results.
  return !!token && token.split(".").some((part) => part.length >= 3 || /\p{N}/u.test(part));
}

// The safety cap of the context-year search: it reads at most 4,000 characters before and
// after the date. A sentence that is longer than this is cut at the cap.
const CONTEXT_CAP = 4_000;

/**
 * A four-digit year (`YEAR_DIGITS`) written in the same sentence as the date at `index`: the
 * last one before it, else the first one after it ("Monday, March 18 or Tuesday, March 19,
 * 2002"). A year in another sentence does not count: "The company began in 1990. Sunday,
 * March 18 is our next meeting." has no year for March 18. A stop after a continuation
 * abbreviation of `lang` does not end the sentence ("In 1990, Mr. Smith came on Sunday, March
 * 18."). A stop after an abbreviation that can end a sentence ends it before a capital letter:
 * "... in 1990 with pens, paper, etc. Sunday, March 18 is ..." has no year for March 18.
 */
export function contextYear(text: string, index: number, lang?: string): number | undefined {
  // The sentence boundaries set the search. A safety cap of CONTEXT_CAP characters on each side
  // keeps the cost of one call bounded in very long text with no sentence end.
  const from = Math.max(0, index - CONTEXT_CAP);
  const limit = Math.min(text.length, index + CONTEXT_CAP);
  let start = from;
  let end = limit;
  // The scan starts in the full text, so the lookbehinds also see the text before `from`.
  SENTENCE_END.lastIndex = from;
  for (let m = SENTENCE_END.exec(text); m && m.index < limit; m = SENTENCE_END.exec(text)) {
    // A stop after a letter: the abbreviation lists of the sentence-start rule decide. A stop
    // after a number is left to SENTENCE_END ("1990." ends a sentence also in German). A stop
    // after a dotted technical token ends the sentence ("see example.com. Monday").
    if (
      m[0][0] === "." &&
      /\p{L}/u.test(text[m.index - 1] ?? "") &&
      !closesDottedToken(text, m.index) &&
      !periodEndsSentence(text, m.index, lang)
    )
      continue;
    if (m.index >= index) {
      end = m.index;
      break;
    }
    start = m.index + m[0].length;
  }
  const before = text.slice(Math.min(start, index), index).match(YEAR);
  if (before) return Number(before[before.length - 1]);
  const after = text.slice(index, end).match(YEAR);
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
