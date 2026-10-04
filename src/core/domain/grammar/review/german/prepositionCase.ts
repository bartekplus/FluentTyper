import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  deumlaut,
  germanAdjective,
  germanGender,
  type GermanGenderReading,
  germanNounReading,
  germanPastInfinitives,
  germanVerbLike,
} from "./germanLexicon";
import {
  anyCase,
  BOUNDARY,
  isGerman,
  tokensAfter,
  tokensBefore,
  wordSet,
  WORD_GATE,
} from "./shared";
import { isAuxiliary } from "./verbAgreement";

// The case a preposition governs, read from the article after it: "mit eine Freundin" (dative:
// einer), "wegen dem Regen" (genitive: des Regens), "für deiner Mutter" (accusative: deine).
// German nouns carry no gender here, so the article's own ending and the noun's ending decide;
// where they cannot, both forms are offered and nothing is preselected.

type Case = "dative" | "genitive" | "accusative";
const DATIVE = "mit von bei aus nach zu seit samt nebst außer gemäß nahe entsprechend";
const GENITIVE =
  "wegen trotz während statt anstatt aufgrund bezüglich angesichts mangels infolge " +
  "abzüglich zuzüglich inklusive exklusive hinsichtlich anhand anlässlich seitens mithilfe";
const ACCUSATIVE = "für gegen durch wider ohne um betreffend";
const CASES = new Map<string, Case>([
  ...DATIVE.split(" ").map((p) => [p, "dative"] as const),
  ...GENITIVE.split(" ").map((p) => [p, "genitive"] as const),
  ...ACCUSATIVE.split(" ").map((p) => [p, "accusative"] as const),
]);
// Prepositions that also follow their noun: "meiner Meinung nach", "dem Plan gemäß".
const POSTPOSITIONS = wordSet("nach gemäß nahe entsprechend");
const PREPOSITION = `(?<prep>${anyCase(`${DATIVE} ${GENITIVE} ${ACCUSATIVE}`)})`;
const ADJECTIVE = "\\p{Ll}+(?:e|en|er|es|em)";
const NOUN = "\\p{Lu}[\\p{L}\\p{M}]*(?:-[\\p{L}\\p{M}]+)*";
// The polite "Ihr-" is the one capitalized determiner.
const PHRASE = new RegExp(
  `${WORD_GATE}${PREPOSITION}${SPACE}(?<target>(?<det>\\p{Ll}+|Ihr\\p{Ll}*)` +
    `(?<adjs>(?:${SPACE}${ADJECTIVE}){0,2})${SPACE}(?:(?<ordinal>\\d{1,2}\\.)${SPACE})?` +
    `(?<noun>${NOUN}))${WORD_END}`,
  "gdu",
);
// Pronouns, "keinen der …", "das, was …" and "ohne allem".
const DATIVE_ONLY = "(?<prep>[Mm]it|[Vv]on|[Bb]ei|[Zz]u|[Aa]us|[Nn]ach|[Ss]eit|[Aa]ußer)";
// A span of time after a number, in the dative: "in 10 Tage" (Tagen), "ab 18 Jahre" (Jahren).
const COUNTED_TIME = new RegExp(
  `${WORD_GATE}(?<prep>[Ii]n|[Vv]or|[Aa]b|[Bb]innen)${SPACE}(?:[2-9]|[1-9]\\d{1,3}|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwanzig|dreißig|hundert)${SPACE}(?<target>Tage|Jahre|Monate)${WORD_END}`,
  "gdu",
);
// A plural noun with no article: "zu Götter", "nach Erkenntnisse", "bei Bilder".
const PLAIN_PLURAL = new RegExp(
  `${WORD_GATE}${DATIVE_ONLY}${SPACE}(?<target>\\p{Lu}\\p{Ll}+(?:e|er))${WORD_END}`,
  "gdu",
);
/**
 * Whether the word is the plural of a known noun by its form: an umlaut and -e or -er
 * ("Götter", "Düfte"), -er after a neuter ("Bilder"), or -nisse. A plain -e is left out, as
 * old datives keep it ("zu Hause", "nach Hause").
 */
