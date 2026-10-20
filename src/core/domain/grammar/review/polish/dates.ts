import { invalidIsoDates } from "../isoDates";
import type { Detector, MatchFixer, MatchResult } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { contextYear, daysInMonth, weekdayOf, yearsFor } from "../reviewClock";
import { caseLike, findingAt, isPl } from "./shared";

/*
 * Dates: a day the month does not have ("31 września", "29 lutego 2023"), a
 * weekday that does not fall on the date, a range that runs backwards, and the
 * month's form after a day number ("1 stycznia", not "1 styczeń", "1. stycznia"
 * or the English-style "1 Sty").
 */

const RULE = "polishDates" as const;

export const GENITIVE = [
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
];
const NOMINATIVE = [
  "styczeń",
  "luty",
  "marzec",
  "kwiecień",
  "maj",
  "czerwiec",
  "lipiec",
  "sierpień",
  "wrzesień",
  "październik",
  "listopad",
  "grudzień",
];
const ABBREVIATED = [
  "sty",
  "lut",
  "mar",
  "kwi",
  "maj",
  "cze",
  "lip",
  "sie",
  "wrz",
  "paź",
  "lis",
  "gru",
];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** Weekday stems (every case) and abbreviations, Monday first as in Polish calendars. */
const WEEKDAYS: Array<[RegExp, number]> = [
  [/^(?:poniedział\p{L}*|pon|pn)$/iu, 1],
  [/^(?:wtor\p{L}*|wt)$/iu, 2],
  [/^(?:środ\p{L}*|śr|sr)$/iu, 3],
  [/^(?:czwart\p{L}*|czw|cz)$/iu, 4],
  [/^(?:piąt\p{L}*|pt)$/iu, 5],
  [/^(?:sobot\p{L}*|sob|so)$/iu, 6],
  [/^(?:niedziel\p{L}*|niedz|nd|ndz)$/iu, 0],
];
const WEEKDAY =
  "poniedział\\p{L}*|wtor\\p{L}*|środ\\p{L}*|czwart\\p{L}*|piąt\\p{L}*|sobot\\p{L}*|niedziel\\p{L}*|pon\\.?|pn\\.?|wt\\.?|śr\\.?|czw\\.?|pt\\.?|sob\\.?|niedz\\.?|nd\\.?";

const monthOf = (word: string): number => {
  const lower = word.toLowerCase();
  const roman = ROMAN.indexOf(word.toUpperCase());
  if (/^[ivx]+$/i.test(word) && roman >= 0) return roman + 1;
  const genitive = GENITIVE.indexOf(lower);
  return genitive >= 0 ? genitive + 1 : NOMINATIVE.indexOf(lower) + 1;
};

/** Weekdays in the nominative, Sunday first as Date.getUTCDay counts. */
const NOMINATIVE_WEEKDAYS = [
  "niedziela",
  "poniedziałek",
  "wtorek",
  "środa",
  "czwartek",
  "piątek",
  "sobota",
];

function weekdayNamed(word: string): number | null {
  const bare = word.replace(/\.$/, "");
  for (const [regex, day] of WEEKDAYS) if (regex.test(bare)) return day;
  return null;
}

