import type { DetectContext, RawFinding } from "../reviewDetectors";
import { caseLike, findingAt, isPl, owned } from "./shared";

/*
 * Dates: a day the month does not have ("31 września", "29 lutego 2023"), a
 * weekday that does not fall on the date, a range that runs backwards, and the
 * month's form after a day number ("1 stycznia", not "1 styczeń", "1. stycznia"
 * or the English-style "1 Sty").
 */

const RULE = "polishDates" as const;

const GENITIVE = [
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

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function daysIn(month: number, year?: number): number {
  if (month === 2) return year === undefined || isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
const monthOf = (word: string): number => {
  const lower = word.toLowerCase();
  const roman = ROMAN.indexOf(word.toUpperCase());
  if (/^[ivx]+$/i.test(word) && roman >= 0) return roman + 1;
  const genitive = GENITIVE.indexOf(lower);
  return genitive >= 0 ? genitive + 1 : NOMINATIVE.indexOf(lower) + 1;
};

// "27 sierpnia 2014", "27 VIII 2014", "31 września", and dotted "27.08.2014".
const MONTH_WORD = `${GENITIVE.join("|")}|${NOMINATIVE.join("|")}|${ROMAN.slice().reverse().join("|")}`;
const DATE = new RegExp(
  `(?<![\\p{L}\\p{N}.,/-])(?:(?<day>\\d{1,2})[ \\t\\u00a0]+(?<mword>${MONTH_WORD})(?:[ \\t\\u00a0]+(?<year>\\d{3,4})(?![\\p{N}]))?(?![\\p{L}\\p{N}])|(?<dday>\\d{1,2})\\.(?<dmonth>\\d{1,2})\\.(?<dyear>\\d{4})(?![\\p{N}]|\\.\\p{N}))`,
  "giu",
);

function weekdayOf(word: string): number | null {
  const bare = word.replace(/\.$/, "");
  for (const [regex, day] of WEEKDAYS) if (regex.test(bare)) return day;
  return null;
}

function impossibleDates(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, DATE)) {
    const { mword, dmonth } = m.groups!;
    const day = m.groups!.day ?? m.groups!.dday;
    const year = m.groups!.year ?? m.groups!.dyear;
    // A Roman month needs a year, or it may be a chapter or a list number.
    if (mword && /^[IVX]+$/.test(mword) && !year) continue;
    if (mword && /^[ivx]+$/.test(mword)) continue;
    const month = mword ? monthOf(mword) : Number(dmonth);
    const y = year ? Number(year) : undefined;
    const d = Number(day);
    const start = m.index;
    const end = start + m[0].length;
    if (month < 1 || month > 12 || d < 1 || d > daysIn(month, y)) {
      findings.push(findingAt(ctx, start, end, [], RULE, "review_msg_pl_impossible_date"));
      continue;
    }
    if (y === undefined) continue;
    // A weekday right before ("wtorek, 27 sierpnia 2014") or after ("…2014, wtorek", "(wtorek)").
    const weekday = new Date(Date.UTC(y, month - 1, d)).getUTCDay();
    const before = new RegExp(
      `(?<![\\p{L}])(?<w>${WEEKDAY})[ \\t\\u00a0]*,?[ \\t\\u00a0]*$`,
      "iu",
    ).exec(ctx.text.slice(Math.max(0, start - 24), start));
    const after = new RegExp(
      `^[ \\t\\u00a0]*[,(][ \\t\\u00a0]*(?<w>${WEEKDAY})(?![\\p{L}])`,
      "iu",
    ).exec(ctx.text.slice(end, end + 24));
    const named = before ?? after;
    if (!named) continue;
    const said = weekdayOf(named.groups!.w);
    if (said === null || said === weekday) continue;
    const wStart = before ? start - before[0].length : end;
    const wEnd = before ? end : end + after![0].length;
    findings.push(
      findingAt(ctx, Math.max(0, wStart), wEnd, [], RULE, "review_msg_pl_weekday_date"),
    );
  }
  return findings;
}

// "11–1 lutego", "od 11 do 1 lutego": the range ends before it starts.
const DAY_RANGE = new RegExp(
  `(?<![\\p{L}\\p{N}.,/-])(?<a>\\d{1,2})(?:[ \\t\\u00a0]*[–—-][ \\t\\u00a0]*|[ \\t\\u00a0]+do[ \\t\\u00a0]+)(?<b>\\d{1,2})[ \\t\\u00a0]+(?:${GENITIVE.join("|")}|${ROMAN.slice().reverse().join("|")})(?![\\p{L}])`,
  "giu",
);
// "1915–1840", "1855–40": a year range that runs backwards or repeats.
const YEAR_RANGE =
  /(?<![\p{L}\p{N}.,/-])(?<a>\d{3,4})[ \t ]*[–—-][ \t ]*(?<b>\d{1,4})(?![\p{N}.,]\d|[\p{L}\p{N}-])/gu;

