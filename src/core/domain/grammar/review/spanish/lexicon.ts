import { BLOOM_ALPHABET, bloomBits } from "../../implementations/helpers/EnglishLexicon";
import { graphWords } from "../wordGraph";
import {
  SPANISH_ACCENTED_NOMINALS,
  SPANISH_BLOOM,
  SPANISH_DENOMINAL_PLURALS,
  SPANISH_VERBS,
} from "./spanishLexicon.generated";

// Word classes read from es_ES.dic/.aff and the n-gram counts (scripts/generate-spanish-lexicon.ts).
// Verbs are listed in full; for nouns and adjectives a Bloom filter answers, so about 0.05% of
// other words read as members too: every check that uses them also needs a closed-class frame
// around the word, never the lexicon alone.

export const SPANISH_BLOOM_HASHES = 11;
let filter: Uint8Array | undefined;
function has(key: string): boolean {
  if (!filter) {
    filter = new Uint8Array(SPANISH_BLOOM.length);
    for (let i = 0; i < SPANISH_BLOOM.length; i++)
      filter[i] = BLOOM_ALPHABET.indexOf(SPANISH_BLOOM[i]);
  }
  const bits = filter;
  return bloomBits(key, bits.length * 6, SPANISH_BLOOM_HASHES).every(
    (bit) => (bits[(bit / 6) | 0] >> (bit % 6)) & 1,
  );
}

// Verbs the dictionary lists without conjugation flags (their forms are separate entries).
const UNFLAGGED_VERBS = ["ser", "estar", "haber", "ir", "poder", "dar"];
let verbs: Set<string> | undefined;
/** A conjugated verb's infinitive ("cantar", "tener", "poder"), never a typo ("trabajer"). */
export const isVerb = (infinitive: string) =>
  (verbs ??= new Set([...UNFLAGGED_VERBS, ...graphWords(SPANISH_VERBS)])).has(infinitive);
/** Endings only nouns have: "acción", "ciudad", "virtud", "pensamiento"… ("mismo" aside). */
export const NOUN_ENDING =
  /^(?:\p{L}{2,}(?:ción|sión|xión|dad|tad|tud)|\p{L}{3,}(?:miento|ismo))$/u;
/** A plural-taking entry without -o/-a gender forms: a noun ("casa", "mano", "feliz"). */
export const isNounEntry = (word: string) =>
  (NOUN_ENDING.test(word) && word !== "mismo") || has(`n${word}`);
/** A masculine entry with -o/-a gender forms: an adjective or a gendered noun ("lleno"). */
export const isGenderedEntry = (masculine: string) => has(`a${masculine}`);

export type Agreement = { feminine: boolean; plural: boolean };

const IRREGULAR_PARTICIPLES = new Set(
  (
    "abierto absuelto cubierto descubierto dicho escrito frito hecho impreso muerto puesto " +
    "compuesto dispuesto expuesto propuesto supuesto resuelto roto satisfecho visto vuelto " +
    "devuelto envuelto previsto deshecho"
  ).split(" "),
);

// Verbs whose only participle is irregular: "dicho", "hecho", "puesto", "escrito", "vuelto".
const OWN_PARTICIPLE =
  /^(?:(?!bendecir|maldecir)\p{L}*decir|\p{L}*hacer|\p{L}*poner|\p{L}*scribir|\p{L}*volver|\p{L}*solver|\p{L}*cubrir|abrir|entreabrir|\p{L}*romper|morir)$/u;

