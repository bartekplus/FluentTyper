import { namedExampleBefore } from "../exampleCues";
import { DIGIT, digitValue, invalidIsoDates } from "../isoDates";
import { contextYear, daysInMonth, weekdayOf, yearsFor } from "../reviewClock";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { FindingsFilter, FrameRef, MatchFixer } from "../../engine/reviewRules";

type Finding = Omit<RawFinding, "ruleId">;

// Month names by number: the Egyptian/Gulf forms, the Levantine (Syriac) ones and
// the Maghrebi (French-derived) ones.
const MONTHS: ReadonlyArray<readonly string[]> = [
  ["يناير", "كانون الثاني", "جانفي"],
  ["فبراير", "شباط", "فيفري"],
  ["مارس", "آذار"],
  ["أبريل", "ابريل", "إبريل", "نيسان", "أفريل"],
  ["مايو", "أيار", "ماي"],
  ["يونيو", "يونيه", "حزيران", "جوان"],
  ["يوليو", "يوليه", "تموز", "جويلية"],
  ["أغسطس", "اغسطس", "آب", "أوت"],
  ["سبتمبر", "أيلول"],
  ["أكتوبر", "اكتوبر", "تشرين الأول"],
  ["نوفمبر", "تشرين الثاني"],
  ["ديسمبر", "كانون الأول"],
];
export const MONTH_NUMBER = new Map(
  MONTHS.flatMap((names, index) => names.map((name) => [name, index + 1] as const)),
);
// Sunday first, as Date.getUTCDay counts.
const WEEKDAYS: ReadonlyArray<readonly string[]> = [
  ["الأحد"],
  ["الإثنين", "الاثنين"],
  ["الثلاثاء"],
  ["الأربعاء"],
  ["الخميس"],
  ["الجمعة"],
  ["السبت"],
];
const WEEKDAY_NUMBER = new Map(
  WEEKDAYS.flatMap((names, index) => names.map((name) => [name, index] as const)),
);

const alternation = (words: Iterable<string>) =>
  [...words].sort((a, b) => b.length - a.length).join("|");
export const MONTH = alternation(MONTH_NUMBER.keys());
const SEP = "[ \\t\\u00a0]*[/.-][ \\t\\u00a0]*";

// A day or month out of range is a date only in a full date: "15/13/2024", "32 يناير".
// Versions, scores, ranges and IDs are not dates: "1.13.40", "3-13", "10-32", "12-45-2024-7".
const FULL_NUMERIC = new RegExp(
  `${DIGIT}{1,2}(?<a>${SEP})${DIGIT}{1,2}(?<b>${SEP})(?:[12١٢۱۲]${DIGIT}{3})$`,
  "u",
);
const NUMBER_BEFORE = new RegExp(`(?:${DIGIT}${SEP}|#[ \\t\\u00a0]*)$`, "u");
const NUMBER_AFTER = new RegExp(`^${SEP}${DIGIT}`, "u");
const ID_CUE =
  /(?:الإصدار|إصدار|الاصدار|اصدار|النسخة|نسخة|التحديث|تحديث|رقم|الرقم|هاتف|الهاتف|كود|الكود|رمز|الرمز|version|(?<!\p{L})v)[ \t :]*$/iu;

function fullDate(text: string, m: RegExpExecArray): boolean {
  const before = text.slice(Math.max(0, m.index - 24), m.index);
  const after = text.slice(m.index + m[0].length);
  if (NUMBER_BEFORE.test(before) || NUMBER_AFTER.test(after) || ID_CUE.test(before)) return false;
  if (m.groups!.monthName) return true;
  const numeric = FULL_NUMERIC.exec(m[0]);
  return !!numeric && numeric.groups!.a.trim() === numeric.groups!.b.trim();
}

/** The match starts in the chunk, outside named examples (the scan starts 64 before it). */
const owns = (ctx: DetectContext, m: RegExpExecArray) =>
  m.index >= ctx.from && !namedExampleBefore(ctx.text, m.index);

/** The finding of `frame`. */
const as = (frame: FrameRef, f: Finding): RawFinding => ({ ruleId: frame.ruleId, ...f });

/** A date in the wrong order: the fix puts its parts day first. */
const order =
  (fix: (g: Record<string, string>, gap: string) => string): MatchFixer =>
  (m, ctx, frame) => {
    if (!owns(ctx, m)) return null;
    const gap = /[ \t ]+/.exec(m[0])![0];
    return as(frame, {
      messageKey: "review_msg_arabic_date_order",
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [fix(m.groups!, gap)],
    });
  };