function impossibleDates(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { mword, dmonth } = m.groups!;
  const day = m.groups!.day ?? m.groups!.dday;
  const year = m.groups!.year ?? m.groups!.dyear;
  // A Roman month needs a year, or it may be a chapter or a list number.
  if (mword && /^[IVX]+$/.test(mword) && !year) return null;
  if (mword && /^[ivx]+$/.test(mword)) return null;
  const month = mword ? monthOf(mword) : Number(dmonth);
  const y = year ? Number(year) : undefined;
  const d = Number(day);
  const start = m.index;
  const end = start + m[0].length;
  if (month < 1 || month > 12 || d < 1 || d > daysInMonth(month, y)) {
    return findingAt(ctx, start, end, [], RULE, "review_msg_pl_impossible_date");
  }
  // A weekday right before ("wtorek, 27 sierpnia 2014") or after ("…2014, wtorek", "(wtorek)").
  // No year: the years the date can mean (reviewClock).
  const years = y === undefined ? yearsFor(month, d, contextYear(ctx.text, start, ctx.lang)) : [y];
  const weekdays = [...new Set(years.map((year) => weekdayOf(year, month, d)))];
  const before = new RegExp(
    `(?<![\\p{L}])(?<w>${WEEKDAY})[ \\t\\u00a0]*,?[ \\t\\u00a0]*$`,
    "iu",
  ).exec(ctx.text.slice(Math.max(0, start - 24), start));
  const after = new RegExp(
    `^[ \\t\\u00a0]*[,(][ \\t\\u00a0]*(?<w>${WEEKDAY})(?![\\p{L}])`,
    "iu",
  ).exec(ctx.text.slice(end, end + 24));
  const named = before ?? after;
  if (!named) return null;
  const said = weekdayNamed(named.groups!.w);
  if (said === null || !years.length || weekdays.includes(said)) return null;
  const key = y === undefined ? "review_msg_weekday_no_year" : "review_msg_pl_weekday_date";
  const typed = named.groups!.w;
  const wordStart = before ? start - before[0].length : end + after![0].indexOf(typed);
  // A weekday in the nominative ("wtorek, 13 października") is replaced. After a preposition
  // ("w środę") the case changes the form, so it only gets a warning.
  const afterPreposition = /(?:^|[^\p{L}])(?:w|we|na|od|do|przez|za|po|przed)[ \t\u00a0]+$/iu.test(
    ctx.text.slice(Math.max(0, wordStart - 12), wordStart),
  );
  if (!afterPreposition && NOMINATIVE_WEEKDAYS.includes(typed.toLowerCase())) {
    const alternatives = weekdays.map((w) => caseLike(typed, NOMINATIVE_WEEKDAYS[w]));
    // The day can be the slip instead: nothing is preselected.
    return {
      ...findingAt(ctx, wordStart, wordStart + typed.length, alternatives, RULE, key),
      requiresChoice: true,
    };
  }
  const wStart = before ? start - before[0].length : end;
  const wEnd = before ? end : end + after![0].length;
  return findingAt(ctx, Math.max(0, wStart), wEnd, [], RULE, key);
}

/** ISO dates ("2023-02-30") that name no day. */
const isoDates = (ctx: DetectContext): RawFinding[] =>
  invalidIsoDates(ctx).map(({ start, end }) =>
    findingAt(ctx, start, end, [], RULE, "review_msg_pl_impossible_date"),
  );

function dayRanges(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  if (Number(m.groups!.a) >= Number(m.groups!.b))
    return findingAt(
      ctx,
      m.index,
      m.index + m[0].length,
      [],
      RULE,
      "review_msg_pl_impossible_date",
    );
  return null;
}

function yearRanges(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { a, b } = m.groups!;
  const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 24);
  if (/^[ \t\u00a0]*\d/u.test(after)) return null;
  // Years before Christ run backwards: "1814–1781 p.n.e." is right, "715–1840 p.n.e." is not.
  const beforeChrist =
    /^[ \t\u00a0]*(?:p\.?[ \t\u00a0]*n\.?[ \t\u00a0]*e|przed[ \t\u00a0]+(?:naszą|Chrystusem)|BC)/iu.test(
      after,
    );
  // "1962 – 272" is a year and a count; a longer end year is a year only before Christ.
  if (b.length !== a.length && b.length > 2 && !(beforeChrist && b.length > a.length)) return null;
  // Only in a year context: "w latach", "w okresie", "lata".
  const before = ctx.text.slice(Math.max(0, m.index - 16), m.index);
  if (!/(?:latach|lata|okresie|sezonie|rok\p{L}*|w|od)[ \t ]+$/iu.test(before)) return null;
  const start = Number(a);
  const endYear = b.length < a.length ? Number(a.slice(0, a.length - b.length) + b) : Number(b);
  if (beforeChrist ? endYear < start : endYear > start) return null;
  return findingAt(ctx, m.index, m.index + m[0].length, [], RULE, "review_msg_pl_impossible_date");
}