function pluralForm(word: string): boolean {
  const low = word.toLowerCase();
  if (germanGender(word)?.plural === false) return false;
  if (/nisse$/.test(low)) return germanNounReading(low.slice(0, -2)) !== null;
  const stem = low.replace(/e?r?$/, "");
  const singular = deumlaut(stem);
  if (singular.length < 3) return false;
  // "Müller" is "Müll" + -er, not a plural of "Mull".
  if (singular !== stem) return germanNounReading(singular) !== null && !germanNounReading(stem);
  const neuter = germanGender(singular)?.gender;
  return /er$/.test(low) && (neuter === "n" || neuter === "x") && germanNounReading(low) !== null;
}
// An adjective in -en before a singular noun with no article: "mit ernsten Blick" (ernstem),
// "mit vollen Absicht" (voller). With no article the adjective shows the dative itself.
const STRONG_SINGULAR = new RegExp(
  `${WORD_GATE}(?<prep>[Mm]it|[Vv]on|[Bb]ei|[Aa]us|[Nn]ach|[Ss]eit|[Aa]ußer|[Ss]amt)${SPACE}(?<target>(?<adj>\\p{Ll}{3,}?)en)${SPACE}(?<noun>\\p{Lu}\\p{Ll}+)${WORD_END}`,
  "gdu",
);
const QUANTIFIER_STEMS = wordSet("all and viel wenig einig beid mehrer sämtlich ganz jed");
// A number or plural quantity, an adjective, and a plural noun in -e, -er or -el.
const COUNTED_PLURAL = new RegExp(
  `${WORD_GATE}${DATIVE_ONLY}${SPACE}(?:zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|[2-9]|[1-9]\\d{1,2}|vielen|mehreren|beiden|zahlreichen|wenigen|einigen|\\p{Ll}{3,}en)(?:${SPACE}\\p{Ll}+en)?${SPACE}(?<target>\\p{Lu}\\p{Ll}+(?:e|er|el))${WORD_END}`,
  "gdu",
);
// An adjective in -e with no article after a dative preposition, before a noun whose gender or
// plural is known: "mit perfekte Make-up" (perfektem), "mit tageslichtabhängige Steuerung"
// (-er), "mit neue Felder" (neuen Feldern). "-e" is no dative ending.
const BARE_E = new RegExp(
  `${WORD_GATE}(?<prep>[Mm]it|[Vv]on|[Bb]ei|[Aa]us|[Aa]ußer|[Ss]amt)${SPACE}(?<target>(?<adj>\\p{Ll}{3,}?)e${SPACE}(?<noun>\\p{Lu}\\p{L}*(?:-\\p{L}+)*))${WORD_END}`,
  "gdu",
);
const DETERMINER_STEMS =
  /^(?:all|viel|wenig|ander|beid|einig|mehrer|solch|welch|manch|mein|dein|sein|ihr|unser|eur|dies|jen|jed|kein|ein|d)$/;
// An adjective in -e before a noun whose ending only a plural has ("Ausstellungen").
const BARE_PLURAL = new RegExp(
  `${WORD_GATE}${DATIVE_ONLY}${SPACE}(?<target>\\p{Ll}{3,}e)${SPACE}\\p{Lu}\\p{Ll}+(?:ungen|heiten|keiten|schaften|ionen|täten|innen)${WORD_END}`,
  "gdu",
);
const PRONOUN = new RegExp(
  `${WORD_GATE}${PREPOSITION}${SPACE}(?<target>mich|dich|ihn|mir|dir|ihm|niemanden|jemanden|` +
    `(?:k?einen)(?=${SPACE}de[rs]${WORD_END})|das(?=,${SPACE}(?:was|wo)${WORD_END})|allem(?=[ \\t]*[.!?,]))` +
    WORD_END,
  "gdu",
);
const PRONOUN_FIX: Readonly<Record<Case, Readonly<Record<string, string>>>> = {
  dative: {
    mich: "mir",
    dich: "dir",
    ihn: "ihm",
    niemanden: "niemandem",
    jemanden: "jemandem",
    einen: "einem",
    keinen: "keinem",
    das: "dem",
  },
  genitive: {},
  accusative: { mir: "mich", dir: "dich", ihm: "ihn", allem: "alles" },
};

