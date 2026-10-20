import { namedExampleBefore } from "../exampleCues";
import type { Detector, FindingsFilter, MatchFixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { ReviewMessageKey } from "../types";
import { germanNounReading } from "./germanLexicon";
import { isGerman, likeTyped } from "./shared";
import { finding } from "../finding";
import { rangeDashes } from "../rangeDash";

// German numbers written in words: one word up to a million ("sechs und zwanzig" →
// "sechsundzwanzig", "drei hundert" → "dreihundert", "acht mal" → "achtmal", "zwei an halb"
// → "zweieinhalb"), lowercase as numbers ("bis Drei zählen" → "drei"), and a plural noun
// after a plural number ("zwei Million" → "Millionen", "viele Möglichkeit" → "Möglichkeiten").

const UNITS = "ein|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun";
const TEENS = "zehn|elf|zwölf|dreizehn|vierzehn|fünfzehn|sechzehn|siebzehn|achtzehn|neunzehn";
const TENS = "zwanzig|dreißig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig";
// Below a hundred: "sieben", "zwölf", "achtundzwanzig", "dreißig".
const BELOW_100 = `(?:(?:${UNITS.replace("eins|", "")})und(?:${TENS})|${TENS}|${TEENS}|${UNITS})`;
const BELOW_1000 = `(?:(?:${UNITS.replace("eins|", "")})?hundert(?:und)?${BELOW_100}?|${BELOW_100})`;
const NUMBER = new RegExp(`^(?:${BELOW_1000}?tausend(?:und)?${BELOW_1000}?|${BELOW_1000})$`, "u");
/** A number in words, written as one: "dreihundertsechsundzwanzig". */
export const germanNumberWord = (word: string) => NUMBER.test(word.toLowerCase());

const DIGIT_WORDS = [
  "null",
  "ein",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
  "zehn",
  "elf",
  "zwölf",
];
const ONE: Readonly<Record<string, string>> = {
  millionen: "million",
  milliarden: "milliarde",
  billionen: "billion",
  billiarden: "billiarde",
};

function written(first: string, rest: string, mal?: string): string | null {
  const words = [first, ...rest.trim().split(/[ \t ]+/)];
  const joined = words.join("").toLowerCase();
  // "zwei drei Tage" is "two or three": only a whole number joins.
  if (!germanNumberWord(joined)) return null;
  const out = mal ? `${joined}mal` : joined;
  return likeTyped(first, out);
}

function numberFinding(start: number, end: number, alternatives: string[]): RawFinding {
  return finding("germanNumbers", "review_msg_german_numbers", start, end, alternatives, {
    context: { start: Math.max(0, start - 30), end: end + 30 },
  });
}

/** The finding for the `name` group of `m`, unless it is already right or the writer's word. */
function fix(ctx: DetectContext, m: RegExpExecArray, name: string, alternatives: string[] | null) {
  const [start, end] = m.indices!.groups![name];
  const typed = m.groups![name];
  if (!alternatives || alternatives.includes(typed) || namedExampleBefore(ctx.text, start))
    return null;
  if (ctx.dictionary.has(typed.toLowerCase())) return null;
  return numberFinding(start, end, alternatives);
}

/** The named frame fixes of the de.numbers rule (grammar/rules/de.yaml). */
const NUMBER_FIXERS = {
  numberApart: (m, ctx) => {
    const { first, rest, mal } = m.groups!;
    const end = m.index + m[0].length;
    // "zwischen zwei und dreißig": a range; "ein hundert Jahre altes Haus", "drei hundert
    // Meter hohe Türme": an article or count before a measure that is an attribute.
    if (/zwischen[ \t]+$/i.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))) return null;
    if (
      !mal &&
      /^[ \t]+\p{Lu}\p{Ll}+[ \t]+\p{Ll}+(?:e|er|es|en|em)(?!\p{L})/u.test(
        ctx.text.slice(end, end + 40),
      )
    )
      return null;
    const fixed = written(first, rest, mal);
    return fix(ctx, m, "target", fixed ? [fixed] : null);
  },
  singleMal: (m, ctx) => {
    const first = m.groups!.first;
    return fix(ctx, m, "target", germanNumberWord(first) ? [`${first}mal`] : null);
  },
  joinedTimes: (m, ctx) => {
    const first = m.groups!.first;
    // "einmal" is "once": "noch einmal drei Tage sind …".
    const once = first.toLowerCase() === "ein";
    return fix(ctx, m, "target", germanNumberWord(first) && !once ? [`${first} mal`] : null);
  },
  anHalb: (m, ctx) => {
    const n = m.groups!.n;
    const word = /\d/.test(n) ? DIGIT_WORDS[Number(n)] : n === "eins" ? "ein" : n;
    return fix(ctx, m, "target", [`${word}einhalb`]);
  },
  capitalNumber: (m, ctx) => {
    const typed = m.groups!.target;
    return fix(
      ctx,
      m,
      "target",
      germanNumberWord(typed) || typed === "Null" ? [typed.toLowerCase()] : null,
    );
  },
  singularAfterCount: (m, ctx) => {
    if (!m.groups!.t2) return fix(ctx, m, "target", [`${m.groups!.target}en`]);
    const noun = m.groups!.t2;
    // "77 Million Paintings": a title in another language.
    const next = /^[ \t]+(\p{Lu}\p{Ll}+)/u.exec(ctx.text.slice(m.index + m[0].length))?.[1];
    if (next && germanNounReading(next.toLowerCase()) === null) return null;
    return fix(ctx, m, "t2", [noun === "Milliarde" ? "Milliarden" : `${noun}en`]);
  },
  halfMillion: (m, ctx) => {
    const name = m.groups!.target ? "target" : "t2";
    const typed = m.groups![name];
    // "zwei halbe Millionen": several halves.
    const before = ctx.text.slice(Math.max(0, m.index - 30), m.index);
    if (/(?:\d|zwei|drei|vier|fünf|viele|mehrere|beide)[ \t]+halbe[nr]?[ \t]+$/iu.test(before)) {
      return null;
    }
    const fixed = typed.replace(/(millionen|milliarden|billionen|billiarden)$/i, (plural) => {
      const one = ONE[plural.toLowerCase()];
      return likeTyped(plural, one);
    });
    return fix(ctx, m, name, [fixed]);
  },
  englishDigits: (m, ctx) => {
    const [whole, decimals] = m.groups!.target.split(".");
    return fix(ctx, m, "target", [whole.replaceAll(",", ".") + (decimals ? `,${decimals}` : "")]);
  },
  ordinalDot: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    if (namedExampleBefore(ctx.text, start)) return null;
    return {
      ...numberFinding(start, end, [`${m.groups!.target}.`]),
      messageKey: "review_msg_german_ordinal_dot",
    };
  },
  numberRange: (m, ctx) => {
    const { from, to } = m.groups!;
    const before = ctx.text.slice(Math.max(0, m.index - 30), m.index);
    const between = /zwischen[ \t]+(?:\S+[ \t]+)?$/i.test(before);
    // "zwischen A und Z" is no range of letters; "von A-Z" is.
    if (between && !/\d/.test(from + to)) return null;
    // "ein Gewicht von 90–100 Tonnen", "Kinder von 6–12 Jahren": "von" after a noun names the
    // amount, which the dash spans ("Pilze von A–Z" still runs through the alphabet).
    if (/(?<!\p{L})\p{Lu}\p{Ll}+[ \t]+von[ \t]+$/u.test(before) && /\d/.test(from + to))
      return null;
    const [start, end] = m.indices!.groups!.target;
    if (namedExampleBefore(ctx.text, start) || ctx.dictionary.has(m.groups!.target.toLowerCase()))
      return null;
    return {
      ...numberFinding(start, end, [`${from} ${between ? "und" : "bis"} ${to}`]),
      messageKey: "review_msg_german_range",
    };
  },
} satisfies Record<string, MatchFixer>;