/** The gender and number of a past participle ("cansadas"), or null. */
export function participle(word: string): Agreement | null {
  const m = /^(\p{L}+)([oa])(s?)$/u.exec(word);
  if (!m) return null;
  const [, base, vowel, plural] = m;
  const agreement = { feminine: vowel === "a", plural: plural === "s" };
  if (IRREGULAR_PARTICIPLES.has(`${base}o`)) return agreement;
  const regular = /^(\p{L}+)(ad|id|íd)$/u.exec(base);
  if (!regular) return null;
  const [, stem, suffix] = regular;
  const infinitives =
    suffix === "ad" ? [`${stem}ar`] : [`${stem}er`, suffix === "id" ? `${stem}ir` : `${stem}ír`];
  // "decido" is no participle: "decir" makes "dicho" (but "bendecido").
  return infinitives.some((v) => isVerb(v) && !OWN_PARTICIPLE.test(v)) ? agreement : null;
}

/** The gender and number of an adjective form with -o/-a forms ("llena", "españoles"), or null. */
export function genderedForm(word: string): Agreement | null {
  // "mejor", "mayores", "superior": comparatives have one form for both genders.
  if (/^(?:mejor|peor|mayor|menor|\p{L}+ior)(?:es)?$/u.test(word)) return null;
  const m = /^(\p{L}+?)(o|a|os|as|es)?$/u.exec(word);
  if (!m) return null;
  const [, stem, ending = ""] = m;
  const candidates: [string, Agreement][] = [];
  const f = ending.startsWith("a");
  const plural = ending.endsWith("s");
  if (ending === "o" || ending === "os") candidates.push([`${stem}o`, { feminine: false, plural }]);
  if (f)
    candidates.push([`${stem}o`, { feminine: true, plural }], [stem, { feminine: true, plural }]);
  if (ending === "" && /[^aeiouáéíóús]$/u.test(stem))
    candidates.push([stem, { feminine: false, plural: false }]);
  if (ending === "es") candidates.push([stem, { feminine: false, plural: true }]);
  const hit = candidates.find(([masculine]) => isGenderedEntry(masculine));
  return hit ? hit[1] : null;
}

/** A participle or a gendered adjective/noun form: what may follow "está" as its attribute. */
export const attribute = (word: string): Agreement | null => participle(word) ?? genderedForm(word);

/** A noun the dictionary lists (or its regular plural): "vez", "casas", "mano". */
const ACUTE: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };
export function isNoun(word: string): boolean {
  if (isNounEntry(word)) return true;
  if (word.endsWith("es") && isNounEntry(word.slice(0, -2))) return true;
  // "acciones", "razones", "intereses": the singular's last syllable takes the accent.
  const stressed = /^(\p{L}+)([aeiou])([ns])es$/u.exec(word);
  if (stressed && isNounEntry(`${stressed[1]}${ACUTE[stressed[2]]}${stressed[3]}`)) return true;
  if (word.endsWith("ces") && isNounEntry(`${word.slice(0, -3)}z`)) return true;
  return word.endsWith("s") && isNounEntry(word.slice(0, -1));
}

/** A gerund, with or without enclitics: "cantando", "haciéndolo", "yendo". */
export const isGerund = (word: string) =>
  word.length >= 5 &&
  /^\p{L}+(?:ando|iendo|yendo|ándo|iéndo|yéndo)(?:me|te|se|nos|os|le|les|lo|los|la|las){0,2}$/u.test(
    word,
  ) &&
  !/^(?:cuando|cuándo|comando|mando|bando|contrabando|blando|nefando|fernando|orlando|armando|rolando|rolando)$/u.test(
    word,
  );

const PLAIN: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };
export const plain = (word: string) => word.replace(/[áéíóú]/g, (c) => PLAIN[c]);

/**
 * Nouns and adjectives whose spelling without the written accent is only a verb form:
 * "termino" -> "término", "practica" -> "práctica", "ultimo" -> "último".
 */
export const ACCENTED_NOMINAL = new Map(
  graphWords(SPANISH_ACCENTED_NOMINALS).map((word) => [plain(word), word]),
);

