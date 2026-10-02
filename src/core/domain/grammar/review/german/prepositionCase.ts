import { frameMatches, SPACE, WORD_END, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { germanNounReading } from "./germanLexicon";
import { BOUNDARY, isGerman, tokensAfter, tokensBefore, wordSet } from "./shared";

// The case a preposition governs, read from the article after it: "mit eine Freundin" (dative:
// einer), "wegen dem Regen" (genitive: des Regens), "für deiner Mutter" (accusative: deine).
// German nouns carry no gender here, so the article's own ending and the noun's ending decide;
// where they cannot, both forms are offered and nothing is preselected.

type Case = "dative" | "genitive" | "accusative";
const DATIVE = "mit von bei aus nach zu seit samt nebst außer gemäß nahe";
const GENITIVE =
  "wegen trotz während statt anstatt aufgrund bezüglich angesichts mangels infolge " +
  "abzüglich zuzüglich inklusive exklusive hinsichtlich";
const ACCUSATIVE = "für gegen durch wider ohne um betreffend";
const CASES = new Map<string, Case>([
  ...DATIVE.split(" ").map((p) => [p, "dative"] as const),
  ...GENITIVE.split(" ").map((p) => [p, "genitive"] as const),
  ...ACCUSATIVE.split(" ").map((p) => [p, "accusative"] as const),
]);
// Prepositions that also follow their noun: "meiner Meinung nach", "dem Plan gemäß".
const POSTPOSITIONS = wordSet("nach gemäß nahe");
const anyCase = (words: string) =>
  words
    .split(" ")
    .map((w) => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`)
    .join("|");
const PREPOSITION = `(?<prep>${anyCase(`${DATIVE} ${GENITIVE} ${ACCUSATIVE}`)})`;
const ADJECTIVE = "\\p{Ll}+(?:e|en|er|es|em)";
const NOUN = "\\p{Lu}[\\p{L}\\p{M}]*(?:-[\\p{L}\\p{M}]+)*";
// The polite "Ihr-" is the one capitalized determiner.
const PHRASE = new RegExp(
  `${WORD_START}${PREPOSITION}${SPACE}(?<target>(?<det>\\p{Ll}+|Ihr\\p{Ll}*)` +
    `(?<adjs>(?:${SPACE}${ADJECTIVE}){0,2})${SPACE}(?:(?<ordinal>\\d{1,2}\\.)${SPACE})?` +
    `(?<noun>${NOUN}))${WORD_END}`,
  "gdu",
);
// Pronouns, "keinen der …", "das, was …" and "ohne allem".
const PRONOUN = new RegExp(
  `${WORD_START}${PREPOSITION}${SPACE}(?<target>mich|dich|ihn|mir|dir|ihm|niemanden|jemanden|` +
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
  if (word.endsWith("s")) return !/(?:us|is|ss|rs|ls)$/.test(word) || noun(word.slice(0, -1));
  if (/(?:el|er)n$/.test(word)) return true;
  // "Kollegin" is feminine singular, whatever "Kolleg" is.
  if (/in$/.test(word)) return false;
  return /n$/.test(word) && (noun(word.slice(0, -1)) || noun(word.slice(0, -2)));
}
/** The plural without its dative -n: "Kindern" → "Kinder"; null when the -n belongs to it. */
function withoutDativeN(word: string): string | null {
  if (/(?:el|er)n$/.test(word)) return word.slice(0, -1);
  return /en$/.test(word) && noun(word.slice(0, -1)) ? word.slice(0, -1) : null;
}
const FEMININE = /(?:ung|heit|keit|schaft|ion|tät|ei|ik|ie|enz|anz|ur|in|e)$/;

/** Adjectives after a dative or genitive article: always -en. */
const weak = (adjs: string) =>
  adjs.replace(/\p{Ll}+/gu, (a) => a.replace(/(?:e|en|er|es|em)$/, "en"));
/** Adjectives with another ending: "-e" after "die", "-es" after neuter "ein". */
const ending = (adjs: string, to: string) =>
  adjs.replace(/\p{Ll}+/gu, (a) => a.replace(/(?:e|en|er|es|em)$/, to));

function genitiveNoun(word: string): string {
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
type Fixer = (stem: string, ending: string, adjs: string, noun: string) => Fix | null;

const dativeFix: Fixer = (stem, end, adjs, word) => {
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
  if (/(?:er|el)$/.test(word)) return { replacements: [feminine, plural], choice: true };
  if (stem === "ein" || stem === "kein") {
    // "eine" has no plural: feminine, unless the noun is not.
    return FEMININE.test(word)
      ? { replacements: [feminine] }
      : { replacements: [feminine, singular], choice: true };
  }
  if (word.endsWith("e")) return { replacements: [feminine, plural], choice: true };
  return { replacements: [feminine] };
};

const genitiveFix: Fixer = (stem, end, adjs, word) => {
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
  // Feminine or plural: -er for both ("wegen einer Stelle", "wegen der Leute").
  if (end === "e" && stem !== "all") {
    return { replacements: [`${join(stem, "er")}${weak(adjs)} ${word}`] };
  }
  return null;
};

const accusativeFix: Fixer = (stem, end, adjs, word) => {
  // "für deiner Frau", "wider aller Vernunft", "betreffend der Adresse": dative or genitive.
  if (end === "er" && !/(?:er|el|en|n|s)$/.test(word)) {
    return { replacements: [`${join(stem, "e")}${ending(adjs, "e")} ${word}`] };
  }
  if (end === "em") {
    const masculine = `${join(stem, "en")}${ending(adjs, "en")} ${word}`;
    const neuterForm = `${neuter(stem)}${ending(adjs, stem === "d" ? "e" : "es")} ${word}`;
    return { replacements: [masculine, neuterForm], choice: true };
  }
  // "für den Männern": a dative plural.
  if (end === "en" && stem === "d") {
    const plain = withoutDativeN(word);
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
    // "seit seine Mutter zurück ist", "während die Kinder spielen": also conjunctions.
    if (low === "seit" && end !== "en") continue;
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
    const fix = FIXERS[kind](stem, end, adjs, word);
    if (!fix) continue;
    // A date ("seit den 13. Jahrhundert") keeps its ordinal.
    if (ordinal)
      fix.replacements = fix.replacements.map((r) => r.replace(/ (\S+)$/, ` ${ordinal} $1`));
    if (ctx.dictionary.has(word.toLowerCase())) continue;
    push(m, fix);
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
