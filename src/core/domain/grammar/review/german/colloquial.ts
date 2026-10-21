import { namedExampleBefore } from "../exampleCues";
import type { MatchFixer } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import { germanInfinitive, germanNounReading, germanVerbLike } from "./germanLexicon";
import { englishLine, likeTyped } from "./shared";

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
const WO = (prep: string) => (/^[aeiouü]/.test(prep) ? `wor${prep}` : `wo${prep}`);
const prepositionWhat: MatchFixer = (m, ctx) => {
  const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 30);
  // "was Neues", "was neues", "was anderes": "etwas"; "Auf was für einem …": "was für".
  if (/^[ \t]+(?:\p{Lu}|\p{Ll}+(?:es|e)(?![\p{L}])|für(?![\p{L}]))/u.test(after)) return null;
  // "um was zu essen", "um was aufzubauen": "um … zu" with "etwas".
  const clause = /^[^.!?,;:\n]*/.exec(after)![0];
  if (
    /^[Uu]m$/.test(m.groups!.prep) &&
    /(?<![\p{L}])zu(?![\p{L}])|\p{Ll}+zu\p{Ll}+en(?![\p{L}])/u.test(clause)
  )
    return null;
  const before = ctx.text.slice(Math.max(0, m.index - 2), m.index);
  // The clause opens with it: a question or an indirect question after a comma.
  if (m.index > 0 && !/(?:^|[,;:\n„"]\s*|[.!?]\s+)$/.test(before)) return null;
  const prep = m.groups!.prep;
  const adverb = WO(prep.toLowerCase());
  return {
    ruleId: "germanColloquial",
    messageKey: "review_msg_german_colloquial",
    range: { start: m.index, end: m.index + m[0].length },
    alternatives: [likeTyped(prep, adverb)],
    context: { start: Math.max(0, m.index - 40), end: m.index + m[0].length + 20 },
  };
};

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
// Gaps the phrase table already covers, and "den Sinn" as an object ("was den Sinn ausmacht").
const COVERED_GAPS = new Set(["es", "das", "wenig", "mehr", "das keinen"]);
const makesSense: MatchFixer = (m, ctx) => {
  const { verb, gap, zu } = m.groups!;
  const typed = verb ?? zu;
  const start = m.index + (verb ? 0 : m[0].length - zu.length);
  if (start < ctx.from || start >= ctx.to) return null;
  const words = (gap ?? "").trim().split(/[ \t]+/);
  if (verb && (COVERED_GAPS.has(words.join(" ")) || /^d(?:en|em|es|er|ie)$/.test(words.at(-1)!)))
    return null;
  // "macht … Sinn aus": the verb "ausmachen", or a genitive after "Sinn" ("Sinn des Lebens").
  const rest = /^[^.!?;:\n]*/.exec(ctx.text.slice(m.index + m[0].length))![0];
  if (/^[ \t]+(?:des|der|eines|einer)(?![\p{L}])|(?<![\p{L}])aus[ \t]*$/u.test(rest)) return null;
  if (namedExampleBefore(ctx.text, start) || englishLine(ctx.text, start)) return null;
  const full = ERGEBEN[typed.toLowerCase()];
  return {
    ruleId: "germanColloquial",
    messageKey: "review_msg_german_colloquial",
    range: { start, end: start + typed.length },
    alternatives: [likeTyped(typed, full)],
    context: { start: m.index, end: m.index + m[0].length },
  };
};

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
const clipped: MatchFixer = (m, ctx) => {
  const word = m[0];
  // "Info-Abend", "Uni Hamburg", "NDR Info", "Info 2": part of a name or compound.
  const after = ctx.text.slice(m.index + word.length, m.index + word.length + 24);
  const before = ctx.text.slice(Math.max(0, m.index - 12), m.index);
  if (/^(?:-|[ \t]+(?:\p{Lu}\p{L}*(?!\p{L})|\p{N}))/u.test(after)) return null;
  if (/\p{Lu}{2,}[ \t]+$/u.test(before)) return null;
  if (ctx.dictionary.has(word.toLowerCase()) || namedExampleBefore(ctx.text, m.index)) return null;
  if (englishLine(ctx.text, m.index)) return null;
  return {
    ruleId: "germanColloquial",
    messageKey: "review_msg_german_colloquial",
    range: { start: m.index, end: m.index + word.length },
    alternatives: CLIPPED[word],
    context: { start: Math.max(0, m.index - 40), end: m.index + word.length + 20 },
  };
};

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
const ARITHMETIC: Readonly<Record<string, string>> = {
  plus: "addier",
  minus: "subtrahier",
  geteilt: "dividier",
};
const OPERATION: Readonly<Record<string, string>> = {
  Plus: "Addition",
  Minus: "Subtraktion",
  Geteilt: "Division",
  Mal: "Multiplikation",
};
/** A spoken measure at `m`, read from 64 characters before the chunk; null outside it. */
const measure = (m: RegExpExecArray, ctx: DetectContext, alternatives: string[]) =>
  m.index < ctx.from || namedExampleBefore(ctx.text, m.index)
    ? null
    : {
        ruleId: "germanColloquial" as const,
        messageKey: "review_msg_german_colloquial" as const,
        range: { start: m.index, end: m.index + m[0].length },
        alternatives,
        context: { start: Math.max(0, m.index - 40), end: m.index + m[0].length + 20 },
        ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
      };

const SPOKEN_MEASURES = {
  unitCount: (m, ctx) => {
    const names = QUANTITY[m.groups!.unit.toLowerCase()];
    return measure(m, ctx, m.groups!.plural ? names.map((n) => PLURAL[n]) : names);
  },
  kilo: (m, ctx) => measure(m, ctx, ["Kilogramm"]),
  speed: (m, ctx) => {
    // "die 5 Kilometer schneller laufen": a distance run faster.
    const before = ctx.text.slice(Math.max(0, m.index - 30), m.index);
    if (/(?<!\p{L})(?:die|diese|den|der|alle|ersten|letzten)[ \t]+\S+[ \t]+$/u.test(before))
      return null;
    return measure(m, ctx, ["Kilometer pro Stunde"]);
  },
  rechnen: (m, ctx) => {
    const { op, verb } = m.groups!;
    const ending = { rechnen: "en", rechnet: "t", rechnest: "st", rechne: "e", gerechnet: "t" }[
      verb
    ]!;
    return measure(m, ctx, [`${ARITHMETIC[op]}${ending}`]);
  },
  rechnenNoun: (m, ctx) => measure(m, ctx, [OPERATION[m.groups!.op]]),
} satisfies Record<string, MatchFixer>;

// Spoken short forms (authored): an article without "ei-" ("n netter Typ", "ne Frage"), a
// verb with "es" or "du" joined to it ("ich mags", "gehts", "meinste").
const ARTICLES: Readonly<Record<string, string>> = {
  n: "ein",
  ne: "eine",
  nen: "einen",
  nem: "einem",
  ner: "einer",
};
const JOINED: Readonly<Record<string, string>> = {
  mags: "mag es",
  liebs: "liebe es",
  gebs: "gebe es",
  habs: "habe es",
  nehms: "nehme es",
  machs: "mache es",
  kenns: "kenne es",
  wills: "will es",
  kanns: "kann es",
  stehts: "steht es",
  gefällts: "gefällt es",
  gehts: "geht es",
  gibts: "gibt es",
  kommts: "kommt es",
  siehts: "sieht es",
  läufts: "läuft es",
  klappts: "klappt es",
  passts: "passt es",
  haste: "hast du",
  biste: "bist du",
  kannste: "kannst du",
  weißte: "weißt du",
  siehste: "siehst du",
  willste: "willst du",
  meinste: "meinst du",
  guckste: "guckst du",
  machste: "machst du",
  hörste: "hörst du",
  gehste: "gehst du",
  kommste: "kommst du",
};
// "Du brauchst nicht kommen" → "zu kommen": "brauchen" with a negation or "nur" takes "zu".
const SEPARABLE = /^(?:an|ab|auf|aus|bei|ein|mit|nach|vor|weg|zurück|her|hin|los|fest|zu|vorbei)/;

/** A spoken form at text[start, end), unless it is the writer's word or English. */
function spoken(ctx: DetectContext, start: number, end: number, alternatives: string[]) {
  const typed = ctx.text.slice(start, end);
  if (ctx.dictionary.has(typed.toLowerCase()) || namedExampleBefore(ctx.text, start)) return null;
  if (englishLine(ctx.text, start)) return null;
  return {
    ruleId: "germanColloquial" as const,
    messageKey: "review_msg_german_colloquial" as const,
    range: { start, end },
    alternatives,
    context: { start: Math.max(0, start - 40), end: end + 20 },
  };
}

/** The named frame fixes of the de.colloquial rule (grammar/rules/de.yaml). */
export const FIXERS = {
  spokenForm: (m, ctx) => {
    const { article, adjective, joined } = m.groups!;
    // "für n Elemente": a bare "n" is a number; it is an article before an adjective only.
    if (article === "n" && !adjective) return null;
    const word = article ?? joined;
    const fix = article ? ARTICLES[article] : JOINED[joined.toLowerCase()];
    return spoken(ctx, m.index, m.index + word.length, [likeTyped(word, fix)]);
  },
  needsZu: (m, ctx) => {
    const { middle, verb } = m.groups!;
    const words = middle.trim().split(/[ \t]+/);
    // A negation or "nur", and no "zu" or other verb that the clause already has.
    if (!words.some((w) => /^(?:nicht|nie|kein\p{Ll}*|nur|bloß|erst)$/u.test(w))) return null;
    if (words.includes("zu") || /zu\p{Ll}+en$/u.test(verb) || !germanInfinitive(verb)) return null;
    const start = m.index + m[0].length - verb.length;
    if (start < ctx.from || start >= ctx.to) return null;
    const particle = SEPARABLE.exec(verb)?.[0];
    const fix =
      particle && germanInfinitive(verb.slice(particle.length))
        ? `${particle}zu${verb.slice(particle.length)}`
        : `zu ${verb}`;
    return spoken(ctx, start, start + verb.length, [fix]);
  },
  prepositionWhat,
  makesSense,
  clipped,
  ...SPOKEN_MEASURES,
  herParticle: (m, ctx) => {
    const { short, rest } = m.groups!;
    const word = m[0];
    const low = word.toLowerCase();
    const key = short.toLowerCase();
    const capital = short !== key;
    if (rest) {
      // A dictionary word of its own ("rangieren", "Ranzen"); the dictionary also
      // lists a few colloquial raus- verbs ("rauslassen"), which stay checked.
      const known = germanVerbLike(low) || germanInfinitive(low) || germanNounReading(low) !== null;
      if (known && key === "ran") return null;
      // Capitalized inside a sentence: a noun ("die Rangliste"), unless a verb made one ("zum
      // Rumprobieren").
      if (
        capital &&
        !/(?:en|ern|eln)$/.test(rest) &&
        !/(?:^|[.!?:\n„“"»«])[ \t]*$/.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
      )
        return null;
      if (!verbAfter(rest)) return null;
    } else {
      // "Rum" is the drink; a capital at a sentence start may be either.
      if (capital || !ALONE.has(key)) return null;
    }
    // Idioms with no written twin: "sich an jemanden ranmachen", "ans Telefon rangehen",
    // "jemandem eine runterhauen", "rum wie num"; and "rein- und rausschlüpfen".
    const before = ctx.text.slice(Math.max(0, m.index - 60), m.index);
    const after = ctx.text.slice(m.index + word.length, m.index + word.length + 12);
    if (/^ran(?:zu|ge)?mach/.test(low) || (/^rum$/.test(low) && /^\s+wie\s/.test(after)))
      return null;
    if (/^ran(?:zu|ge)?geh|^ranging/.test(low) && /Telefon|Handy/.test(before)) return null;
    if (/^runter/.test(low) && /(?<!\p{L})einen?\s+$/u.test(before)) return null;
    if (/-\s+(?:und|oder)\s+$/.test(before)) return null;
    if (ctx.dictionary.has(low) || namedExampleBefore(ctx.text, m.index)) return null;
    if (englishLine(ctx.text, m.index)) return null;
    const alternatives = FULL[key].map((full) => {
      const spelled = full + rest;
      return capital ? spelled[0].toUpperCase() + spelled.slice(1) : spelled;
    });
    return {
      ruleId: "germanColloquial",
      messageKey: "review_msg_german_colloquial",
      range: { start: m.index, end: m.index + word.length },
      alternatives,
      context: { start: Math.max(0, m.index - 40), end: m.index + word.length },
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    };
  },
} satisfies Record<string, MatchFixer>;
