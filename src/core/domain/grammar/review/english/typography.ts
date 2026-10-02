import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { namedExampleBefore } from "../exampleCues";
import { quotedMention } from "./grammarStyle1";

// English notation and typography.
// englishNotation (on by default): decimal commas and European digit groups in English numbers,
// a split ordinal ("8 th"), full-width marks, an initialism missing its last period ("U.S.A"),
// and academic degrees ("PH.D", "B. Sc.").
// englishTypography (optional): the typographer's symbols for what a keyboard approximates:
// × for x, → for ->, © for (c), ± for +-, H₀, curly double quotes and dashes in ranges.

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

type Finding = RawFinding;

/**
 * Prose tokens that look technical but are notation englishNotation reads: "U.S.A", "e.g",
 * "32.500.000", "32.000,23", "PH.D". Written complete ("e.g.", "U.S.A.") they stay protected.
 */
const NOTATION_TOKEN =
  /^(?:(?:[A-Z]\.){1,4}[A-Z]|e\.g|i\.e|a\.k\.a|\d{1,3}(?:\.\d{3}){1,3}(?:,\d{1,2})?|P[Hh]\.D|[BM]\.(?:Sc|Eng|Ed|Phil|Arch|Com|Tech))$/;
export const notationToken = (source: string, start: number, bare: string) =>
  NOTATION_TOKEN.test(bare) && (/\d$/.test(bare) || source[start + bare.length] !== ".");
type Rule = "englishNotation" | "englishTypography";
type MessageKey = RawFinding["messageKey"];

/** Matches of a global regex starting in [from, to), scanned from shortly before `from`. */
function* owned(ctx: DetectContext, regex: RegExp, lookback = 64): Generator<RegExpExecArray> {
  regex.lastIndex = Math.max(0, ctx.from - lookback);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (m[0] === "") regex.lastIndex += 1;
    if (m.index >= ctx.from && !namedExampleBefore(ctx.text, m.index)) yield m;
  }
}
const finding = (
  ruleId: Rule,
  messageKey: MessageKey,
  start: number,
  end: number,
  alternatives: string[],
): Finding => ({
  ruleId,
  messageKey,
  range: { start, end },
  alternatives,
  ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
});

// ---------------------------------------------------------------------------- englishNotation

const UNIT =
  "%|‰|percent|per cent|million|billion|trillion|thousand|[KMGT]B|kg|g|mg|km|m|cm|mm|ml|l|°";
// "12,5%", "$12,50", "2,5 million": a decimal comma before a unit or after a currency sign.
const DECIMAL_COMMA = new RegExp(
  `(?<![\\p{N}.,])(?:(?<sign>[$£€])(?<a>\\d{1,3}),(?<b>\\d{1,2})|(?<c>\\d{1,3}),(?<d>\\d{1,2})(?=[ \\u00a0]?(?:${UNIT})(?![\\p{L}\\p{N}])))(?![\\p{N},]|\\.\\p{N})`,
  "gu",
);
// "32.500.000", "32.000,23": dots between digit groups and a comma before the decimals.
const DOT_GROUPS = /(?<![\p{N}.,])\d{1,3}(?:\.\d{3}){2,3}(?:,\d{1,2})?(?![\p{N}]|[.,]\p{N})/gu;
const DOT_DECIMAL = /(?<![\p{N}.,])\d{1,3}\.\d{3},\d{1,2}(?![\p{N}]|[.,]\p{N})/gu;
// "32.000 users": a whole thousand before a counted noun.
const DOT_THOUSAND = /(?<![\p{N}.,])(\d{1,3})\.000(?=[  ]+([a-z]+)(?![\p{L}]))/gu;
const MEASURES = new Set(
  (
    "seconds minutes hours days meters metres grams liters litres miles kilometers kilometres " +
    "inches feet pounds ounces degrees volts amps watts points percent units years"
  ).split(" "),
);
const ORDINAL_SPLIT = /(?<![\p{N}.,])(\d{1,4})[  ](st|nd|rd|th)(?![\p{L}\p{N}])/gu;
// The full-width comma is commaPeriodSpacing's.
const FULL_WIDTH = /(?<=[A-Za-z])[？！]/gu;
const FULL_WIDTH_ASCII: Record<string, string> = { "？": "?", "！": "!" };
// "U.S.A", "e.g": an initialism that lost its last period.
const INITIALISM =
  /(?<![\p{L}\p{N}.'’@/\\_-])(?:[A-Z]\.){1,4}[A-Z](?![\p{L}\p{N}.'’@/\\_-])|(?<![\p{L}\p{N}.'’@/\\_-])(?:e\.g|i\.e|a\.k\.a)(?![\p{L}\p{N}.'’@/\\_-])/gu;