/** The named frame fixes of the date frames of grammar/rules/ar_SA.yaml (`fixer:`). */
export const FIXERS = {
  date: (m, ctx, frame) => {
    if (!owns(ctx, m)) return null;
    const findings: RawFinding[] = [];
    const { weekday, day, monthName, monthDigits, year } = m.groups!;
    const d = digitValue(day);
    const month = monthName ? MONTH_NUMBER.get(monthName)! : digitValue(monthDigits);
    const y = year === undefined ? undefined : digitValue(year);
    const outOfRange = d < 1 || d > 31 || month < 1 || month > 12;
    if (outOfRange && !fullDate(ctx.text, m)) return null;
    const fullYear = y !== undefined && year.length === 4 ? y : undefined;
    // A numeric out-of-range date needs parts near a real date and no month-first
    // reading: "12/25/2020" is real; "3-45-2020" (a score) and "99/73/2022" stay silent.
    if (
      outOfRange &&
      !monthName &&
      (d > 39 ||
        month > 39 ||
        (d >= 1 && d <= 12 && month >= 1 && month <= daysInMonth(d, fullYear)))
    )
      return null;
    const range = { start: m.index, end: m.index + m[0].length };
    if (outOfRange || d > daysInMonth(month, fullYear))
      return as(frame, {
        messageKey: "review_msg_arabic_impossible_date",
        range,
        alternatives: [],
        warningOnly: true,
      });
    // No year: the weekday is checked against each year the date can mean (reviewClock).
    if (weekday && y === undefined) {
      const years = yearsFor(month, d, contextYear(ctx.text, m.index, ctx.lang));
      const weekdays = [...new Set(years.map((year) => weekdayOf(year, month, d)))];
      if (years.length && !weekdays.includes(WEEKDAY_NUMBER.get(weekday)!))
        findings.push(
          as(frame, {
            messageKey: "review_msg_weekday_no_year",
            range: { start: m.index, end: m.index + weekday.length },
            alternatives: weekdays.map((w) => WEEKDAYS[w][0]),
            requiresChoice: true,
            context: range,
          }),
        );
    }
    if (weekday && fullYear !== undefined) {
      const actual = weekdayOf(fullYear, month, d);
      if (actual !== WEEKDAY_NUMBER.get(weekday))
        findings.push(
          as(frame, {
            messageKey: "review_msg_arabic_weekday_mismatch",
            range,
            alternatives: [],
            warningOnly: true,
          }),
        );
    }
    return findings;
  },
  longYear: (m, ctx, frame) => {
    if (!owns(ctx, m)) return null;
    const start = m.index + m[0].length - m.groups!.target.length;
    return as(frame, {
      messageKey: "review_msg_arabic_impossible_date",
      range: { start, end: m.index + m[0].length },
      alternatives: [],
      warningOnly: true,
    });
  },
  dayMonthYear: order((g, gap) => `${g.d}${gap}${g.m}${gap}${g.y}`),
  weekdayDayMonth: order((g, gap) => `${g.w}${gap}${g.d}${gap}${g.m}`),
  monthYear: order((g, gap) => `${g.m}${gap}${g.y}`),
} satisfies Record<string, MatchFixer>;

/** The named findings filters of the date rule of grammar/rules/ar_SA.yaml (`filter:`). */
export const FILTERS = {
  /**
   * The ISO date findings come after the date and year frames. A date-order finding that
   * starts in an earlier finding is dropped.
   */
  isoDatesAndOrder: (ctx, findings) => {
    if (ctx.rules && !ctx.rules.has("arabicDates")) return findings;
    const split = findings.findIndex((f) => f.messageKey === "review_msg_arabic_date_order");
    const kept = split < 0 ? [...findings] : findings.slice(0, split);
    for (const range of invalidIsoDates(ctx))
      kept.push({
        ruleId: "arabicDates",
        messageKey: "review_msg_arabic_impossible_date",
        range,
        alternatives: [],
        warningOnly: true,
      });
    for (const f of split < 0 ? [] : findings.slice(split))
      if (!kept.some((k) => k.range.start <= f.range.start && f.range.start < k.range.end))
        kept.push(f);
    return kept;
  },
} satisfies Record<string, FindingsFilter>;
