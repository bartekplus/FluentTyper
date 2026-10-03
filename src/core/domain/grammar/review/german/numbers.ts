import { namedExampleBefore } from "../exampleCues";
import { frameMatches, SPACE, WORD_END, WORD_START } from "../phraseTemplates";
import { lookupMeasurementUnit } from "../../measurement/registry";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import type { ReviewMessageKey } from "../types";
import { germanNounReading } from "./germanLexicon";
import { isGerman, NOT_BLANK } from "./shared";

// German numbers written in words: one word up to a million ("sechs und zwanzig" →
// "sechsundzwanzig", "drei hundert" → "dreihundert", "acht mal" → "achtmal", "zwei an halb"
// → "zweieinhalb"), lowercase as numbers ("bis Drei zählen" → "drei"), and a plural noun
// after a plural number ("zwei Million" → "Millionen", "viele Möglichkeit" → "Möglichkeiten").

const S = SPACE;
const E = WORD_END;
const re = (source: string) => new RegExp(`${NOT_BLANK}${WORD_START}(?:${source})${E}`, "gdu");

const UNITS = "ein|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun";
const TEENS = "zehn|elf|zwölf|dreizehn|vierzehn|fünfzehn|sechzehn|siebzehn|achtzehn|neunzehn";
const TENS = "zwanzig|dreißig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig";
// Below a hundred: "sieben", "zwölf", "achtundzwanzig", "dreißig".
const BELOW_100 = `(?:(?:${UNITS.replace("eins|", "")})und(?:${TENS})|${TENS}|${TEENS}|${UNITS})`;
const BELOW_1000 = `(?:(?:${UNITS.replace("eins|", "")})?hundert(?:und)?${BELOW_100}?|${BELOW_100})`;
const NUMBER = new RegExp(`^(?:${BELOW_1000}?tausend(?:und)?${BELOW_1000}?|${BELOW_1000})$`, "u");
/** A number in words, written as one: "dreihundertsechsundzwanzig". */
export const germanNumberWord = (word: string) => NUMBER.test(word.toLowerCase());

