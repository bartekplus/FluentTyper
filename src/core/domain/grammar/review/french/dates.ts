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
const WEEKDAY = `(?:(?<weekday>${WEEKDAY_NAMES})[ \\t]*,?[ \\t]+)?`;
const DATES = [
  // "vendredi 28 août 2014", "le 31 septembre", "1er mars"
  new RegExp(
    `${B}${WEEKDAY}(?<day>\\d{1,2})(?:er)?[ \\t]+(?<month>${MONTH_NAMES})(?:[ \\t]+(?<year>\\d{4}))?${E}`,
    "giud",
  ),
  // "28/08/2014", "31-09-1969", "28/août/2014"
  new RegExp(
    `${B}${WEEKDAY}(?<day>\\d{1,2})(?<sep>[/-])(?<month>\\d{1,2}|${MONTH_NAMES})\\k<sep>(?<year>\\d{4})${E}`,
    "giud",
  ),
  // "vendredi 2014/08/28"
  new RegExp(`${B}${WEEKDAY}(?<year>\\d{4})/(?<month>\\d{1,2})/(?<day>\\d{1,2})${E}`, "giud"),
];

function checkDate(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const { weekday, day, month, year } = m.groups!;
  const monthNumber = monthIndex(month);
  if (monthNumber < 0 || monthNumber > 11) return null;
  const dayNumber = Number(day);
  const yearNumber = year ? Number(year) : undefined;
  if (!dayNumber || namedExampleBefore(ctx.text, m.index)) return null;
  const [dayStart] = m.indices!.groups!.day;
  const last = daysIn(monthNumber, yearNumber);
  if (dayNumber > last) {
    if (dayNumber > 31) return null;
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
