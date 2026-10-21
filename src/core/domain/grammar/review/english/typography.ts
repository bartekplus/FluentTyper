import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer, MatchResult } from "../../engine/reviewRules";
import { namedExampleBefore } from "../exampleCues";
import { finding } from "../finding";

// English notation and typography.
// englishNotation (on by default): decimal commas and European digit groups in English numbers,
// a split ordinal ("8 th"), full-width marks, an initialism missing its last period ("U.S.A"),
// and academic degrees ("PH.D", "B. Sc.").
// englishTypography (optional): the typographer's symbols for what a keyboard approximates:
// × for x, → for ->, © for (c), ± for +-, H₀, curly double quotes and dashes in ranges.

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

const notationFinding = (
  ruleId: Rule,
  messageKey: MessageKey,
  start: number,
  end: number,
  alternatives: string[],
): Finding =>
  finding(ruleId, messageKey, start, end, alternatives, {
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  });

/**
 * A fixer of an owned scan that starts 64 characters before the chunk: a match that starts
 * before the chunk, or inside a named example, gives no finding.
 */
const owned =
  (fix: (m: RegExpExecArray, ctx: DetectContext) => MatchResult): MatchFixer =>
  (m, ctx) =>
    m.index < ctx.from || namedExampleBefore(ctx.text, m.index) ? null : fix(m, ctx);

// ---------------------------------------------------------------------------- englishNotation

const MEASURES = new Set(
  (
    "seconds minutes hours days meters metres grams liters litres miles kilometers kilometres " +
    "inches feet pounds ounces degrees volts amps watts points percent units years"
  ).split(" "),
);
const FULL_WIDTH_ASCII: Record<string, string> = { "？": "?", "！": "!" };

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

/** An englishNotation finding on the whole match. */
const whole = (m: RegExpExecArray, key: MessageKey, alternatives: string[]): Finding =>
  notationFinding("englishNotation", key, m.index, m.index + m[0].length, alternatives);

// ---------------------------------------------------------------------------- englishTypography