// A token that starts like a number word, either case: "sechs", "Hundert", "tausendzwei".
const ci = (words: string) =>
  words
    .split("|")
    .map((w) => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`)
    .join("|");
const STARTS = `${UNITS}|${TEENS}|${TENS}|hundert|tausend`;
const PART = `(?:${ci(STARTS)})\\p{Ll}*`;
// Number words written apart: "sechs und zwanzig", "Zwei Hundert", "hundert tausend mal".
const APART = re(
  `(?<target>(?<first>${PART})(?<rest>(?:${S}(?:und${S})?${PART})+)(?:${S}(?<mal>mal))?)`,
);
// "acht mal versucht" → "achtmal"; "acht mal zwei" multiplies and stays.
const SINGLE_MAL = re(`(?<target>(?<first>${PART})${S}mal)(?!${S}(?:${PART}|\\d))`);
// "Achtmal zwei ist 16" → "Acht mal zwei".
const JOINED_TIMES = re(
  `(?<target>(?<first>${PART})mal)(?=${S}(?:(?!ein)(?:${STARTS})\\p{Ll}*|\\d+)${E}(?:${S}\\p{L}+)?${S}(?:ist|gleich|ergibt|macht|sind|=))`,
);
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
// "zwei an halb" → "zweieinhalb".
const AN_HALB = re(`(?<target>(?<n>${UNITS}|zehn|elf|zwölf|1[0-2]|[1-9])${S}an${S}halb)`);
// "bis Drei", "unter Null", "wir Fünf": a number that is no noun there.
const CAPITAL = re(
  `(?<=(?:bis|um|durch|über|unter|gegen|zu|auf|[Ww]ir|[Ii]hr|[Dd]iese|als|an${S}die)${S})(?<target>(?:Null|Zwei|Drei|Vier|Fünf|Sechs|Sieben|Acht|Neun|Zehn|Elf|Zwölf|\\p{Lu}\\p{Ll}*(?:zig|ßig|zehn|hundert|tausend)\\p{Ll}*))(?!${S}\\p{Lu})`,
);
// "zwei Million", "viele Möglichkeit": a singular after a plural quantity.
// ("einige Übung", "wenige Hoffnung" take a mass noun in the singular.)
const QUANTITY = `zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwanzig|hundert|tausend|viele|mehrere|beide|zahlreiche|unzählige`;
const SINGULAR = re(
  `(?=\\p{Lu})(?<=(?:(?:${QUANTITY})|(?:Vielzahl|Reihe|Menge|Anzahl|Fülle)${S}(?:von|an))(?:${S}\\p{Ll}{1,30}(?:e|en))?${S})(?<target>\\p{Lu}\\p{Ll}+(?:ung|heit|keit|schaft|ion|tät))(?!\\p{L})|` +
    `(?<=(?:${QUANTITY}|[2-9]|\\d{2,12}(?:,\\d{1,6})?)${S})(?<t2>Million|Milliarde|Billion)(?!\\p{L})`,
);

// "eine halbe Millionen", "eine Viertelmilliarden": a half or a quarter is one.
const HALF = re(
  `(?<=(?:[Hh]albe|[Hh]alben|[Hh]alber)${S})(?<target>Millionen|Milliarden|Billionen|Billiarden)|` +
    `(?<=(?:[Ee]ine|[Ee]iner|[Dd]ie|[Dd]er)${S})(?<t2>Viertel(?:millionen|milliarden))`,
);
// "von 9–10 Uhr", "Seiten von A-Z", "vom 7.-10. März", "zwischen 2019 – 2021": after "von" or
// "zwischen" the dash stands for "bis" or "und", which German writes out.
const RANGE_END = `(?:[1-9]\\d{0,3}|0)\\.?|\\p{Lu}`;
const RANGE = re(
  `(?<=(?:[Vv]on|[Vv]om|[Zz]wischen)${S}(?:(?:\\p{Lu}\\p{Ll}{2,12}|S\\.|Nr\\.)${S})?)(?<target>(?<from>${RANGE_END})[ \\t]?[-–][ \\t]?(?<to>${RANGE_END}))(?![-–\\d])`,
);
// "im 20 Jahrhundert", "am 3 Mai", "in den 4 Stock": a numeral between a definite article and
// a noun that counts in order is an ordinal and takes its dot.
const ORDINAL_NOUNS =
  "Jahrhundert|Jahrhunderts|Jahrtausend|Stock|Stockwerk|Etage|Minute|Platz|Geburtstag|" +
  "Jahrestag|Lebensjahr|Klasse|Spieltag|Runde|Liga|Etappe|Auflage|Kapitel|Januar|Februar|" +
  "März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember";
const ORDINAL = re(
  `(?<=(?:[Ii]m|[Aa]m|[Zz]um|[Vv]om|[Bb]eim|[Dd]em|[Dd]en|[Dd]er|[Dd]as|[Ss]eit${S}dem|[Ii]n${S}den|[Ii]n${S}der|[Aa]b${S}der|[Aa]b${S}dem)${S})(?<target>[1-9]\\d{0,2})(?=${S}(?:${ORDINAL_NOUNS})${E})`,
);
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
  return /^\p{Lu}/u.test(first) ? out[0].toUpperCase() + out.slice(1) : out;
}

function finding(start: number, end: number, alternatives: string[]): RawFinding {
  return {
    ruleId: "germanNumbers",
    messageKey: "review_msg_german_numbers",
    range: { start, end },
    alternatives,
    context: { start: Math.max(0, start - 30), end: end + 30 },
  };
}

function numbers(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  const push = (m: RegExpExecArray, name: string, alternatives: string[] | null) => {
    const [start, end] = m.indices!.groups![name];
    const typed = m.groups![name];
    if (!alternatives || alternatives.includes(typed) || namedExampleBefore(ctx.text, start))
      return;
    if (ctx.dictionary.has(typed.toLowerCase())) return;
    // "hundert tausend mal" already covers its "tausend mal".
    if (findings.some((f) => f.range.start < end && start < f.range.end)) return;
    findings.push(finding(start, end, alternatives));
  };
  for (const m of frameMatches(ctx, APART)) {
    const { first, rest, mal } = m.groups!;
    const end = m.index + m[0].length;
    // "zwischen zwei und dreißig": a range; "ein hundert Jahre altes Haus", "drei hundert
    // Meter hohe Türme": an article or count before a measure that is an attribute.
    if (/zwischen[ \t]+$/i.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))) continue;
    if (
      !mal &&
      /^[ \t]+\p{Lu}\p{Ll}+[ \t]+\p{Ll}+(?:e|er|es|en|em)(?!\p{L})/u.test(
        ctx.text.slice(end, end + 40),
      )
    )
      continue;
    const fixed = written(first, rest, mal);
    push(m, "target", fixed ? [fixed] : null);
  }
  for (const m of frameMatches(ctx, SINGLE_MAL)) {
    const first = m.groups!.first;
    push(m, "target", germanNumberWord(first) ? [`${first}mal`] : null);
  }
  for (const m of frameMatches(ctx, JOINED_TIMES)) {
    const first = m.groups!.first;
    // "einmal" is "once": "noch einmal drei Tage sind …".
    const once = first.toLowerCase() === "ein";
    push(m, "target", germanNumberWord(first) && !once ? [`${first} mal`] : null);
  }
  for (const m of frameMatches(ctx, AN_HALB)) {
    const n = m.groups!.n;
    const word = /\d/.test(n) ? DIGIT_WORDS[Number(n)] : n === "eins" ? "ein" : n;
    push(m, "target", [`${word}einhalb`]);
  }
  for (const m of frameMatches(ctx, CAPITAL)) {
    const typed = m.groups!.target;
    push(m, "target", germanNumberWord(typed) || typed === "Null" ? [typed.toLowerCase()] : null);
  }
  const owner = (m: RegExpExecArray) => (m.indices!.groups!.target ?? m.indices!.groups!.t2)[0];
  for (const m of frameMatches(ctx, SINGULAR, owner)) {
    if (m.groups!.t2) {
      const noun = m.groups!.t2;
      // "77 Million Paintings": a title in another language.
      const next = /^[ \t]+(\p{Lu}\p{Ll}+)/u.exec(ctx.text.slice(m.index + m[0].length))?.[1];
      if (next && germanNounReading(next.toLowerCase()) === null) continue;
      push(m, "t2", [noun === "Milliarde" ? "Milliarden" : `${noun}en`]);
    } else push(m, "target", [`${m.groups!.target}en`]);
  }
  for (const m of frameMatches(ctx, HALF, owner)) {
    const name = m.groups!.target ? "target" : "t2";
    const typed = m.groups![name];
    // "zwei halbe Millionen": several halves.
    const before = ctx.text.slice(Math.max(0, m.index - 30), m.index);
    if (/(?:\d|zwei|drei|vier|fünf|viele|mehrere|beide)[ \t]+halbe[nr]?[ \t]+$/iu.test(before)) {
      continue;
    }
    const fixed = typed.replace(/(millionen|milliarden|billionen|billiarden)$/i, (plural) => {
      const one = ONE[plural.toLowerCase()];
      return /^\p{Lu}/u.test(plural) ? one[0].toUpperCase() + one.slice(1) : one;
    });
    push(m, name, [fixed]);
  }
  for (const m of frameMatches(ctx, ORDINAL)) {
    const [start, end] = m.indices!.groups!.target;
    if (namedExampleBefore(ctx.text, start)) continue;
    findings.push({
      ...finding(start, end, [`${m.groups!.target}.`]),
      messageKey: "review_msg_german_ordinal_dot",
    });
  }
  for (const m of frameMatches(ctx, RANGE)) {
    const { from, to } = m.groups!;
    const before = ctx.text.slice(Math.max(0, m.index - 30), m.index);
    const between = /zwischen[ \t]+(?:\S+[ \t]+)?$/i.test(before);
    // "zwischen A und Z" is no range of letters; "von A-Z" is.
    if (between && !/\d/.test(from + to)) continue;
    // "ein Gewicht von 90–100 Tonnen", "Kinder von 6–12 Jahren": "von" after a noun names the
    // amount, which the dash spans ("Pilze von A–Z" still runs through the alphabet).
    if (/(?<!\p{L})\p{Lu}\p{Ll}+[ \t]+von[ \t]+$/u.test(before) && /\d/.test(from + to)) continue;
    const [start, end] = m.indices!.groups!.target;
    if (namedExampleBefore(ctx.text, start) || ctx.dictionary.has(m.groups!.target.toLowerCase()))
      continue;
    findings.push({
      ...finding(start, end, [`${from} ${between ? "und" : "bis"} ${to}`]),
      messageKey: "review_msg_german_range",
    });
  }
  return findings;
}

// German puts a space between a number and its unit or currency, also after a thousands dot:
// "2.000kWh" → "2.000 kWh", "75.000$" → "75.000 $", "5kB" → "5 kB". The shared check reads
// no thousands dot, and "B" alone may be a bel. An angle takes no space before its degree
// sign, and a temperature names its scale: "25 °" → "25°" or "25 °C" ("20 ° Celsius" stays).
const GLUED =
  /(?<![\p{L}\p{N}.,_/\\-])(?<n>\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(?<unit>\p{L}{1,4}|[$£€])(?![\p{L}\p{N}_-])/gu;
const BYTES = /^(?:[kKMGT]B|[KMGT]iB)$/;
const DEGREE =
  /(?<![\p{L}\p{N}.,])(?<n>[-−]?\d+(?:,\d+)?)[ \u00a0]°(?![CFK\p{L}\p{N}]|[ \t\u00a0]+(?:Celsius|Fahrenheit|Kelvin))/gu;

function units(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  const add = (m: RegExpExecArray, alternatives: string[], key: ReviewMessageKey) => {
    if (m.index < ctx.from || m.index >= ctx.to || namedExampleBefore(ctx.text, m.index)) return;
    const end = m.index + m[0].length;
    findings.push({
      ruleId:
        key === "review_msg_currency_spacing" ? "currencySpacing" : "measurementUnitFormatting",
      messageKey: key,
      range: { start: m.index, end },
      alternatives,
      requiresChoice: alternatives.length > 1 || undefined,
      context: { start: Math.max(0, m.index - 30), end: end + 30 },
    });
  };
  GLUED.lastIndex = Math.max(0, ctx.from - 16);
  for (let m = GLUED.exec(ctx.scanText); m && m.index < ctx.to; m = GLUED.exec(ctx.scanText)) {
    const { n, unit } = m.groups!;
    const dotted = n.includes(".");
    const line = ctx.text.slice(ctx.text.lastIndexOf("\n", m.index) + 1, m.index + 200);
    // "$x = 5$": math or a shell line.
    if (unit === "$" && line.split("$").length > 2) continue;
    const currency = unit === "$" || unit === "£" || (unit === "€" && dotted);
    const known = lookupMeasurementUnit(unit);
    if (!currency && !BYTES.test(unit) && !(dotted && known?.safe && !known.ambiguity)) continue;
    add(
      m,
      [`${n} ${unit}`],
      currency ? "review_msg_currency_spacing" : "review_msg_measurement_spacing",
    );
  }
  DEGREE.lastIndex = Math.max(0, ctx.from - 16);
  for (let m = DEGREE.exec(ctx.scanText); m && m.index < ctx.to; m = DEGREE.exec(ctx.scanText)) {
    const { n } = m.groups!;
    add(m, [`${n}°`, `${n} °C`], "review_msg_measurement_spacing");
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanNumbers"], detect: numbers },
  { rules: ["measurementUnitFormatting", "currencySpacing"], detect: units },
];