/** The named findings filters of the de.numbers rule (grammar/rules/de.yaml). */
export const FILTERS = {
  // "hundert tausend mal" already covers its "tausend mal": a number fix that overlaps an earlier
  // finding goes. The ordinal and range frames run last and keep theirs.
  firstNumberFix: (_ctx, findings) => {
    const kept: RawFinding[] = [];
    for (const f of findings) {
      if (
        f.messageKey === "review_msg_german_numbers" &&
        kept.some((k) => k.range.start < f.range.end && f.range.start < k.range.end)
      )
        continue;
      kept.push(f);
    }
    return kept;
  },
} satisfies Record<string, FindingsFilter>;

// The glued and spaced units are the measurement.de and currency.de frames of
// grammar/rules/common.yaml.
const BYTES = /^(?:[kKMGT]B|[KMGT]iB)$/;

/** A finding of a German unit frame: the match, outside a named example. */
function unitFinding(
  ctx: DetectContext,
  m: RegExpExecArray,
  alternatives: string[],
  key: ReviewMessageKey,
): RawFinding | null {
  if (m.index < ctx.from || m.index >= ctx.to || namedExampleBefore(ctx.text, m.index)) return null;
  const end = m.index + m[0].length;
  return {
    ruleId: key === "review_msg_currency_spacing" ? "currencySpacing" : "measurementUnitFormatting",
    messageKey: key,
    range: { start: m.index, end },
    alternatives,
    requiresChoice: alternatives.length > 1 || undefined,
    context: { start: Math.max(0, m.index - 30), end: end + 30 },
  };
}

