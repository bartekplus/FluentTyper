import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { ownedFrenchWords, withCase } from "./frenchTokens";

// Dates the calendar rules out: a day past the month's end ("31 septembre", "29 février 2023")
// and a weekday that contradicts a full date ("vendredi 28 août 2014" was a Thursday).

const RULE = "frenchDates";
const MESSAGE = "review_msg_fr_date";

const MONTHS = [
  ["janvier"],
  ["février", "fevrier"],
  ["mars"],
  ["avril"],
  ["mai"],
  ["juin"],
  ["juillet"],
  ["août", "aout"],
  ["septembre"],
  ["octobre"],
  ["novembre"],
  ["décembre", "decembre"],
];
const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTH_NAMES = MONTHS.flat().join("|");
const WEEKDAY_NAMES = WEEKDAYS.join("|");

const monthIndex = (month: string) => {
  if (/^\d+$/.test(month)) return Number(month) - 1;
  const lower = month.toLowerCase();
  return MONTHS.findIndex((names) => names.includes(lower));
};
const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const daysIn = (month: number, year?: number) =>
  month === 1
    ? year === undefined || leap(year)
      ? 29
      : 28
    : [3, 5, 8, 10].includes(month)
      ? 30
      : 31;

const B = "(?<![\\p{L}\\p{N}_])";
const E = "(?![\\p{L}\\p{N}_])";
const WEEKDAY = `(?:(?<weekday>${WEEKDAY_NAMES})[ \\t]{0,8},?[ \\t]{1,8})?`;
const DATES = [
  // "vendredi 28 août 2014", "le 31 septembre", "1er mars", "le 32 janvier"
  new RegExp(
    `${B}${WEEKDAY}(?<day>\\d{1,4})(?:er)?[ \\t]{0,8}[ \\t/-][ \\t]{0,8}(?<month>${MONTH_NAMES})(?:[ \\t/-]{1,8}(?<year>\\d{4}))?${E}`,
    "giud",
  ),
  // "28/08/2014", "31-09-1969", "31.11.89", "28/août/2014"
  new RegExp(
    `${B}${WEEKDAY}(?<day>\\d{1,4})(?<sep>[/.-])(?<month>\\d{1,2}|${MONTH_NAMES})\\k<sep>(?<year>\\d{4}|\\d{2})${E}`,
    "giud",
  ),
  // "le 31/04", "née le 30.02": a day and a month after "le" or "du".
  new RegExp(
    `(?<=${B}(?:le|du|au)[ \\t]{1,8})(?<day>\\d{1,4})(?<sep>[/.])(?<month>\\d{1,2})(?![\\p{L}\\p{N}_/]|[.,/]\\d)`,
    "giud",
  ),
  // "vendredi 2014/08/28"
  new RegExp(`${B}${WEEKDAY}(?<year>\\d{4})/(?<month>\\d{1,2})/(?<day>\\d{1,2})${E}`, "giud"),
];

/** A day or month no calendar has ("32 janvier", "11/50/2014"): flagged, nothing to offer. */
function impossible(m: RegExpExecArray): RawFinding {
  const [start] = m.indices!.groups!.day;
  const end = m.index + m[0].length;
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start: Math.min(start, m.index + (m.groups!.weekday?.length ?? 0)), end },
    alternatives: [],
    warningOnly: true,
  };
}

function checkDate(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const { weekday, day, month, year } = m.groups!;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const monthNumber = monthIndex(month);
  const dayNumber = Number(day);
  // "le 300 janvier" is a slip for a day; "les 300 janvier" or "1500 mai" are other numbers.
  const dated = /(?:^|[^\p{L}])(?:le|du|au|né|née)[ \t]+$/iu.test(
    ctx.text.slice(Math.max(0, m.index - 8), m.index),
  );
  const numeric = /^\d+$/.test(month);
  if (day.length > 2 && (!dated || numeric)) return null;
  if (monthNumber < 0 || monthNumber > 11 || dayNumber > 31) {
    // "01/31/2014" reads as a month-first date: only a pair impossible both ways is flagged.
    const swapped = numeric && Number(month) <= 31 && dayNumber >= 1 && dayNumber <= 12;
    return dated && !swapped ? impossible(m) : null;
  }
  // A two-digit year leaves leap years open.
  const yearNumber = year && year.length === 4 ? Number(year) : undefined;
  if (!dayNumber) return null;
  const [dayStart] = m.indices!.groups!.day;
  const last = daysIn(monthNumber, yearNumber);
  if (dayNumber > last) {
    const choices = monthNumber === 1 && yearNumber === undefined ? ["28", "29"] : [String(last)];
    return {
      ruleId: RULE,
      messageKey: MESSAGE,
      range: { start: dayStart, end: dayStart + day.length },
      alternatives: choices,
      context: { start: m.index, end: m.index + m[0].length },
      ...(choices.length > 1 ? { requiresChoice: true as const } : {}),
    };
  }
  if (!weekday || yearNumber === undefined) return null;
  const actual = WEEKDAYS[new Date(Date.UTC(yearNumber, monthNumber, dayNumber)).getUTCDay()];
  if (actual === weekday.toLowerCase()) return null;
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start: m.index, end: m.index + weekday.length },
    alternatives: [withCase(weekday, actual)],
    context: { start: m.index, end: m.index + m[0].length },
  };
}

function dates(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const pattern of DATES)
    for (const m of ownedFrenchWords(ctx, pattern)) {
      const finding = checkDate(ctx, m);
      if (finding) findings.push(finding);
    }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: dates }];