// Determiner stems and endings: d-ie/-as/-en/-em/-er/-es, ein-, mein-, dies-, all-.
const DEFINITE: Readonly<Record<string, string>> = {
  die: "e",
  das: "s",
  den: "en",
  dem: "em",
  der: "er",
  des: "es",
};
// ein-words take no ending in the masculine and neuter nominative ("ein", "mein", "unser").
const EIN_WORDS = wordSet("ein kein mein dein sein ihr unser euer");
const STEMS = wordSet("ein kein mein dein sein ihr unser eur euer dies jen jed welch solch all");

/** [stem, ending] of a determiner, or null: "meinen" → ["mein", "en"], "das" → ["d", "s"]. */
function split(typed: string): [string, string] | null {
  const det = typed.toLowerCase();
  if (Object.hasOwn(DEFINITE, det)) return ["d", DEFINITE[det]];
  for (const ending of ["en", "em", "er", "es", "e", ""]) {
    if (!det.endsWith(ending)) continue;
    const stem = det.slice(0, det.length - ending.length);
    if (!STEMS.has(stem)) continue;
    // "mit ihr Deutsch sprechen": the pronoun.
    if (ending === "" && (!EIN_WORDS.has(stem) || stem === "ihr")) return null;
    return [typed.slice(0, stem.length), ending];
  }
  return null;
}
function join(stem: string, ending: string): string {
  if (stem === "d")
    return { e: "die", s: "das", en: "den", em: "dem", er: "der", es: "des" }[ending]!;
  return (stem.toLowerCase() === "euer" ? stem.slice(0, 1) + "ur" : stem) + ending;
}
/** The neuter nominative/accusative: "das", "ein", "dieses". */
function neuter(stem: string): string {
  if (stem === "d") return "das";
  return EIN_WORDS.has(stem.toLowerCase()) ? stem : stem === "eur" ? "euer" : `${stem}es`;
}

const noun = (word: string) => germanNounReading(word.toLowerCase()) !== null;
/** A dative plural: "Autos", "Kindern" (Kinder + n), "Frauen" (Frau + en). */
function dativePlural(word: string): boolean {
  // "Autos", "Hotels", "Wellenhofs"; "Haus", "Kurs" and "Pass" are singular.
  if (word.endsWith("s")) {
    // "Termins": a genitive singular of a noun with a plural in -e or -en ("Termine").
    const stem = word.slice(0, -1);
    const masculineOrNeuter = /^[mnx]$/.test(germanGender(stem)?.gender ?? "");
    if (/[^aeiouys]$/.test(stem) && masculineOrNeuter && (noun(`${stem}e`) || noun(`${stem}en`)))
      return false;
    return !/(?:us|is|ss|rs|ls)$/.test(word) || noun(stem);
  }
  if (/(?:el|er)n$/.test(word)) return true;
  // "Kollegin" is feminine singular, whatever "Kolleg" is.
  if (/in$/.test(word)) return false;
  return /n$/.test(word) && (headNoun(word.slice(0, -1)) || headNoun(word.slice(0, -2)));
}
/** A noun, or a compound whose last part of four letters or more is one ("Aussichtspunkte"). */
const headNoun = (word: string) =>
  [...word].some((_, i) => (i === 0 || (i >= 3 && word.length - i >= 4)) && noun(word.slice(i)));