const ARROWS: Record<string, string> = {
  "-->": "→",
  "->": "→",
  "<-": "←",
  "<->": "↔",
  "<=>": "⇔",
  "=>": "⇒",
};
const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
const typographic = (key: MessageKey, start: number, end: number, alternatives: string[]) =>
  notationFinding("englishTypography", key, start, end, alternatives);

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  decimalComma: owned((m) => {
    const g = m.groups!;
    const fixed = g.sign ? `${g.sign}${g.a}.${g.b}` : `${g.c}.${g.d}`;
    return whole(m, "review_msg_english_decimal", [fixed]);
  }),
  dotGroups: owned((m) => {
    const groups = m[0].split(/[.,]/);
    // "192.168.100.200" is an address.
    if (!m[0].includes(",") && groups.length === 4 && groups.every((x) => Number(x) <= 255))
      return null;
    const fixed = m[0].replace(/,/, "#").replace(/\./g, ",").replace("#", ".");
    return whole(m, "review_msg_english_digit_groups", [fixed]);
  }),
  dotDecimal: owned((m) =>
    whole(m, "review_msg_english_digit_groups", [
      m[0].replace(".", ",").replace(/,(\d{1,2})$/, ".$1"),
    ]),
  ),
  dotThousand: owned((m) => {
    const noun = m[2];
    if (MEASURES.has(noun) || !englishWordInfo(noun)?.plural) return null;
    return whole(m, "review_msg_english_digit_groups", [`${m[1]},000`]);
  }),
  ordinalSplit: owned((m) =>
    ordinalSuffix(Number(m[1])) === m[2]
      ? whole(m, "review_msg_ordinal", [`${m[1]}${m[2]}`])
      : null,
  ),
  fullWidthMark: owned((m) =>
    notationFinding("englishNotation", "review_msg_full_width_mark", m.index, m.index + 1, [
      FULL_WIDTH_ASCII[m[0]],
    ]),
  ),
  initialism: owned((m) =>
    whole(
      m,
      "review_msg_initialism_period",
      /[A-Z]/.test(m[0]) ? [`${m[0]}.`, m[0].replace(/\./g, "")] : [`${m[0]}.`],
    ),
  ),
  phd: owned((m) => {
    const { core } = m.groups!;
    // "PhD." ends its sentence; "Ph. D", "PH.D" are the dotted form.
    const dotted = /[. ]/.test(core);
    if (dotted ? m[0] === "Ph.D." : core === "PhD") return null;
    const end = m.index + (dotted ? m[0].length : core.length);
    return notationFinding("englishNotation", "review_msg_degree_abbreviation", m.index, end, [
      dotted ? "Ph.D." : "PhD",
    ]);
  }),
  degree: owned((m, ctx) => {
    const fixed = `${m.groups!.l}.${m.groups!.d}.`;
    if (m[0] === fixed) return null;
    // "B.Sc" at a sentence end keeps the sentence's period.
    const end = m.index + m[0].length;
    if (!m[0].endsWith(".") && !m[0].includes(" ") && ctx.text[end] === ".") return null;
    return whole(m, "review_msg_degree_abbreviation", [fixed]);
  }),
  dottedDegree: owned((m) => {
    const d = m.groups!.d;
    const dotted = d.replace(/^([A-Z])([A-Z]?[a-z]*)([A-Z])?$/, (_, a, b, c) =>
      c ? `${a}.${b}.${c}.` : `${a}.${b}.`,
    );
    return whole(m, "review_msg_degree_abbreviation", [d, dotted]);
  }),
  spacedAbbreviation: owned((m) =>
    whole(m, "review_msg_initialism_period", [m[0].replace(/[  ]/g, "")]),
  ),
  dateComma: owned((m) => {
    const at = (name: string) => m.indices!.groups![name]?.[0];
    const glued = at("glued");
    const monthComma = at("monthComma");
    const gap = at("dayGap") ?? at("weekGap");
    const add = (start: number, alternatives: string[]) =>
      notationFinding("englishNotation", "review_msg_date_comma", start, start + 1, alternatives);
    if (glued !== undefined) return add(glued, [", "]);
    if (monthComma !== undefined) return add(monthComma, [""]);
    return gap !== undefined ? add(gap, [", "]) : null;
  }),
  clockOclock: owned((m) => {
    const { h, mm } = m.groups!;
    return whole(
      m,
      "review_msg_oclock",
      mm === "00" ? [`${h}:00`, `${h} o'clock`] : [`${h}:${mm}`],
    );
  }),
  timesSign: owned((m) => {
    const { a, op } = m.groups!;
    // "0x1F" is hexadecimal.
    if (a === "0" && op === "x") return null;
    const start = m.index + a.length;
    return typographic("review_msg_typographic_symbol", start, start + op.length, [
      op.replace(/[xX*]/g, "×").includes(" ") ? " × " : "×",
    ]);
  }),
  arrowSign: owned((m) =>
    typographic("review_msg_typographic_symbol", m.index, m.index + m[0].length, [ARROWS[m[0]]]),
  ),
  legalSign: owned((m, ctx) => {
    const { pre, s } = m.groups!;
    const start = m.index + (pre?.length ?? 0);
    const before = ctx.text[start - 1] ?? "";
    const upper = s.toUpperCase();
    // "(c)" is a list item unless it follows "Copyright" or precedes a year.
    if (upper === "(C)" && !pre && !/^[  ]?(?:1[89]|20)\d\d\b/.test(ctx.text.slice(start + 3)))
      return null;
    // "(a) …, (b) …, (c) 2014 itens": after "(b)" a "(c)" is a list item.
    if (s === "(c)" && /\([bB]\)/.test(ctx.text.slice(Math.max(0, start - 80), start))) return null;
    // "Burr (D) and Hagan (R)": party letters after names.
    if (s === "(R)" && /\([DI]\)/.test(ctx.text.slice(Math.max(0, start - 80), start))) return null;
    // "(R)" and "(TM)" mark a name right before them.
    if (upper !== "(C)" && (!/[\p{L}\p{N} ]/u.test(before) || s === "(tm)" || s === "(r)"))
      return null;
    if (
      upper === "(R)" &&
      !/\p{Lu}[\p{L}]*[  ]?$/u.test(ctx.text.slice(Math.max(0, start - 24), start))
    )
      return null;
    const sign = upper === "(C)" ? "©" : upper === "(R)" ? "®" : "™";
    return typographic("review_msg_typographic_symbol", start, start + s.length, [sign]);
  }),
  plusMinus: owned((m) =>
    typographic("review_msg_typographic_symbol", m.index, m.index + m[0].length, ["±"]),
  ),
  hypothesis: owned((m) =>
    typographic("review_msg_typographic_symbol", m.index, m.index + 2, [
      `H${SUBSCRIPTS[Number(m.groups!.n)]}`,
    ]),
  ),
  // „…“ is German; English opens with “ and closes with ”. A “ after a „ on its line closes it.
  // Straight quotes stay: they are just as correct, and often code.
  lowQuote: owned((m, ctx) => {
    const opened = ctx.text.lastIndexOf("„", m.index);
    if (m[0] === "„") return typographic("review_msg_english_quotes", m.index, m.index + 1, ["“"]);
    return opened > ctx.text.lastIndexOf("\n", m.index) &&
      opened > ctx.text.lastIndexOf("”", m.index)
      ? typographic("review_msg_english_quotes", m.index, m.index + 1, ["”"])
      : null;
  }),
  /** "1901 - 1978", "1990-1995": a range of numbers takes an en dash. */
  numberRangeDash: owned((m) => {
    const { spaced, joined, y1, y2 } = m.groups!;
    if (joined && Number(y2) <= Number(y1)) return null;
    const dash = spaced ?? joined;
    const start = m.index + m[0].indexOf(dash);
    return typographic("review_msg_range_dash", start, start + dash.length, ["–"]);
  }),
  nameRangeDash: owned((m) =>
    typographic("review_msg_range_dash", m.index, m.index + m[0].length, ["–"]),
  ),
  spacedHyphen: owned((m) =>
    typographic("review_msg_typed_dash", m.index, m.index + 3, ["—", " — "]),
  ),
} satisfies Record<string, MatchFixer>;