function backwardRanges(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, DAY_RANGE)) {
    if (Number(m.groups!.a) >= Number(m.groups!.b))
      findings.push(
        findingAt(ctx, m.index, m.index + m[0].length, [], RULE, "review_msg_pl_impossible_date"),
      );
  }
  for (const m of owned(ctx, YEAR_RANGE)) {
    const { a, b } = m.groups!;
    // "1962 – 272 000" is a count; years before Christ run backwards ("1814-1781 p.n.e.").
    if (b.length !== a.length && b.length > 2) continue;
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (
      /^[ \t\u00a0]*(?:\d|p\.?[ \t\u00a0]*n\.?[ \t\u00a0]*e|przed[ \t\u00a0]+(?:naszą|Chrystusem)|BC)/iu.test(
        after,
      )
    )
      continue;
    // Only in a year context: "w latach", "w okresie", "lata".
    const before = ctx.text.slice(Math.max(0, m.index - 16), m.index);
    if (!/(?:latach|lata|okresie|sezonie|rok\p{L}*|w|od)[ \t ]+$/iu.test(before)) continue;
    const start = Number(a);
    const endYear = b.length < a.length ? Number(a.slice(0, a.length - b.length) + b) : Number(b);
    if (endYear > start) continue;
    findings.push(
      findingAt(ctx, m.index, m.index + m[0].length, [], RULE, "review_msg_pl_impossible_date"),
    );
  }
  return findings;
}

// "1 styczeń 2000", "Pierwszy styczeń": the month after a day is in the genitive.
const NOMINATIVE_MONTH = new RegExp(
  `(?<![\\p{L}\\p{N}.,/-])(?<day>\\d{1,2}|pierwszy|drugi|trzeci|czwarty|piąty)(?<dot>\\.)?(?<sp>[ \\t\\u00a0]+)(?<month>${NOMINATIVE.join("|")}|${GENITIVE.join("|")})(?![\\p{L}])`,
  "giu",
);

function monthForms(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, NOMINATIVE_MONTH)) {
    const { day, dot, sp, month } = m.groups!;
    const index = NOMINATIVE.indexOf(month.toLowerCase());
    const spelled = /^\p{L}/u.test(day);
    // "Maj" capitalized after "1" names the holiday; "w maju" etc. never reach here.
    if (index >= 0 && /^\p{Lu}/u.test(month)) continue;
    if (index < 0 && !dot) continue;
    if (spelled && (dot || index < 0)) continue;
    const genitive = index >= 0 ? GENITIVE[index] : month.toLowerCase();
    if (dot) {
      // "1. stycznia": no dot after the day before a month name.
      const fixed = `${day}${sp}${genitive}`;
      findings.push(
        findingAt(ctx, m.index, m.index + m[0].length, [fixed], RULE, "review_msg_pl_month_form"),
      );
      continue;
    }
    const start = m.index + day.length + sp.length;
    findings.push(
      findingAt(
        ctx,
        start,
        start + month.length,
        [caseLike(month, genitive)],
        RULE,
        "review_msg_pl_month_form",
      ),
    );
  }
  return findings;
}

// "21 Sty 2012": an English-style month abbreviation between day and year.
const ABBREVIATED_MONTH = new RegExp(
  `(?<![\\p{L}\\p{N}.,/-])(?<day>\\d{1,2})(?<sp1>[ \\t\\u00a0]+)(?<month>${ABBREVIATED.join("|")})\\.?(?<sp2>[ \\t\\u00a0]+)(?<year>\\d{4})(?![\\p{L}\\p{N}])`,
  "giu",
);

function abbreviatedMonths(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, ABBREVIATED_MONTH)) {
    const { day, month, year } = m.groups!;
    const index = ABBREVIATED.indexOf(month.toLowerCase());
    // "1 maj 2012" is the nominative month, which monthForms puts in the genitive.
    if (month === "maj") continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + m[0].length,
        [`${day} ${ROMAN[index]} ${year}`, `${day} ${GENITIVE[index]} ${year}`],
        RULE,
        "review_msg_pl_month_form",
      ),
    );
  }
  return findings;
}

/*
 * Decades are written with the decade and the century: "lata 90. XX w.", not
 * "lata 1990." (an English calque), and a year takes no apostrophe ("lata '90").
 */
const DECADE_WORDS = "lata|lat|latach|latami|latom";
const FULL_DECADE = new RegExp(
  `(?<=(?:^|[^\\p{L}])(?:${DECADE_WORDS})[ \\t\\u00a0]{1,8})(?<year>1\\d[1-9]0|20[1-9]0)\\.`,
  "giu",
);
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
const APOSTROPHE_YEAR = new RegExp(
  `(?<![\\p{L}\\p{N}])(?<mark>['’])(?<year>\\d{4}|\\d{2})(?![\\p{L}\\p{N}'’])`,
  "gu",
);

function decades(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, FULL_DECADE)) {
    const year = Number(m.groups!.year);
    const century = ROMAN_CENTURY[Math.floor(year / 100) + 1];
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + m[0].length,
        [`${String(year % 100).padStart(2, "0")}. ${century} w.`],
        RULE,
        "review_msg_pl_decade",
      ),
    );
  }
  for (const m of owned(ctx, APOSTROPHE_YEAR)) {
    const { year } = m.groups!;
    // "Euro '2012": a full year needs no apostrophe; "lata '90" is the decade "90.".
    const before = ctx.text.slice(Math.max(0, m.index - 12), m.index);
    let fixed: string | null = null;
    if (year.length === 4) fixed = year;
    else if (new RegExp(`(?:^|[^\\p{L}])(?:${DECADE_WORDS})[ \\t\\u00a0]+$`, "iu").test(before))
      fixed = /^[ \t ]*[.]/u.test(ctx.text.slice(m.index + m[0].length)) ? year : `${year}.`;
    if (!fixed) continue;
    findings.push(
      findingAt(ctx, m.index, m.index + m[0].length, [fixed], RULE, "review_msg_pl_decade"),
    );
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [RULE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) =>
      isPl(ctx)
        ? [
            ...impossibleDates(ctx),
            ...backwardRanges(ctx),
            ...monthForms(ctx),
            ...abbreviatedMonths(ctx),
            ...decades(ctx),
          ]
        : [],
  },
];