// Ending sets the stem alternations below belong to.
const STRESSED = /^(?:o|as|a|an|es|e|en)$/u; // present forms that stress the stem: "piensa", "vuelve"
const FRONT = /^[eé]/u; // "busqué", "pague", "empiece" (-car, -gar, -zar verbs only)
const BACK = /^[oa]/u; // "cojo", "elija" (-ger, -gir verbs only)
const I_TO_E = /^(?:o|as|a|an|es|e|en|amos|áis|ió|ieron|iendo)$/u; // "pide", "sirvió" (-ir only)

/** A verb whose stem changes under stress: "contar" ("cuenta"), "pedir" ("pide"). */
const stemChanges = (infinitive: string) => has(`c${infinitive}`);

/**
 * Stems a regular ending may sit on for one infinitive class: "busqu" + "é" -> "busc" (-ar),
 * "empiec" + "e" -> "empez" (-ar), "coj" + "o" -> "cog" (-er), "piens" + "a" -> "pens", "pid" +
 * "ió" -> "ped" (-ir). Each alternation applies only to the endings and paradigm that have it,
 * so a noun like "cajas" or "sillas" never reads as "cagar" or "sellar". Each stem comes with
 * whether it took a stem change ("piens" -> "pens").
 */
function stems(stem: string, ending: string, infinitive: string): [string, boolean][] {
  const out = [stem];
  if (infinitive === "ar" && FRONT.test(ending)) {
    if (stem.endsWith("qu")) out.push(`${stem.slice(0, -2)}c`);
    if (stem.endsWith("gu")) out.push(`${stem.slice(0, -2)}g`);
    if (stem.endsWith("c")) out.push(`${stem.slice(0, -1)}z`);
  }
  if (infinitive !== "ar" && BACK.test(ending) && stem.endsWith("j"))
    out.push(`${stem.slice(0, -1)}g`);
  const changed: string[] = [];
  for (const base of out) {
    if (STRESSED.test(ending)) {
      const ie = base.lastIndexOf("ie");
      if (ie > 0) changed.push(`${base.slice(0, ie)}e${base.slice(ie + 2)}`);
      const ue = base.lastIndexOf("ue");
      if (ue > 0) changed.push(`${base.slice(0, ue)}o${base.slice(ue + 2)}`);
    }
    if (infinitive === "ir" && I_TO_E.test(ending)) {
      const i = base.lastIndexOf("i");
      if (i > 0) changed.push(`${base.slice(0, i)}e${base.slice(i + 1)}`);
    }
  }
  return [
    ...out.map((base) => [base, false] as [string, boolean]),
    ...changed.map((base) => [base, true] as [string, boolean]),
  ];
}

/**
 * The verb a stem + ending spells, or null: a stem-changing verb takes its changed stem under
 * stress ("confieso", never "confeso") and only such a verb takes a changed stem ("puerta" is
 * no form of "portar").
 */
function verbOf(base: string, changed: boolean, ending: string, infinitive: string) {
  const verb = `${base}${infinitive}`;
  if (!isVerb(verb)) return null;
  if (STRESSED.test(ending) ? changed !== stemChanges(verb) : changed && !stemChanges(verb))
    return null;
  return verb;
}
const conjugates = (stem: string, ending: string, infinitives: string[]) =>
  infinitives.some((infinitive) =>
    stems(stem, ending, infinitive).some(([base, changed]) =>
      verbOf(base, changed, ending, infinitive),
    ),
  );

/**
 * The infinitive of a present form when only one verb fits: "intenta" -> "intentar", "vuelve"
 * -> "volver", "continúa" -> "continuar", "hable" -> "hablar", "coman" -> "comer".
 */
export function presentInfinitive(word: string): string | null {
  const m = /^(\p{L}{2,}?)(a|an|e|en)$/u.exec(word);
  if (!m) return null;
  const [, typed, ending] = m;
  const found = new Set<string>();
  for (const stem of new Set([typed, plain(typed)]))
    for (const infinitive of ["ar", "er", "ir"])
      for (const [base, changed] of stems(stem, ending, infinitive)) {
        const verb = verbOf(base, changed, ending, infinitive);
        if (verb) found.add(verb);
      }
  return found.size === 1 ? [...found][0] : null;
}

