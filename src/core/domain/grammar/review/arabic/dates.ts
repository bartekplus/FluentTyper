import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding } from "../reviewDetectors";

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
const MONTH_NUMBER = new Map(
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
const MONTH = alternation(MONTH_NUMBER.keys());
const WEEKDAY = alternation(WEEKDAY_NUMBER.keys());
const DIGIT = "[0-9٠-٩۰-۹]";
const NOT_WORD = "(?![\\p{L}\\p{M}\\p{N}])";
const START = "(?<![\\p{L}\\p{M}\\p{N}])";
const SEP = "[ \\t\\u00a0]*[/.-][ \\t\\u00a0]*";
const GAP = "[ \\t\\u00a0]+";

/** "١٢" -> 12. */
const number = (digits: string) =>
  Number(
    digits
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)),
  );

const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const monthLength = (month: number, year?: number) =>
  month === 2
    ? year === undefined || leap(year)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

// A day, then a month name (any separator) or a month number (/ - . and a year).
const DATE = new RegExp(
  `${START}(?:(?<weekday>${WEEKDAY})${GAP}(?:،[ \\t\\u00a0]*)?)?(?<day>${DIGIT}{1,2})(?:(?:${GAP}|${SEP})(?<monthName>${MONTH})|${SEP}(?<monthDigits>${DIGIT}{1,2})(?=${SEP}${DIGIT}))(?:(?:${GAP}|${SEP})(?<year>${DIGIT}{2,4}))?${NOT_WORD}`,
  "gu",
);
const LONG_YEAR = new RegExp(
  `${START}(?:ل?(?:ال)?(?:عام|سنة)|صيف|شتاء|ربيع|خريف)${GAP}(?<year>${DIGIT}{5,})${NOT_WORD}`,
  "gu",
);
// Year first or month first: Arabic dates run day, month, year.
const ORDER = [
  {
    regex: new RegExp(
      `${START}(?<y>${DIGIT}{4})${GAP}(?<m>${MONTH})${GAP}(?<d>${DIGIT}{1,2})${NOT_WORD}`,
      "gu",
    ),
    fix: (g: Record<string, string>, gap: string) => `${g.d}${gap}${g.m}${gap}${g.y}`,
  },
  {
    regex: new RegExp(
      `${START}(?<m>${MONTH})${GAP}(?<d>${DIGIT}{1,2})${GAP}(?<w>${WEEKDAY})${NOT_WORD}`,
      "gu",
    ),
    fix: (g: Record<string, string>, gap: string) => `${g.w}${gap}${g.d}${gap}${g.m}`,
  },
  {
    regex: new RegExp(
      `${START}(?<m>${MONTH})${GAP}(?<d>${DIGIT}{1,2})${GAP}(?<y>${DIGIT}{4})${NOT_WORD}`,
      "gu",
    ),
    fix: (g: Record<string, string>, gap: string) => `${g.d}${gap}${g.m}${gap}${g.y}`,
  },
  {
    regex: new RegExp(
      `${START}(?<y>${DIGIT}{4})${GAP}(?<m>${MONTH})(?![\\p{L}\\p{M}\\p{N}]|${GAP}${DIGIT})`,
      "gu",
    ),
    fix: (g: Record<string, string>, gap: string) => `${g.m}${gap}${g.y}`,
  },
];

// A day or month out of range is a date only in a full date: "15/13/2024", "32 يناير".
// Versions, scores, ranges and IDs are not dates: "1.13.40", "3-13", "10-32", "12-45-2024-7".
const FULL_NUMERIC = new RegExp(
  `${DIGIT}{1,2}(?<a>${SEP})${DIGIT}{1,2}(?<b>${SEP})(?:[12١٢۱۲]${DIGIT}{3})$`,
  "u",
);
const NUMBER_BEFORE = new RegExp(`(?:${DIGIT}${SEP}|#[ \\t\\u00a0]*)$`, "u");
const NUMBER_AFTER = new RegExp(`^${SEP}${DIGIT}`, "u");
const ID_CUE =
  /(?:الإصدار|إصدار|الاصدار|اصدار|النسخة|نسخة|التحديث|تحديث|رقم|الرقم|هاتف|الهاتف|كود|الكود|رمز|الرمز|version|(?<!\p{L})v)[ \t\u00a0:]*$/iu;

function fullDate(text: string, m: RegExpExecArray): boolean {
  const before = text.slice(Math.max(0, m.index - 24), m.index);
  const after = text.slice(m.index + m[0].length);
  if (NUMBER_BEFORE.test(before) || NUMBER_AFTER.test(after) || ID_CUE.test(before)) return false;
  if (m.groups!.monthName) return true;
  const numeric = FULL_NUMERIC.exec(m[0]);
  return !!numeric && numeric.groups!.a.trim() === numeric.groups!.b.trim();
}

function* owned(ctx: DetectContext, regex: RegExp): Generator<RegExpExecArray> {
  regex.lastIndex = Math.max(0, ctx.from - 64);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (m.index >= ctx.from && !namedExampleBefore(ctx.text, m.index)) yield m;
  }
}

/**
 * Dates that cannot exist (31 September, 29 February 2001), a weekday that
 * does not fall on its date, a five-digit year, and dates written year or
 * month first.
 */
export function arabicDates(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of owned(ctx, DATE)) {
    const { weekday, day, monthName, monthDigits, year } = m.groups!;
    const d = number(day);
    const month = monthName ? MONTH_NUMBER.get(monthName)! : number(monthDigits);
    const y = year === undefined ? undefined : number(year);
    const outOfRange = d < 1 || d > 31 || month < 1 || month > 12;
    if (outOfRange && !fullDate(ctx.text, m)) continue;
    const fullYear = y !== undefined && year.length === 4 ? y : undefined;
    const range = { start: m.index, end: m.index + m[0].length };
    if (outOfRange || d > monthLength(month, fullYear)) {
      findings.push({
        messageKey: "review_msg_arabic_impossible_date",
        range,
        alternatives: [],
        warningOnly: true,
      });
      continue;
    }
    if (weekday && fullYear !== undefined) {
      const actual = new Date(Date.UTC(fullYear, month - 1, d)).getUTCDay();
      if (actual !== WEEKDAY_NUMBER.get(weekday))
        findings.push({
          messageKey: "review_msg_arabic_weekday_mismatch",
          range,
          alternatives: [],
          warningOnly: true,
        });
    }
  }
  for (const m of owned(ctx, LONG_YEAR)) {
    const start = m.index + m[0].length - m.groups!.year.length;
    findings.push({
      messageKey: "review_msg_arabic_impossible_date",
      range: { start, end: m.index + m[0].length },
      alternatives: [],
      warningOnly: true,
    });
  }
  const covered = (start: number) =>
    findings.some((f) => f.range.start <= start && start < f.range.end);
  for (const { regex, fix } of ORDER) {
    for (const m of owned(ctx, regex)) {
      if (covered(m.index)) continue;
      const gap = /[ \t\u00a0]+/.exec(m[0])![0];
      findings.push({
        messageKey: "review_msg_arabic_date_order",
        range: { start: m.index, end: m.index + m[0].length },
        alternatives: [fix(m.groups!, gap)],
      });
    }
  }
  return findings;
}