/** The plural without its dative -n: "Kindern" → "Kinder"; null when the -n belongs to it. */
function withoutDativeN(word: string): string | null {
  if (/(?:el|er)n$/.test(word)) return word.slice(0, -1);
  return /en$/.test(word) && noun(word.slice(0, -1)) ? word.slice(0, -1) : null;
}
/** A form that is only a plural: "Kinder" (Kind), "Mütter" (Mutter), "Äpfel" (Apfel). */
function pluralOnly(word: string): boolean {
  if (pluralForm(word)) return true;
  const low = word.toLowerCase();
  const plain = deumlaut(low);
  return /(?:er|el)$/.test(low) && plain !== low && noun(plain);
}

/** Adjectives after a dative or genitive article: always -en. */
const weak = (adjs: string) =>
  adjs.replace(/\p{Ll}+/gu, (a) => a.replace(/(?:e|en|er|es|em)$/, "en"));
/** Adjectives with another ending: "-e" after "die", "-es" after neuter "ein". */
const ending = (adjs: string, to: string) =>
  adjs.replace(/\p{Ll}+/gu, (a) => a.replace(/(?:e|en|er|es|em)$/, to));

function genitiveNoun(word: string): string {
  // "Termins": already a genitive.
  if (/[^aeiouys]s$/.test(word) && !dativePlural(word)) return word;
  if (/(?:s|ß|x|z)$/.test(word)) return `${word}es`;
  // "Menschen", "Kunden": a weak noun keeps its -en ("des Menschen"); "Wagen" takes -s.
  const low = word.toLowerCase();
  if (low === "herrn") return word;
  if (/en$/.test(low) && (noun(low.slice(0, -2)) || noun(low.slice(0, -1)))) return word;
  return `${word}s`;
}
/** "des Beschlusses" → "Beschluss", "eines Hauses" → "Haus". */
const withoutGenitive = (word: string) =>
  /(?:ss|ß|z|x|ch|t|d|g)es$/.test(word) ? word.slice(0, -2) : word.replace(/s$/, "");

type Fix = { replacements: string[]; choice?: true };
type Fixer = (
  stem: string,
  ending: string,
  adjs: string,
  noun: string,
  gender: GermanGenderReading | null,
) => Fix | null;

const dativeFix: Fixer = (stem, end, adjs, word, gender) => {
  const singular = `${join(stem, "em")}${weak(adjs)} ${word}`;
  const feminine = `${join(stem, "er")}${weak(adjs)} ${word}`;
  const plural = `${join(stem, "en")}${weak(adjs)} ${/[^ns]$/.test(word) ? `${word}n` : word}`;
  // "gemäß des Beschlusses", "nahe eines Hauses": the genitive.
  if (end === "es" && /s$/.test(word)) {
    return { replacements: [`${join(stem, "em")}${weak(adjs)} ${withoutGenitive(word)}`] };
  }
  if (end === "" || end === "s" || (end === "es" && stem !== "d")) {
    // "von dieses Aussichtspunkten": a plural, or unclear.
    if (end === "es" && /n$/.test(word))
      return dativePlural(word) ? { replacements: [plural] } : null;
    return { replacements: [singular] };
  }
  if (end === "en") {
    return dativePlural(word) || /(?:er|el|en|e)$/.test(word) ? null : { replacements: [singular] };
  }
  if (end !== "e") return null;
  if (dativePlural(word) || stem === "all") return { replacements: [plural] };
  // "eine" has no plural; "keine", "die" and "meine" have one.
  const hasPlural = stem !== "ein";
  // The noun's gender decides between the feminine and the masculine or neuter.
  if (gender?.gender === "f") return { replacements: [feminine] };
  // "mit die Kinder", "mit die Mütter": a plural form.
  if (!gender && pluralOnly(word)) return hasPlural ? { replacements: [plural] } : null;
  const pluralEnding = hasPlural && /(?:e|er|el|en|chen|lein)$/.test(word);
  if (gender) {
    // "mit die Lehrer": a masculine noun that is also its own plural.
    return gender.plural && pluralEnding
      ? { replacements: [singular, plural], choice: true }
      : { replacements: [singular] };
  }
  // The gender is unknown: "dem" (masculine or neuter), "der" (feminine) or "den" (plural) can
  // be correct, so all are offered and none is preselected.
  return {
    replacements: pluralEnding ? [singular, feminine, plural] : [singular, feminine],
    choice: true,
  };
};