const IRREGULAR_SUBJUNCTIVE = new Set(
  (
    "sea seas sean seamos haya hayas hayan hayamos vaya vayas vayan vayamos esté estés estén " +
    "dé des den tenga tengas tengan venga vengas vengan haga hagas hagan diga digas digan " +
    "pueda puedas puedan quiera quieras quieran sepa sepas sepan salga salgas salgan ponga " +
    "pongas pongan traiga traigan caiga caigan oiga oigan valga vea veas vean quepa conozca " +
    "conozcas conozcan pida pidas pidan siga sigas sigan sienta sientas duerma muera"
  ).split(" "),
);

/** A present subjunctive look: "importe", "aproveche", "vengas", "llueva". */
export function subjunctiveLike(word: string): boolean {
  if (IRREGULAR_SUBJUNCTIVE.has(word)) return true;
  if (INDICATIVE.has(word)) return false;
  // "podemos" is "poder" before it is "podar": a form both ways reads as indicative.
  const ar = /^(\p{L}+?)(e|es|en|emos)$/u.exec(word);
  // A one-vowel -iar stem stresses its "i" and writes it: "píe", "críe"; "pie" is the noun.
  if (ar && /^[^aeiouáéíóú]*i$/u.test(ar[1])) return false;
  if (ar && denominalPlural(ar[1], ar[2])) return false;
  if (ar && conjugates(ar[1], ar[2], ["ar"]) && !conjugates(ar[1], ar[2], ["er", "ir"]))
    return true;
  const erIr = /^(\p{L}+?)(a|as|an|amos)$/u.exec(word);
  return (
    !!erIr && !conjugates(erIr[1], erIr[2], ["ar"]) && conjugates(erIr[1], erIr[2], ["er", "ir"])
  );
}

const INDICATIVE = new Set("va vas van vamos da das dan ha has han he es está estás".split(" "));

const IRREGULAR_SECOND_PERSON = new Set(
  (
    "eres tienes vienes puedes quieres sabes haces dices vas estás has ves das oyes sales " +
    "pones traes sueles sientes piensas juegas prefieres duermes vuelves entiendes fuiste " +
    "estuviste tuviste hiciste dijiste pudiste quisiste viniste supiste eras ibas estabas " +
    "tenías serás estarás tendrás irás harás dirás podrás querrás sabrás vendrás pondrás " +
    "saldrás habrás habías"
  ).split(" "),
);

/** A second person singular verb form ("cantas", "fuiste", "serás"), never a plural noun. */
export function secondPersonVerb(word: string): boolean {
  if (IRREGULAR_SECOND_PERSON.has(word)) return true;
  if (isNoun(word)) return false;
  // Future and conditional, accented or not: "serás", "seras", "comprarías".
  let m = /^(\p{L}+?[aeií]r)(ás|ías|as|ias)$/u.exec(word);
  if (m && isVerb(m[1].replace("í", "i"))) return true;
  m = /^(\p{L}+?)(aste|abas)$/u.exec(word);
  if (m) return conjugates(m[1], m[2], ["ar"]);
  m = /^(\p{L}+?)(iste|ías)$/u.exec(word);
  if (m) return conjugates(m[1], m[2], ["er", "ir"]);
  m = /^(\p{L}+?)(as)$/u.exec(word);
  if (m) return conjugates(m[1], m[2], ["ar"]);
  m = /^(\p{L}+?)(es)$/u.exec(word);
  return !!m && conjugates(m[1], m[2], ["er", "ir"]);
}