const PHD = /(?<![\p{L}.])(?<core>P[Hh](?:\. ?| )D|PHD|Phd|PhD)\.?(?![\p{L}])/gu;
const DEGREE = /(?<![\p{L}.])(?<l>[BM])\. ?(?<d>Sc|Eng|Ed|Phil|Arch|Com|Tech)\.?(?![\p{L}])/gu;
const DOTTED_DEGREE = /(?<![\p{L}.])(?<d>BSc|MSc|BEng|MEng|MPhil|DPhil|MBA)\.(?=[  ]+\p{Ll})/gu;

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

function notation(ctx: DetectContext): Finding[] {
  const out: Finding[] = [];
  const add = (key: MessageKey, start: number, end: number, alternatives: string[]) =>
    out.push(finding("englishNotation", key, start, end, alternatives));
  for (const m of owned(ctx, DECIMAL_COMMA)) {
    const g = m.groups!;
    const fixed = g.sign ? `${g.sign}${g.a}.${g.b}` : `${g.c}.${g.d}`;
    add("review_msg_english_decimal", m.index, m.index + m[0].length, [fixed]);
  }
  for (const m of owned(ctx, DOT_GROUPS)) {
    const groups = m[0].split(/[.,]/);
    // "192.168.100.200" is an address.
    if (!m[0].includes(",") && groups.length === 4 && groups.every((x) => Number(x) <= 255))
      continue;
    const fixed = m[0].replace(/,/, "#").replace(/\./g, ",").replace("#", ".");
    add("review_msg_english_digit_groups", m.index, m.index + m[0].length, [fixed]);
  }
  for (const m of owned(ctx, DOT_DECIMAL)) {
    const fixed = m[0].replace(".", ",").replace(/,(\d{1,2})$/, ".$1");
    add("review_msg_english_digit_groups", m.index, m.index + m[0].length, [fixed]);
  }
  for (const m of owned(ctx, DOT_THOUSAND)) {
    const noun = m[2];
    if (MEASURES.has(noun) || !englishWordInfo(noun)?.plural) continue;
    add("review_msg_english_digit_groups", m.index, m.index + m[0].length, [`${m[1]},000`]);
  }
  for (const m of owned(ctx, ORDINAL_SPLIT)) {
    if (ordinalSuffix(Number(m[1])) !== m[2]) continue;
    add("review_msg_ordinal", m.index, m.index + m[0].length, [`${m[1]}${m[2]}`]);
  }
  for (const m of owned(ctx, FULL_WIDTH)) {
    add("review_msg_full_width_mark", m.index, m.index + 1, [FULL_WIDTH_ASCII[m[0]]]);
  }
  for (const m of owned(ctx, INITIALISM)) {
    const end = m.index + m[0].length;
    const alternatives = /[A-Z]/.test(m[0]) ? [`${m[0]}.`, m[0].replace(/\./g, "")] : [`${m[0]}.`];
    add("review_msg_initialism_period", m.index, end, alternatives);
  }
  for (const m of owned(ctx, PHD)) {
    const { core } = m.groups!;
    // "PhD." ends its sentence; "Ph. D", "PH.D" are the dotted form.
    const dotted = /[. ]/.test(core);
    if (dotted ? m[0] === "Ph.D." : core === "PhD") continue;
    const end = m.index + (dotted ? m[0].length : core.length);
    add("review_msg_degree_abbreviation", m.index, end, [dotted ? "Ph.D." : "PhD"]);
  }
  for (const m of owned(ctx, DEGREE)) {
    const fixed = `${m.groups!.l}.${m.groups!.d}.`;
    if (m[0] === fixed) continue;
    // "B.Sc" at a sentence end keeps the sentence's period.
    const end = m.index + m[0].length;
    if (!m[0].endsWith(".") && !m[0].includes(" ") && ctx.text[end] === ".") continue;
    add("review_msg_degree_abbreviation", m.index, end, [fixed]);
  }
  for (const m of owned(ctx, DOTTED_DEGREE)) {
    const d = m.groups!.d;
    const dotted = d.replace(/^([A-Z])([A-Z]?[a-z]*)([A-Z])?$/, (_, a, b, c) =>
      c ? `${a}.${b}.${c}.` : `${a}.${b}.`,
    );
    add("review_msg_degree_abbreviation", m.index, m.index + m[0].length, [d, dotted]);
  }
  return out;
}