function monthForms(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { day, dot, sp, month } = m.groups!;
  const index = NOMINATIVE.indexOf(month.toLowerCase());
  const spelled = /^\p{L}/u.test(day);
  // "Maj" capitalized after "1" names the holiday; "w maju" etc. never reach here.
  if (index >= 0 && /^\p{Lu}/u.test(month)) return null;
  if (index < 0 && !dot) return null;
  if (spelled && (dot || index < 0)) return null;
  const genitive = index >= 0 ? GENITIVE[index] : month.toLowerCase();
  if (dot) {
    // "1. stycznia": no dot after the day before a month name.
    const fixed = `${day}${sp}${genitive}`;
    return findingAt(
      ctx,
      m.index,
      m.index + m[0].length,
      [fixed],
      RULE,
      "review_msg_pl_month_form",
    );
  }
  const start = m.index + day.length + sp.length;
  return findingAt(
    ctx,
    start,
    start + month.length,
    [caseLike(month, genitive)],
    RULE,
    "review_msg_pl_month_form",
  );
}

function abbreviatedMonths(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { day, month, year } = m.groups!;
  const index = ABBREVIATED.indexOf(month.toLowerCase());
  // "1 maj 2012" is the nominative month, which monthForms puts in the genitive.
  if (month === "maj") return null;
  return findingAt(
    ctx,
    m.index,
    m.index + m[0].length,
    [`${day} ${ROMAN[index]} ${year}`, `${day} ${GENITIVE[index]} ${year}`],
    RULE,
    "review_msg_pl_month_form",
  );
}

/*
 * Decades are written with the decade and the century: "lata 90. XX w.", not
 * "lata 1990." (an English calque), and a year takes no apostrophe ("lata '90").
 */
const DECADE_WORDS = "lata|lat|latach|latami|latom";
const ROMAN_CENTURY = [
  "",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
  "XVI",
  "XVII",
  "XVIII",
  "XIX",
  "XX",
  "XXI",
];

function fullDecades(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const year = Number(m.groups!.year);
  const century = ROMAN_CENTURY[Math.floor(year / 100) + 1];
  // "lata 1900." has no "lata 00.": the fix names the years ("lata 1900–1909").
  return findingAt(
    ctx,
    m.index,
    m.index + m[0].length,
    [year % 100 ? `${year % 100}. ${century} w.` : `${year}–${year + 9}`],
    RULE,
    "review_msg_pl_decade",
  );
}

function apostropheYears(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { year } = m.groups!;
  // "Euro '2012": a full year needs no apostrophe; "lata '90" is the decade "90.".
  const before = ctx.text.slice(Math.max(0, m.index - 12), m.index);
  let fixed: string | null = null;
  if (year.length === 4) fixed = year;
  else if (new RegExp(`(?:^|[^\\p{L}])(?:${DECADE_WORDS})[ \\t\\u00a0]+$`, "iu").test(before))
    fixed = /^[ \t ]*[.]/u.test(ctx.text.slice(m.index + m[0].length)) ? year : `${year}.`;
  if (!fixed) return null;
  return findingAt(ctx, m.index, m.index + m[0].length, [fixed], RULE, "review_msg_pl_decade");
}

function longYears(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const year = m.groups!.year;
  // Drop one digit of a doubled pair: one year from 1000 to 2099, or no fix.
  const fixes = new Set<string>();
  for (let i = 1; i < year.length; i++)
    if (year[i] === year[i - 1]) fixes.add(year.slice(0, i) + year.slice(i + 1));
  const years = [...fixes].filter((fix) => /^(?:1\d|20)\d\d$/.test(fix));
  if (years.length !== 1) return null;
  const start = m.index + m[0].length - year.length;
  return findingAt(ctx, start, start + year.length, years, RULE, "review_msg_pl_impossible_date");
}

export const PREDICATES = {
  isoDates: (ctx: DetectContext) => (isPl(ctx) ? isoDates(ctx) : []),
} satisfies Record<string, Detector>;

/** The named frame fixes of the date rules of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  impossibleDates,
  dayRanges,
  yearRanges,
  monthForms,
  abbreviatedMonths,
  fullDecades,
  apostropheYears,
  longYears,
} satisfies Record<string, MatchFixer>;