const genitiveFix: Fixer = (stem, end, adjs, word, gender) => {
  const singular = `${join(stem, "es")}${weak(adjs)} ${genitiveNoun(word)}`;
  if (end === "em") return { replacements: [singular] };
  if (end === "en") {
    // "wegen den Autos" (plural), "wegen unseren Termin" (singular).
    if (dativePlural(word)) {
      // "Fanartikeln" loses its dative -n; "Katzen" or "Geschehnissen" may or may not.
      const plain = withoutDativeN(word);
      const sure = /(?:el|er)n$/.test(word);
      const plurals = plain ? (sure ? [plain] : [plain, word]) : [word];
      return {
        replacements: plurals.map((n) => `${join(stem, "er")}${adjs} ${n}`),
        ...(plurals.length > 1 ? { choice: true as const } : {}),
      };
    }
    if (/(?:er|el|en|e)$/.test(word) || stem === "all") return null;
    return { replacements: [singular] };
  }
  if (end !== "e" || stem === "all") return null;
  // Feminine or plural: -er for both ("wegen einer Stelle", "wegen der Leute").
  const feminineOrPlural = { replacements: [`${join(stem, "er")}${weak(adjs)} ${word}`] };
  if (gender?.gender === "f") return feminineOrPlural;
  if (gender) {
    // "wegen die Lehrer": "die" before a masculine noun is its plural; "eine" has none.
    return gender.plural && stem !== "ein" ? feminineOrPlural : { replacements: [singular] };
  }
  if (dativePlural(word) || pluralOnly(word)) return feminineOrPlural;
  // The gender is unknown: "des" (masculine or neuter) or "der" (feminine or plural) can be
  // correct, so both are offered and none is preselected.
  return { replacements: [singular, feminineOrPlural.replacements[0]], choice: true };
};

const accusativeFix: Fixer = (stem, end, adjs, word, gender) => {
  // "für deiner Frau", "wider aller Vernunft", "betreffend der Adresse": dative or genitive.
  if (end === "er" && !/(?:er|el|en|n|s)$/.test(word)) {
    return { replacements: [`${join(stem, "e")}${ending(adjs, "e")} ${word}`] };
  }
  if (end === "em") {
    const masculine = `${join(stem, "en")}${ending(adjs, "en")} ${word}`;
    const neuterForm = `${neuter(stem)}${ending(adjs, stem === "d" ? "e" : "es")} ${word}`;
    if (gender?.gender === "m") return { replacements: [masculine] };
    if (gender?.gender === "n") return { replacements: [neuterForm] };
    return { replacements: [masculine, neuterForm], choice: true };
  }
  // "für den Männern": a dative plural.
  if (end === "en" && stem === "d") {
    const plain = withoutDativeN(word);
    // "um den Willen", "für den Kollegen": a weak masculine noun's accusative singular; "für
    // den Lampen": a feminine plural, which keeps its -n.
    if (plain?.endsWith("e")) {
      return germanGender(plain)?.gender === "f" ? { replacements: [`die${adjs} ${word}`] } : null;
    }
    return plain ? { replacements: [`die${adjs} ${plain}`] } : null;
  }
  return null;
};
const FIXERS: Readonly<Record<Case, Fixer>> = {
  dative: dativeFix,
  genitive: genitiveFix,
  accusative: accusativeFix,
};

// "mit die größte", "mit das Beste", "mit meine Lieblingskneipe": "among the …".
const SUPERLATIVE = /(?:s|ß)t(?:e|en|er|es)$|^ *Lieblings/;

