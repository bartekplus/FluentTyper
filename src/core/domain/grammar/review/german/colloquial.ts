import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { germanInfinitive, germanNounReading, germanVerbLike } from "./germanLexicon";
import { englishLine, isGerman } from "./shared";

// The spoken short forms of her-/hin- particles before a verb: "reingehen" (hineingehen),
// "rausbekommen" (herausbekommen or hinausbekommen), "rumsitzen" (herumsitzen), and "rum",
// "rüber", "runter", "rauf", "raus" on their own. Opt-in: fine in speech and casual writing.

const FULL: Readonly<Record<string, string[]>> = {
  ran: ["heran"],
  rum: ["herum"],
  raus: ["heraus", "hinaus"],
  rein: ["herein", "hinein"],
  rauf: ["herauf", "hinauf"],
  runter: ["herunter", "hinunter"],
  rüber: ["herüber", "hinüber"],
};
// "rein" and "ran" alone are an adjective ("rein zufällig") and a call ("ran an die Arbeit").
const ALONE = new Set(["rum", "raus", "rauf", "runter", "rüber"]);
const WORD =
  /(?<![\p{L}\p{M}\p{N}_\-'’])(?<short>[Rr](?:an|um|aus|ein|auf|unter|über))(?<rest>\p{Ll}*)(?![\p{L}\p{M}\p{N}_\-'’])/gu;

/** A verb form: an infinitive, a 1st singular or past form, a present form in -t or -st. */
function verbForm(word: string): boolean {
  if (word.length < 3) return false;
  if (germanVerbLike(word) || germanInfinitive(word)) return true;
  return [`${word.replace(/e?s?t$/, "")}en`, `${word.replace(/t$/, "")}n`].some(
    (infinitive) => infinitive !== word && germanInfinitive(infinitive),
  );
}

/** The verb after the particle: "bekommen", "zubekommen" (zu-infinitive), "gefallen". */
function verbAfter(rest: string): boolean {
  if (verbForm(rest)) return true;
  if (rest.startsWith("zu") && verbForm(rest.slice(2))) return true;
  // A participle: "ge" + stem + "t" or "en" ("gegangen", "getastet").
  const participle = /^ge(\p{Ll}{2,}?)(?:et|t|en)$/u.exec(rest);
  return !!participle && [`${participle[1]}en`, `${participle[1]}n`].some(germanInfinitive);
}

// A preposition with an interrogative "was" is spoken German; writing uses the wo(r)- adverb:
// "Für was kämpft er?" (Wofür), "um was es geht" (worum). Not the indefinite "was" ("für was
// Neues", "gegen was neues").
const WHAT =
  /(?<![\p{L}\p{M}\p{N}_-])(?<prep>[Aa]us|[Uu]m|[Aa]uf|[Ff]ür|[Dd]urch|[Mm]it|[Üü]ber|[Aa]n|[Vv]on|[Nn]ach|[Zz]u|[Ii]n|[Bb]ei|[Gg]egen|[Vv]or)[ \t]+was(?![\p{L}\p{M}\p{N}_-])/gu;