// "75.000$" → "75.000 $", "5kB" → "5 kB". The frame's check picks the currency or the bytes.
const gluedUnit: MatchFixer = (m, ctx, frame) => {
  const { n, unit } = m.groups!;
  const line = ctx.text.slice(ctx.text.lastIndexOf("\n", m.index) + 1, m.index + 200);
  // "$x = 5$": math or a shell line.
  if (unit === "$" && line.split("$").length > 2) return null;
  const currency = unit === "$" || unit === "£";
  if (!currency && !BYTES.test(unit)) return null;
  if ((currency ? "currencySpacing" : "measurementUnitFormatting") !== frame.ruleId) return null;
  return unitFinding(
    ctx,
    m,
    [`${n}\u00a0${unit}`],
    currency ? "review_msg_currency_spacing" : "review_msg_measurement_spacing",
  );
};

// "25 °" → "25°" (an angle) or "25 °C" (a temperature).
const spacedDegree: MatchFixer = (m, ctx) => {
  const { n } = m.groups!;
  return unitFinding(ctx, m, [`${n}°`, `${n} °C`], "review_msg_measurement_spacing");
};

// Typeset German multiplies with × or ·: "6,6 x 10⁻³⁴", "5*2", "a * b" (opt-in). "0x1F" is
// hexadecimal; a "*" without spaces between words is a gender star or emphasis.
const timesSign: MatchFixer = (m, ctx) => {
  if (/(?<![\p{L}\p{N}.,])0$/u.test(ctx.text.slice(Math.max(0, m.index - 2), m.index))) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  return {
    ruleId: "germanTypography",
    messageKey: "review_msg_typographic_symbol",
    range: { start: m.index, end: m.index + 1 },
    alternatives: ["×", "·"],
    requiresChoice: true,
    context: { start: Math.max(0, m.index - 20), end: m.index + 20 },
  };
};

// A chemical formula takes subscript counts: "CO2", "H2O", "CO²" → "CO₂", "H₂O" (opt-in). Only
// formulas of element symbols with hydrogen or oxygen in them, so codes such as "MP3", "B2B",
// "K2" or "PC2" stay; one element with a count only as a gas ("O2", "N2").
const ELEMENTS = new Set(
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Mn Fe Co Ni Cu Zn Br Ag Sn I Ba Pt Au Hg Pb".split(
    " ",
  ),
);
const SUBSCRIPTS: Record<string, string> = { "²": "₂", "³": "₃" };
const GASES = new Set(["H2", "O2", "N2", "O3", "Cl2", "H²", "O²", "N²", "O³"]);