// ---------------------------------------------------------------------------- englishTypography

// "6.626 x 10⁻³⁴", "1920x1080", "5 * 2": numbers multiplied.
const TIMES = /(?<![\p{L}\p{N}.,])(?<a>\d+(?:[.,]\d+)?)(?<op>[  ]?[x*][  ]?)(?=\d)/gu;
const ARROW = /(?<=^|[ \t (])(?<a>-->|->|<-|<->|<=>|=>)(?=[ \t )]|$)/gmu;
const ARROWS: Record<string, string> = {
  "-->": "→",
  "->": "→",
  "<-": "←",
  "<->": "↔",
  "<=>": "⇔",
  "=>": "⇒",
};
const SIGNS = /(?<pre>Copyright[  ]+)?(?<s>\((?:c|C|R|TM|tm)\))/gu;
const PLUS_MINUS = /(?<=\d[  ]?)(?:\+-|-\+|\+\/-)(?=[  ]?\d)/gu;
const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
const HYPOTHESIS = /(?<=^|\n|[.!?][ \t]+)H(?<n>[0-9])(?=:[ \t])/gu;
const LOW_QUOTES = /[„“]/gu;
const RANGE_UNIT = "(?:[ \\u00a0]?(?:BC|AD|BCE|CE|am|pm|AM|PM))?";
// "1901 - 1978", "8am - 5pm", "30 BC - AD 284", "1990-1995": a range takes an en dash.
const NUMBER_RANGE = new RegExp(
  `(?<![\\p{L}\\p{N}.,/-])(?:\\d{1,4}${RANGE_UNIT}(?<spaced>[ \\u00a0]+-[ \\u00a0]+)(?:(?:AD|BC)[ \\u00a0])?\\d|(?<y1>1[5-9]\\d\\d|20\\d\\d)(?<joined>-)(?<y2>1[5-9]\\d\\d|20\\d\\d)(?![\\p{N}-]))`,
  "gu",
);
const DAY_NAMES =
  "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December";
const NAME_RANGE = new RegExp(
  `(?<=\\b(?:${DAY_NAMES}))(?:[ \\u00a0]+-[ \\u00a0]+|-)(?=(?:${DAY_NAMES})\\b)`,
  "gu",
);
// "different - like": a spaced hyphen between words is a dash.
const SPACED_HYPHEN = /(?<=\p{Ll}) - (?=\p{Ll})/gu;