/** A zu-infinitive later in the clause: "ohne dem Leser zu sagen", "zu diesen Ort einzustufen". */
function zuInfinitiveAfter(ctx: DetectContext, end: number, separate: boolean): boolean {
  const rest = ctx.text.slice(end, end + 120).split(/[.!?;:,\n]/)[0];
  if (/\p{L}zu\p{Ll}+n(?!\p{L})/u.test(rest)) return true;
  return separate && /(?<!\p{L})zu[ \t]+\p{Ll}/u.test(rest);
}

/** Contexts where the word is no preposition over this phrase. */
function guarded(ctx: DetectContext, m: RegExpExecArray, kind: Case): boolean {
  const prep = m.groups!.prep;
  const low = prep.toLowerCase();
  const prior = tokensBefore(ctx.text, m.index, 3).at(-1) ?? "";
  // Capitalized inside a sentence: a noun ("auf verschiedenen Wegen").
  if (/^\p{Lu}/u.test(prep) && !BOUNDARY.test(prior)) return false;
  // "der Sache wegen", "an meiner statt", "meiner Meinung nach": a postposition.
  const nounBefore = /^\p{Lu}/u.test(prior) && !BOUNDARY.test(prior);
  const genitivePronoun = /^(?:meiner|deiner|seiner|ihrer|unserer|eurer)$/.test(prior);
  if ((kind === "genitive" || POSTPOSITIONS.has(low)) && (nounBefore || genitivePronoun)) {
    return false;
  }
  // "ab und zu", "nach und nach": adverbs; "hier zu" is "hierzu" written apart.
  if (low === "zu" && /^(?:hier|da|wo)$/i.test(prior)) return false;
  if (prior === "und" && (low === "zu" || low === "nach")) return false;
  // "was für einer", "sowas von die Nase voll", ", wegen dem": idioms and relative pronouns.
  if (/^(?:was|sowas)$/i.test(prior) && (low === "für" || low === "von")) return false;
  if (prior === "," && /^(?:dem|der|den|denen)$/.test(m.groups!.target.split(/[ \t]/)[0])) {
    return false;
  }
  // "ohne dem Leser zu sagen"; "half mit das Fahrrad reinzubekommen": a particle.
  const separate = /^(?:ohne|um|statt|anstatt|zu)$/.test(low);
  return !zuInfinitiveAfter(ctx, m.index + m[0].length, separate);
}

/**
 * Whether the clause after `index` reads as a subordinate one: it ends in a verb form, or a
 * comma closes it ("Seit die Mauer fiel, …").
 */
function clauseEndsInVerb(ctx: DetectContext, index: number): boolean {
  const rest = /^[^.,;:!?\n]*[.,;:!?\n]?/.exec(ctx.text.slice(index, index + 200))![0];
  if (rest.endsWith(",")) return true;
  const last = rest.match(/\p{L}+/gu)?.at(-1);
  return (
    !!last &&
    (germanVerbLike(last) ||
      isAuxiliary(last) ||
      germanPastInfinitives(last).length > 0 ||
      /^\p{Ll}+(?:t|en)$/u.test(last))
  );
}