const chemicalFormula: MatchFixer = (m, ctx) => {
  const formula = m[0];
  if (!/[0-9²³]/.test(formula) || /^[0-9]/.test(formula)) return null;
  const symbols = formula.match(/[A-Z][a-z]?/g)!;
  if (!symbols.every((s) => ELEMENTS.has(s))) return null;
  if (symbols.length === 1 ? !GASES.has(formula) : !symbols.some((s) => s === "H" || s === "O"))
    return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  return {
    ruleId: "germanTypography",
    messageKey: "review_msg_typographic_symbol",
    range: { start: m.index, end: m.index + formula.length },
    alternatives: [
      formula.replace(/[0-9²³]/g, (d) => SUBSCRIPTS[d] ?? String.fromCharCode(0x2080 + +d)),
    ],
    context: { start: Math.max(0, m.index - 20), end: m.index + formula.length + 20 },
  };
};

// A long number groups its thousands with a point: "250000 Besucher" → "250.000" (opt-in).
// Codes, postal codes and account numbers stay: a five-digit number only before a lowercase
// word, a unit or a mark, and never after a word that names a code.
const CODE_BEFORE =
  /(?:Nr\.?|Nummer|PLZ|Postleitzahl|ID|Tel\.?|Telefon|Fax|Kto\.?|Konto|Kontonummer|Artikel|Bestellung|Code|Pin|PIN|Jahr|Jahre|Version|Seite|Zimmer|Raum|BLZ|IBAN|Kunden\p{L}*|Rechnung\p{L}*|Auftrag\p{L}*|Vorgang\p{L}*|Ticket\p{L}*)[ \t:.#-]*$/u;

const thousands: MatchFixer = (m, ctx) => {
  const digits = m[0];
  const end = m.index + digits.length;
  if (digits.length > 12 || CODE_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 24), m.index)))
    return null;
  const after = ctx.text.slice(end, end + 12);
  if (
    digits.length === 5 &&
    !/^[ \t]*(?:[.,;!?)]|[ \t]\p{Ll}|[ \t]?(?:[€$%£]|[kMGT]?B\b|km|kg|Euro|Dollar|Franken))/u.test(
      after,
    )
  )
    return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  return finding("germanTypography", "review_msg_german_thousands", m.index, end, [
    digits.replace(/\B(?=(?:\d{3})+$)/g, "."),
  ]);
};

const decadeCentury: MatchFixer = (m) => {
  const [start, end] = m.indices!.groups!.target;
  const { decade, target } = m.groups!;
  return finding(
    "stylePhrasing",
    "review_msg_style_phrasing",
    start,
    end,
    [decade, target.slice(2)],
    { requiresChoice: true },
  );
};

// "Seiten 10-15" -> "10–15" (emdashShortcut, opt-in). Not after a label of a code or a law
// ("Tel. 12-34", "§ 3-5", "Az. 12-14"), and not after "von" or "zwischen", where germanNumbers
// writes "bis" or "und".
const RANGE_CODE =
  /(?:^|[^\p{L}])(?:tel|telefon|handy|mobil|fax|plz|nr|nummer|kto|konto|iban|blz|az|aktenzeichen|art|artikel|abs|absatz|ziff|ziffer|din|iso|isbn|version|flug|linie|gleis|zimmer|raum|modell|typ|rechnung|bestellung|kundennummer|von|vom|zwischen)\.?:?(?:[ \t ]+\p{L}{2,13})?[ \t ]*$|§[ \t ]*$/iu;
// "gewann 3-1", "das Spiel endete 2-2", "steht es 1-0".
const RANGE_SCORE =
  /(?:^|[^\p{L}])(?:spiel|sieg|gewann|gewinn|verlor|verlier|unterl[ai]g|endstand|halbzeit|ergebnis|treffer|satz|sätze|partie|unentschieden|steht[ \t ]+es|stand[ \t ]+es)\p{L}*(?:[ \t ]+\p{L}+){0,3}[ \t ]+$/iu;

export const PREDICATES = {
  rangeDashes: (ctx) =>
    isGerman(ctx) ? rangeDashes(ctx, { code: RANGE_CODE, score: RANGE_SCORE }) : [],
} satisfies Record<string, Detector>;

/**
 * The named frame fixes of the de.numbers, de.typography and de.decadeCentury rules, and of
 * the measurement.de and currency.de rules of grammar/rules/common.yaml.
 */
export const FIXERS = {
  ...NUMBER_FIXERS,
  gluedUnit,
  spacedDegree,
  timesSign,
  chemicalFormula,
  thousands,
  decadeCentury,
} satisfies Record<string, MatchFixer>;
