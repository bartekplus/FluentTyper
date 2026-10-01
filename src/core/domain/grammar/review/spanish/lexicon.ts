import { BLOOM_ALPHABET, bloomBits } from "../../implementations/helpers/EnglishLexicon";
import { SPANISH_ACCENTED_NOMINALS, SPANISH_BLOOM } from "./spanishLexicon.generated";

// Word classes read from es_ES.dic/.aff (scripts/generate-spanish-lexicon.ts). A Bloom filter
// answers, so about 0.3% of other words read as members too: every check that uses it also
// needs a closed-class frame around the word, never the lexicon alone.

let filter: Uint8Array | undefined;
function has(key: string): boolean {
  if (!filter) {
    filter = new Uint8Array(SPANISH_BLOOM.length);
    for (let i = 0; i < SPANISH_BLOOM.length; i++)
      filter[i] = BLOOM_ALPHABET.indexOf(SPANISH_BLOOM[i]);
  }
  const bits = filter;
  return bloomBits(key, bits.length * 6).every((bit) => (bits[(bit / 6) | 0] >> (bit % 6)) & 1);
}

// Verbs the dictionary lists without conjugation flags (their forms are separate entries).
const UNFLAGGED_VERBS = new Set(["ser", "estar", "haber", "ir", "poder", "dar"]);
/** A conjugated verb's infinitive ("cantar", "tener", "poder"). */
export const isVerb = (infinitive: string) =>
  UNFLAGGED_VERBS.has(infinitive) || has(`v${infinitive}`);
/** A plural-taking entry without -o/-a gender forms: a noun ("casa", "mano", "feliz"). */
export const isNounEntry = (word: string) => has(`n${word}`);
/** A masculine entry with -o/-a gender forms: an adjective or a gendered noun ("lleno"). */
export const isGenderedEntry = (masculine: string) => has(`a${masculine}`);

export type Agreement = { feminine: boolean; plural: boolean };

const IRREGULAR_PARTICIPLES = new Set(
  "abierto absuelto cubierto descubierto dicho escrito frito hecho impreso muerto puesto " +
    "compuesto dispuesto expuesto propuesto supuesto resuelto roto satisfecho visto vuelto " +
    "devuelto envuelto previsto deshecho",
);

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
  return infinitives.some(isVerb) ? agreement : null;
}

/** The gender and number of an adjective form with -o/-a forms ("llena", "españoles"), or null. */
export function genderedForm(word: string): Agreement | null {
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
export function isNoun(word: string): boolean {
  if (isNounEntry(word)) return true;
  if (word.endsWith("es") && isNounEntry(word.slice(0, -2))) return true;
  if (word.endsWith("ces") && isNounEntry(`${word.slice(0, -3)}z`)) return true;
  return word.endsWith("s") && isNounEntry(word.slice(0, -1));
}

/** A gerund, with or without enclitics: "cantando", "haciéndolo", "yendo". */
export const isGerund = (word: string) =>
  /^\p{L}{2,}(?:ando|iendo|yendo|ándo|iéndo|yéndo)(?:(?:me|te|se|nos|os|le|les|lo|los|la|las)){0,2}$/u.test(
    word,
  ) && !/^(?:comando|mando|bando|blando|fernando|orlando|armando|rolando|miranda)$/u.test(word);

const PLAIN: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };
export const plain = (word: string) => word.replace(/[áéíóú]/g, (c) => PLAIN[c]);

/**
 * Nouns and adjectives whose spelling without the written accent is only a verb form:
 * "termino" -> "término", "practica" -> "práctica", "ultimo" -> "último".
 */
export const ACCENTED_NOMINAL = new Map(
  SPANISH_ACCENTED_NOMINALS.split(" ").map((word) => [plain(word), word]),
);