const WO = (prep: string) => (/^[aeiouü]/.test(prep) ? `wor${prep}` : `wo${prep}`);
function prepositionWhat(ctx: DetectContext, findings: RawFinding[]): void {
  WHAT.lastIndex = ctx.from;
  for (let m = WHAT.exec(ctx.scanText); m && m.index < ctx.to; m = WHAT.exec(ctx.scanText)) {
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    // "was Neues", "was neues", "was anderes": "etwas"; "Auf was für einem …": "was für".
    if (/^[ \t]+(?:\p{Lu}|\p{Ll}+(?:es|e)(?![\p{L}])|für(?![\p{L}]))/u.test(after)) continue;
    // "um was zu essen", "um was aufzubauen": "um … zu" with "etwas".
    const clause = /^[^.!?,;:\n]*/.exec(after)![0];
    if (
      /^[Uu]m$/.test(m.groups!.prep) &&
      /(?<![\p{L}])zu(?![\p{L}])|\p{Ll}+zu\p{Ll}+en(?![\p{L}])/u.test(clause)
    )
      continue;
    const before = ctx.text.slice(Math.max(0, m.index - 2), m.index);
    // The clause opens with it: a question or an indirect question after a comma.
    if (m.index > 0 && !/(?:^|[,;:\n„"]\s*|[.!?]\s+)$/.test(before)) continue;
    const prep = m.groups!.prep;
    const adverb = WO(prep.toLowerCase());
    findings.push({
      ruleId: "germanColloquial",
      messageKey: "review_msg_german_colloquial",
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [/^\p{Lu}/u.test(prep) ? adverb[0].toUpperCase() + adverb.slice(1) : adverb],
      context: { start: Math.max(0, m.index - 40), end: m.index + m[0].length + 20 },
    });
  }
}

// "Sinn machen" copies the English phrase; German says "Sinn ergeben". The phrase table
// holds the adjacent forms; this frame takes the verb a few words before "Sinn" ("Das macht
// für mich wenig Sinn", "Macht es vielleicht Sinn") and "Sinn zu machen".
const ERGEBEN: Readonly<Record<string, string>> = {
  macht: "ergibt",
  machen: "ergeben",
  machte: "ergab",
  machten: "ergaben",
  machst: "ergibst",
  mache: "ergebe",
  gemacht: "ergeben",
};
const MAKES_SENSE =
  /(?<![\p{L}\p{M}\p{N}_-])(?<verb>[Mm]acht|[Mm]achen|[Mm]achte|[Mm]achten|[Mm]achst|[Mm]ache)(?<gap>(?:[ \t]+\p{Ll}+){1,4}?)[ \t]+(?:einen[ \t]+|keinen[ \t]+)?Sinn(?![\p{L}\p{M}\p{N}_-])|Sinn[ \t]+zu[ \t]+(?<zu>machen)(?![\p{L}\p{M}\p{N}_-])/gu;
// Gaps the phrase table already covers, and "den Sinn" as an object ("was den Sinn ausmacht").
const COVERED_GAPS = new Set(["es", "das", "wenig", "mehr", "das keinen"]);
function makesSense(ctx: DetectContext, findings: RawFinding[]): void {
  MAKES_SENSE.lastIndex = Math.max(0, ctx.from - 64);
  for (let m = MAKES_SENSE.exec(ctx.scanText); m; m = MAKES_SENSE.exec(ctx.scanText)) {
    const { verb, gap, zu } = m.groups!;
    const typed = verb ?? zu;
    const start = m.index + (verb ? 0 : m[0].length - zu.length);
    if (start < ctx.from) continue;
    if (start >= ctx.to) break;
    const words = (gap ?? "").trim().split(/[ \t]+/);
    if (verb && (COVERED_GAPS.has(words.join(" ")) || /^d(?:en|em|es|er|ie)$/.test(words.at(-1)!)))
      continue;
    // "macht … Sinn aus": the verb "ausmachen", or a genitive after "Sinn" ("Sinn des Lebens").
    const rest = /^[^.!?;:\n]*/.exec(ctx.text.slice(m.index + m[0].length))![0];
    if (/^[ \t]+(?:des|der|eines|einer)(?![\p{L}])|(?<![\p{L}])aus[ \t]*$/u.test(rest)) continue;
    if (namedExampleBefore(ctx.text, start) || englishLine(ctx.text, start)) continue;
    const full = ERGEBEN[typed.toLowerCase()];
    findings.push({
      ruleId: "germanColloquial",
      messageKey: "review_msg_german_colloquial",
      range: { start, end: start + typed.length },
      alternatives: [/^\p{Lu}/u.test(typed) ? full[0].toUpperCase() + full.slice(1) : full],
      context: { start: m.index, end: m.index + m[0].length },
    });
  }
}

// Clipped words of speech and their written forms ("Mathe", "Infos", "Kuli"); not the ones
// that are also names or other words ("Präsi" may be a president, "Bibs" a brand).
const CLIPPED: Readonly<Record<string, string[]>> = {
  Mathe: ["Mathematik"],
  Info: ["Information"],
  Infos: ["Informationen"],
  Uni: ["Universität"],
  Unis: ["Universitäten"],
  Abi: ["Abitur"],
  Kuli: ["Kugelschreiber"],
  Kulis: ["Kugelschreiber"],
  Limo: ["Limonade"],
  Deo: ["Deodorant"],
  Klo: ["Toilette"],
  Reli: ["Religion"],
};
const CLIPPED_WORD = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_@/#.-])(?:${Object.keys(CLIPPED).join("|")})(?![\\p{L}\\p{M}\\p{N}_@/#-])`,
  "gu",
);
function clipped(ctx: DetectContext, findings: RawFinding[]): void {
  CLIPPED_WORD.lastIndex = ctx.from;
  for (
    let m = CLIPPED_WORD.exec(ctx.scanText);
    m && m.index < ctx.to;
    m = CLIPPED_WORD.exec(ctx.scanText)
  ) {
    const word = m[0];
    // "Info-Abend", "Uni Hamburg", "NDR Info", "Info 2": part of a name or compound.
    const after = ctx.text.slice(m.index + word.length, m.index + word.length + 24);
    const before = ctx.text.slice(Math.max(0, m.index - 12), m.index);
    if (/^(?:-|[ \t]+(?:\p{Lu}\p{L}*(?!\p{L})|\p{N}))/u.test(after)) continue;
    if (/\p{Lu}{2,}[ \t]+$/u.test(before)) continue;
    if (ctx.dictionary.has(word.toLowerCase()) || namedExampleBefore(ctx.text, m.index)) continue;
    if (englishLine(ctx.text, m.index)) continue;
    findings.push({
      ruleId: "germanColloquial",
      messageKey: "review_msg_german_colloquial",
      range: { start: m.index, end: m.index + word.length },
      alternatives: CLIPPED[word],
      context: { start: Math.max(0, m.index - 40), end: m.index + word.length + 20 },
    });
  }
}

// Spoken names of a measured quantity and of arithmetic, and their written forms: "die
// Voltzahl" (elektrische Spannung), "5 Kilo" (Kilogramm), "plus rechnen" (addieren),
// "schneller als 50 Kilometer" (Kilometer pro Stunde: a speed, not a distance).
const QUANTITY: Readonly<Record<string, string[]>> = {
  volt: ["elektrische Spannung"],
  ampere: ["elektrische Stromstärke"],
  coulomb: ["elektrische Ladung"],
  watt: ["Leistung"],
  kilowatt: ["Leistung"],
  megawatt: ["Leistung"],
  ps: ["Leistung"],
  hertz: ["Frequenz"],
  joule: ["Energie"],
  kilogramm: ["Gewicht", "Masse"],
  gramm: ["Gewicht", "Masse"],
};
const PLURAL: Readonly<Record<string, string>> = {
  "elektrische Spannung": "elektrische Spannungen",
  "elektrische Stromstärke": "elektrische Stromstärken",
  "elektrische Ladung": "elektrische Ladungen",
  Leistung: "Leistungen",
  Frequenz: "Frequenzen",
  Energie: "Energien",
  Gewicht: "Gewichte",
  Masse: "Massen",
};
const UNIT_COUNT =
  /(?<![\p{L}\p{N}-])(?<unit>Volt|Ampere|Coulomb|Watt|Kilowatt|Megawatt|PS|Hertz|Joule|Kilogramm|Gramm)-?[Zz]ahl(?<plural>en)?(?![\p{L}\p{N}-])/gu;
// The word first, then a bounded look back: cheap on long runs of spaces without the regex JIT.
const NUMBER_WORD =
  "\\d|(?<![\\p{L}])(?:ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|zwanzig|dreißig|fünfzig|hundert|halbes?|paar)";
const KILO = new RegExp(
  `(?<![\\p{L}\\p{N}-])Kilo(?![\\p{L}\\p{N}-])(?<=(?:${NUMBER_WORD})[ \\t]{1,8}Kilo)`,
  "gu",
);
const SPEED = new RegExp(
  `(?<![\\p{L}\\p{N}-])Kilometer(?![\\p{L}\\p{N}-])(?:(?<=(?:schneller|langsamer)[ \\t]{1,8}als[ \\t]{1,8}(?:\\d+(?:,\\d+)?|\\p{Ll}+)[ \\t]{1,8}Kilometer)(?![ \\t]+(?:pro|je|in)(?![\\p{L}]))|(?<=(?:${NUMBER_WORD})[ \\t]{1,8}Kilometer)(?=[ \\t]{1,8}(?:schneller|langsamer)(?![\\p{L}])))`,
  "gu",
);
const ARITHMETIC: Readonly<Record<string, string>> = {
  plus: "addier",
  minus: "subtrahier",
  geteilt: "dividier",
};
const RECHNEN =
  /(?<![\p{L}\p{N}-])(?<op>plus|minus|geteilt)[ \t]+(?<verb>rechnen|rechnet|rechnest|rechne|gerechnet)(?![\p{L}\p{N}-])/gu;
const OPERATION: Readonly<Record<string, string>> = {
  Plus: "Addition",
  Minus: "Subtraktion",
  Geteilt: "Division",
  Mal: "Multiplikation",
};
const RECHNEN_NOUN = /(?<![\p{L}\p{N}-])(?<op>Plus|Minus|Geteilt|Mal)-Rechnen(?![\p{L}\p{N}-])/gu;

function* owned(ctx: DetectContext, regex: RegExp): Generator<RegExpExecArray> {
  regex.lastIndex = Math.max(0, ctx.from - 64);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (m.index < ctx.from || namedExampleBefore(ctx.text, m.index)) continue;
    yield m;
  }
}

function spokenMeasures(ctx: DetectContext, findings: RawFinding[]): void {
  const add = (m: RegExpExecArray, alternatives: string[]) =>
    findings.push({
      ruleId: "germanColloquial",
      messageKey: "review_msg_german_colloquial",
      range: { start: m.index, end: m.index + m[0].length },
      alternatives,
      context: { start: Math.max(0, m.index - 40), end: m.index + m[0].length + 20 },
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    });
  for (const m of owned(ctx, UNIT_COUNT)) {
    const names = QUANTITY[m.groups!.unit.toLowerCase()];
    add(m, m.groups!.plural ? names.map((n) => PLURAL[n]) : names);
  }
  for (const m of owned(ctx, KILO)) add(m, ["Kilogramm"]);
  for (const m of owned(ctx, SPEED)) {
    // "die 5 Kilometer schneller laufen": a distance run faster.
    const before = ctx.text.slice(Math.max(0, m.index - 30), m.index);
    if (/(?<!\p{L})(?:die|diese|den|der|alle|ersten|letzten)[ \t]+\S+[ \t]+$/u.test(before))
      continue;
    add(m, ["Kilometer pro Stunde"]);
  }
  for (const m of owned(ctx, RECHNEN)) {
    const { op, verb } = m.groups!;
    const ending = { rechnen: "en", rechnet: "t", rechnest: "st", rechne: "e", gerechnet: "t" }[
      verb
    ]!;
    add(m, [`${ARITHMETIC[op]}${ending}`]);
  }
  for (const m of owned(ctx, RECHNEN_NOUN)) add(m, [OPERATION[m.groups!.op]]);
}

function colloquial(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  prepositionWhat(ctx, findings);
  makesSense(ctx, findings);
  clipped(ctx, findings);
  spokenMeasures(ctx, findings);
  WORD.lastIndex = ctx.from;
  for (let m = WORD.exec(ctx.scanText); m && m.index < ctx.to; m = WORD.exec(ctx.scanText)) {
    const { short, rest } = m.groups!;
    const word = m[0];
    const low = word.toLowerCase();
    const key = short.toLowerCase();
    const capital = short !== key;
    if (rest) {
      // A dictionary word of its own ("rangieren", "Ranzen"); the dictionary also
      // lists a few colloquial raus- verbs ("rauslassen"), which stay checked.
      const known = germanVerbLike(low) || germanInfinitive(low) || germanNounReading(low) !== null;
      if (known && key === "ran") continue;
      // Capitalized inside a sentence: a noun ("die Rangliste"), unless a verb made one ("zum
      // Rumprobieren").
      if (
        capital &&
        !/(?:en|ern|eln)$/.test(rest) &&
        !/(?:^|[.!?:\n„“"»«])[ \t]*$/.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
      )
        continue;
      if (!verbAfter(rest)) continue;
    } else {
      // "Rum" is the drink; a capital at a sentence start may be either.
      if (capital || !ALONE.has(key)) continue;
    }
    // Idioms with no written twin: "sich an jemanden ranmachen", "ans Telefon rangehen",
    // "jemandem eine runterhauen", "rum wie num"; and "rein- und rausschlüpfen".
    const before = ctx.text.slice(Math.max(0, m.index - 60), m.index);
    const after = ctx.text.slice(m.index + word.length, m.index + word.length + 12);
    if (/^ran(?:zu|ge)?mach/.test(low) || (/^rum$/.test(low) && /^\s+wie\s/.test(after))) continue;
    if (/^ran(?:zu|ge)?geh|^ranging/.test(low) && /Telefon|Handy/.test(before)) continue;
    if (/^runter/.test(low) && /(?<!\p{L})einen?\s+$/u.test(before)) continue;
    if (/-\s+(?:und|oder)\s+$/.test(before)) continue;
    if (ctx.dictionary.has(low) || namedExampleBefore(ctx.text, m.index)) continue;
    if (englishLine(ctx.text, m.index)) continue;
    const alternatives = FULL[key].map((full) => {
      const spelled = full + rest;
      return capital ? spelled[0].toUpperCase() + spelled.slice(1) : spelled;
    });
    findings.push({
      ruleId: "germanColloquial",
      messageKey: "review_msg_german_colloquial",
      range: { start: m.index, end: m.index + word.length },
      alternatives,
      context: { start: Math.max(0, m.index - 40), end: m.index + word.length },
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanColloquial"], detect: colloquial },
];