// Person endings over a regular stem, with the infinitives they may come from.
const FINITE_ENDINGS: [RegExp, string[]][] = [
  [/^(\p{L}+?)(o|as|a|an|es|e|en)$/u, ["ar", "er", "ir"]],
  [/^(\p{L}+?)(amos|áis|é|aste|ó|asteis|aron|aba|abas|ábamos|abais|aban)$/u, ["ar"]],
  [/^(\p{L}+?)(emos|éis|imos|ís|í|iste|ió|isteis|ieron|ía|ías|íamos|íais|ían)$/u, ["er", "ir"]],
];
const IRREGULAR_FINITE = new Set(
  (
    "es son era eran fue fueron está están estaba estaban hay he has ha hemos han había habían tiene " +
    "tienen tenía tenían va van iba iban hace hacen hizo dice dicen dijo puede pueden pudo " +
    "quiere quieren sabe saben viene vienen pone ponen sale salen ve ven da dan soy eres " +
    "somos estoy estás estamos tengo tienes voy vas vamos hago haces digo dices puedo puedes " +
    "fui fuiste fuimos estuve estuvo tuve tuvo hice dije vine quise pude supe"
  ).split(" "),
);

// Strong preterite stems and the infinitive ending they belong to: "produjo" (producir),
// "compuso" (componer), "obtuvo" (obtener), "deshizo" (deshacer), "previno" (prevenir).
const STRONG_PRETERITE =
  /^(\p{L}*?)(duj|pus|tuv|hic|hiz|vin|traj)(e|iste|o|imos|isteis|ieron|eron)$/u;
const STRONG_INFINITIVE: Record<string, string> = {
  duj: "ducir",
  pus: "poner",
  tuv: "tener",
  hic: "hacer",
  hiz: "hacer",
  vin: "venir",
  traj: "traer",
};
// Future and conditional stems that drop or change a vowel: "pondría", "tendrá", "dirán".
const SHORT_FUTURE =
  /^(\p{L}*?)(pondr|tendr|vendr|saldr|valdr|podr|sabr|cabr|querr|har|dir)(é|ás|á|emos|éis|án|ía|ías|íamos|íais|ían)$/u;
const SHORT_INFINITIVE: Record<string, string> = {
  pondr: "poner",
  tendr: "tener",
  vendr: "venir",
  saldr: "salir",
  valdr: "valer",
  podr: "poder",
  sabr: "saber",
  cabr: "caber",
  querr: "querer",
  har: "hacer",
  dir: "decir",
};

/**
 * "españoles", "colores": the plural of a common noun or adjective reads before the
 * subjunctive of the rare -ar verb made from it ("españolar", "colorar").
 */
const DENOMINAL_PLURALS = new Set(SPANISH_DENOMINAL_PLURALS.split(" "));
const denominalPlural = (stem: string, ending: string) =>
  ending === "es" && DENOMINAL_PLURALS.has(stem);

/** A finite verb form ("cuenta", "mejoran", "ordenamos", "cantará"), noun homographs included. */
export function finiteVerb(word: string): boolean {
  if (IRREGULAR_FINITE.has(word)) return true;
  const strong = STRONG_PRETERITE.exec(word);
  if (strong && isVerb(`${strong[1]}${STRONG_INFINITIVE[strong[2]]}`)) return true;
  const short = SHORT_FUTURE.exec(word);
  if (short && isVerb(`${short[1]}${SHORT_INFINITIVE[short[2]]}`)) return true;
  for (const [pattern, infinitives] of FINITE_ENDINGS) {
    const m = pattern.exec(word);
    if (m && conjugates(m[1], m[2], denominalPlural(m[1], m[2]) ? ["er", "ir"] : infinitives))
      return true;
  }
  // Future and conditional, accented or not: "cantará", "comerían", "seras".
  const m = /^(\p{L}+?[aei]r)(?:é|ás|á|emos|éis|án|ía|ías|íamos|íais|ían|as|an|ia|ias|ian)$/u.exec(
    word,
  );
  return !!m && isVerb(m[1]);
}