function typography(ctx: DetectContext): Finding[] {
  const out: Finding[] = [];
  const add = (key: MessageKey, start: number, end: number, alternatives: string[]) =>
    out.push(finding("englishTypography", key, start, end, alternatives));
  for (const m of owned(ctx, TIMES)) {
    const { a, op } = m.groups!;
    // "0x1F" is hexadecimal.
    if (a === "0" && op === "x") continue;
    const start = m.index + a.length;
    add("review_msg_typographic_symbol", start, start + op.length, [
      op.replace(/[x*]/, "×").includes(" ") ? " × " : "×",
    ]);
  }
  for (const m of owned(ctx, ARROW)) {
    add("review_msg_typographic_symbol", m.index, m.index + m[0].length, [ARROWS[m[0]]]);
  }
  for (const m of owned(ctx, SIGNS)) {
    const { pre, s } = m.groups!;
    const start = m.index + (pre?.length ?? 0);
    const before = ctx.text[start - 1] ?? "";
    const upper = s.toUpperCase();
    // "(c)" is a list item unless it follows "Copyright" or precedes a year.
    if (upper === "(C)" && !pre && !/^[  ]?(?:1[89]|20)\d\d\b/.test(ctx.text.slice(start + 3)))
      continue;
    // "(R)" and "(TM)" mark a name right before them.
    if (upper !== "(C)" && (!/[\p{L}\p{N} ]/u.test(before) || s === "(tm)" || s === "(r)"))
      continue;
    if (
      upper === "(R)" &&
      !/\p{Lu}[\p{L}]*[  ]?$/u.test(ctx.text.slice(Math.max(0, start - 24), start))
    )
      continue;
    const sign = upper === "(C)" ? "©" : upper === "(R)" ? "®" : "™";
    add("review_msg_typographic_symbol", start, start + s.length, [sign]);
  }
  for (const m of owned(ctx, PLUS_MINUS)) {
    add("review_msg_typographic_symbol", m.index, m.index + m[0].length, ["±"]);
  }
  for (const m of owned(ctx, HYPOTHESIS)) {
    add("review_msg_typographic_symbol", m.index, m.index + 2, [
      `H${SUBSCRIPTS[Number(m.groups!.n)]}`,
    ]);
  }
  // „…“ is German; English opens with “ and closes with ”. A “ after a „ on its line closes it.
  // Straight quotes stay: they are just as correct, and often code.
  for (const m of owned(ctx, LOW_QUOTES)) {
    const opened = ctx.text.lastIndexOf("„", m.index);
    if (m[0] === "„") add("review_msg_english_quotes", m.index, m.index + 1, ["“"]);
    else if (
      opened > ctx.text.lastIndexOf("\n", m.index) &&
      opened > ctx.text.lastIndexOf("”", m.index)
    )
      add("review_msg_english_quotes", m.index, m.index + 1, ["”"]);
  }
  for (const m of owned(ctx, NUMBER_RANGE)) {
    const { spaced, joined, y1, y2 } = m.groups!;
    if (joined && Number(y2) <= Number(y1)) continue;
    const dash = spaced ?? joined;
    const start = m.index + m[0].indexOf(dash);
    add("review_msg_range_dash", start, start + dash.length, ["–"]);
  }
  for (const m of owned(ctx, NAME_RANGE)) {
    add("review_msg_range_dash", m.index, m.index + m[0].length, ["–"]);
  }
  for (const m of owned(ctx, SPACED_HYPHEN)) {
    add("review_msg_typed_dash", m.index, m.index + 3, ["—", " — "]);
  }
  return out;
}

/** English only; findings inside a quoted or parenthesized example are dropped. */
const english =
  (detect: (ctx: DetectContext) => Finding[], keepQuoted = false) =>
  (ctx: DetectContext): Finding[] =>
    ctx.lang !== "en_US" ? [] : detect(ctx).filter((f) => keepQuoted || !quotedMention(ctx, f));

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishNotation"], detect: english(notation) },
  { rules: ["englishTypography"], detect: english(typography, true) },
];