function prepositionCase(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  const push = (m: RegExpExecArray, fix: Fix) => {
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "germanPrepositionCase",
      messageKey: "review_msg_german_preposition_case",
      range: { start, end },
      alternatives: fix.replacements,
      context: { start: m.index, end },
      ...(fix.choice ? { requiresChoice: true as const } : {}),
    });
  };
  for (const m of frameMatches(ctx, PHRASE)) {
    const { prep, det, adjs = "", noun: word, ordinal } = m.groups!;
    const low = prep.toLowerCase();
    const kind = CASES.get(low)!;
    const parts = split(det);
    if (!parts || !guarded(ctx, m, kind)) continue;
    const [stem, end] = parts;
    if (low === "mit" && (SUPERLATIVE.test(adjs) || SUPERLATIVE.test(word))) continue;
    if (/^bei die Fische$/i.test(`${prep} ${det} ${word}`)) continue;
    // "seit seine Mutter zurück ist", "während die Kinder spielen": also conjunctions, whose
    // clause ends in its verb ("Seit seine Jugend wohnt er hier" has none there).
    if (low === "seit" && end !== "en" && clauseEndsInVerb(ctx, m.indices!.groups!.noun[1])) {
      continue;
    }
    if (low === "während" && end === "e") continue;
    // "gemäß des Beschlusses", "nahe des Hauses": the genitive these take in error; "mit
    // des Kaisers Hilfe" is an old genitive attribute. "nahe" is otherwise an adjective.
    const genitiveForm = end === "es" && /s$/.test(word);
    if (kind === "dative" && (low === "nahe" ? !genitiveForm : low !== "gemäß" && genitiveForm)) {
      continue;
    }
    // "für der Forschung dienende Flächen": the article may belong to an attribute.
    if (end === "er" && stem === "d" && low !== "wider" && low !== "betreffend") continue;
    const after = tokensAfter(ctx.text, m.indices!.groups!.noun[1], 2);
    const next = after[0] ?? "";
    // "Statt einem Bluetooth Mikrofon" (open compound), "mit den Bau und Elektroarbeiten"
    // (coordination); a genitive after the noun ("von die Lippen Gottes") is fine.
    if (/^\p{Lu}/u.test(next) && !/es$/.test(next)) continue;
    if (/^(?:und|oder|sowie|&|\/)$/.test(next) && /^\p{Lu}/u.test(after[1] ?? "")) continue;
    // "durch der Natur innewohnende Kräfte".
    if (/^\p{Ll}+end(?:e|en|er|es|em)?$/u.test(next)) continue;
    const fix = FIXERS[kind](stem, end, adjs, word, germanGender(word.split("-").at(-1)!));
    if (!fix) continue;
    // A date ("seit den 13. Jahrhundert") keeps its ordinal.
    if (ordinal)
      fix.replacements = fix.replacements.map((r) => r.replace(/ (\S+)$/, ` ${ordinal} $1`));
    if (ctx.dictionary.has(word.toLowerCase())) continue;
    push(m, fix);
  }
  // "mit zwei Kinder" → Kindern: a counted plural takes the dative -n.
  for (const m of frameMatches(ctx, COUNTED_PLURAL)) {
    const noun = m.groups!.target;
    if (!guarded(ctx, m, "dative") || ctx.dictionary.has(noun.toLowerCase())) continue;
    // "bis zu drei Bücher ausleihen": "bis zu" is "up to", the verb sets the case.
    if (/bis[ \t]+$/i.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))) continue;
    // "Tierärzten": a compound whose head the dictionary knows in the dative plural.
    const dative = `${noun}n`.toLowerCase();
    const known = [...dative].some(
      (_, i) =>
        (i === 0 || (i >= 3 && dative.length - i >= 4)) &&
        germanNounReading(dative.slice(i)) !== null,
    );
    if (!known) continue;
    // "zu ihren Mutter": a feminine singular after an -en word wants "ihrer", not "Muttern".
    const counted = /(?:zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|\d)/.test(m[0]);
    const reading = germanGender(noun);
    if (!counted && reading?.gender === "f" && !reading.plural) continue;
    // "die zu fällenden Bäume", "viel zu knappen Gelder": "zu" before an adjective is no
    // preposition.
    const quantity = /(?:vielen|mehreren|beiden|zahlreichen|wenigen|einigen)(?!\p{L})/u.test(m[0]);
    if (!counted && !quantity && m.groups!.prep.toLowerCase() === "zu") continue;
    push(m, { replacements: [`${noun}n`] });
  }
  for (const m of frameMatches(ctx, PLAIN_PLURAL)) {
    const noun = m.groups!.target;
    const next = tokensAfter(ctx.text, m.indices!.groups!.target[1], 1)[0] ?? "";
    // "Ärzte ohne Grenzen": a name.
    if (
      /^(?:\p{Lu}|ohne$)/u.test(next) ||
      !pluralForm(noun) ||
      ctx.dictionary.has(noun.toLowerCase())
    ) {
      continue;
    }
    if (!guarded(ctx, m, "dative")) continue;
    push(m, { replacements: [`${noun}n`] });
  }
  for (const m of frameMatches(ctx, STRONG_SINGULAR)) {
    const { adj, noun } = m.groups!;
    if (QUANTIFIER_STEMS.has(adj) || !(germanAdjective(adj) || germanAdjective(`${adj}e`)))
      continue;
    const reading = germanGender(noun);
    if (!reading || reading.plural) continue;
    const next = tokensAfter(ctx.text, m.indices!.groups!.noun[1], 1)[0] ?? "";
    if (/^\p{Lu}/u.test(next) || ctx.dictionary.has(`${adj}en`)) continue;
    if (!guarded(ctx, m, "dative")) continue;
    push(m, { replacements: [`${adj}${reading.gender === "f" ? "er" : "em"}`] });
  }
  for (const m of frameMatches(ctx, COUNTED_TIME)) {
    const next = tokensAfter(ctx.text, m.indices!.groups!.target[1], 1)[0] ?? "";
    // "vor 3 Jahre alt", "in 2 Jahre aufgeteilt": a measure, not a time.
    if (/^(?:alt|jung|älter|lang|später|früher)$/.test(next) || /^\p{Lu}/u.test(next)) continue;
    // "in 12 Monate eingeteilt": "in" with the accusative of a division.
    if (/^[Ii]n$/.test(m.groups!.prep) && /^\p{Ll}+t$/u.test(next)) continue;
    push(m, { replacements: [`${m.groups!.target}n`] });
  }
  for (const m of frameMatches(ctx, BARE_E)) {
    const { adj, noun } = m.groups!;
    // "tageslichtabhängig": a compound adjective whose last part is known.
    const known = [...adj].some(
      (_, i) => (i === 0 || (i >= 3 && adj.length - i >= 5)) && germanAdjective(adj.slice(i)),
    );
    if (DETERMINER_STEMS.test(adj) || !(known || /^(?:ge|ver|be|er|ent)\p{Ll}+t$/u.test(adj)))
      continue;
    if (/(?:ungen|heiten|keiten|schaften|ionen|täten|innen)$/.test(noun)) continue;
    const next = tokensAfter(ctx.text, m.indices!.groups!.noun[1], 1)[0] ?? "";
    if (/^\p{Lu}/u.test(next) || ctx.dictionary.has(`${adj}e`)) continue;
    const reading = germanGender(noun.split("-").at(-1)!);
    let fix: string | null = null;
    // "Sitzreihen", "Feldern": a dative plural already.
    const dative =
      /(?:er|el)n$/.test(noun) ||
      (/en$/.test(noun) && germanGender(noun.slice(0, -1))?.gender === "f");
    if (reading && !reading.plural) fix = `${adj}${reading.gender === "f" ? "er" : "em"} ${noun}`;
    else if (dative && headNoun(noun.slice(0, -1).toLowerCase())) fix = `${adj}en ${noun}`;
    else if (pluralForm(noun)) fix = `${adj}en ${noun}n`;
    if (!fix || !guarded(ctx, m, "dative")) continue;
    push(m, { replacements: [fix] });
  }
  // "mit spannende Ausstellungen" → spannenden: a plural without an article.
  for (const m of frameMatches(ctx, BARE_PLURAL)) {
    if (!guarded(ctx, m, "dative")) continue;
    push(m, { replacements: [`${m.groups!.target}n`] });
  }
  for (const m of frameMatches(ctx, PRONOUN)) {
    const kind = CASES.get(m.groups!.prep.toLowerCase())!;
    const replacement = PRONOUN_FIX[kind][m.groups!.target];
    if (replacement && guarded(ctx, m, kind)) push(m, { replacements: [replacement] });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanPrepositionCase"], detect: prepositionCase },
];
