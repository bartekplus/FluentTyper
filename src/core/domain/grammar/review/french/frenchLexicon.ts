import { BLOOM_ALPHABET, bloomBits } from "../../implementations/helpers/EnglishLexicon";
import { VERB_HOMOGRAPHS, VERB_LEMMAS, VERB_RULES } from "./frenchLexicon.generated";
import { ADJECTIVE_LEMMAS, ADJECTIVE_RULES } from "./frenchAdjectives.generated";
import { FEMININE, MASCULINE } from "./frenchGender.generated";
import { NOUN_BLOOM } from "./frenchNouns.generated";

/** Subject persons as bits: je, tu, il/elle/on, nous, vous, ils/elles. */
export const JE = 1;
export const TU = 2;
export const IL = 4;
export const NOUS = 8;
export const VOUS = 16;
export const ILS = 32;

/** A person bitmask for a finite form; I infinitive, G present participle, Q past participle. */
export type VerbSlot = number | "I" | "G" | "Q";

export interface VerbReading {
  lemma: string;
  slot: VerbSlot;
  /** The rule's flag and tense position, to conjugate the same tense for another person. */
  flag: string;
  tense: number;
}

type Rule = { strip: string; add: string; cond: RegExp; slot: VerbSlot; tense: number };

let rulesByFlag: Map<string, Rule[]> | null = null;
let rulesByEnding: Map<string, Array<Rule & { flag: string }>> | null = null;
let lemmaFlags: Map<string, readonly string[]> | null = null;
let homographs: Set<string> | null = null;

const lowest = (mask: number) => mask & -mask;

function decodeFrontCoded(text: string): string[] {
  let previous = "";
  return text
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      previous = previous.slice(0, parseInt(token[0], 36)) + token.slice(1);
      return previous;
    });
}

function load() {
  if (rulesByFlag) return;
  rulesByFlag = new Map();
  rulesByEnding = new Map();
  let flag = "";
  let common: [string, string] = ["", ""];
  let tense = 0;
  let previous: VerbSlot = "I";
  for (const line of VERB_RULES.split("\n")) {
    const parts = line.split(" ");
    if (line.startsWith("@")) {
      flag = parts[0].slice(1);
      common = [parts[1], parts[2]];
      tense = 0;
      previous = "I";
      rulesByFlag.set(flag, []);
      continue;
    }
    const [add, rawSlot] = parts;
    const [strip, cond] =
      parts.length > 2 ? [parts[2], parts.length > 3 ? parts[3] : parts[2]] : common;
    const slot: VerbSlot = /^\d+$/.test(rawSlot) ? Number(rawSlot) : (rawSlot as VerbSlot);
    // A tense runs je -> ils; a finite rule whose first person is not after the previous rule's
    // starts the next one (variants of one slot share its mask).
    if (typeof slot === "number") {
      if (typeof previous !== "number" || (slot !== previous && lowest(slot) <= lowest(previous)))
        tense++;
    }
    previous = slot;
    const rule = { strip, add, cond: new RegExp(`${cond}$`), slot, tense };
    rulesByFlag.get(flag)!.push(rule);
    const key = add.slice(-1);
    const list = rulesByEnding.get(key) ?? [];
    list.push({ ...rule, flag });
    rulesByEnding.set(key, list);
  }
  lemmaFlags = new Map();
  for (const line of VERB_LEMMAS.split("\n")) {
    const [flags, ending, ...rest] = line.split(" ");
    const list = flags.match(/../g) ?? [];
    for (const stem of decodeFrontCoded(rest.join(" "))) lemmaFlags.set(stem + ending, list);
  }
  homographs = new Set(decodeFrontCoded(VERB_HOMOGRAPHS));
}

// Detectors ask about the same words many times per chunk; cleared when full.
const readingsCache = new Map<string, VerbReading[]>();

/** Every verb reading of a lowercase word form, from the bundled dictionary's conjugations. */
export function verbReadings(word: string): VerbReading[] {
  const cached = readingsCache.get(word);
  if (cached) return cached;
  if (readingsCache.size > 5_000) readingsCache.clear();
  const out = readingsOf(word);
  readingsCache.set(word, out);
  return out;
}

function readingsOf(word: string): VerbReading[] {
  load();
  const out: VerbReading[] = [];
  for (const key of [word.slice(-1), ""]) {
    for (const rule of rulesByEnding!.get(key) ?? []) {
      if (!word.endsWith(rule.add)) continue;
      const lemma = word.slice(0, word.length - rule.add.length) + rule.strip;
      if (!rule.cond.test(lemma) || !lemmaFlags!.get(lemma)?.includes(rule.flag)) continue;
      out.push({ lemma, slot: rule.slot, flag: rule.flag, tense: rule.tense });
    }
  }
  return out;
}

/** The persons a word can agree with as a finite verb (0 when it is not one). */
export function finitePersons(word: string): number {
  let mask = 0;
  for (const { slot } of verbReadings(word)) if (typeof slot === "number") mask |= slot;
  return mask;
}

/** The lemma's forms in a reading's tense for a person. */
export function conjugate(reading: VerbReading, person: number): string[] {
  load();
  const forms = new Set<string>();
  for (const rule of rulesByFlag!.get(reading.flag) ?? []) {
    if (rule.tense !== reading.tense || typeof rule.slot !== "number" || !(rule.slot & person))
      continue;
    if (!rule.cond.test(reading.lemma) || !reading.lemma.endsWith(rule.strip)) continue;
    forms.add(reading.lemma.slice(0, reading.lemma.length - rule.strip.length) + rule.add);
  }
  return [...forms];
}

/** Whether the lemma is a dictionary verb. */
export function isVerbLemma(lemma: string): boolean {
  load();
  return lemmaFlags!.has(lemma);
}

/** A verb form that is also spelled by a non-verb entry: "porte", "passé", "dîner". */
export function isVerbHomograph(word: string): boolean {
  load();
  return homographs!.has(word);
}

let nounBloom: Uint8Array | null = null;

/** Whether the dictionary inflects this lowercase word as a noun or adjective (a Bloom filter:
 * about 1% of other strings also pass). */
export function isInflectedNoun(word: string): boolean {
  if (!nounBloom) {
    nounBloom = new Uint8Array(NOUN_BLOOM.length);
    for (let i = 0; i < NOUN_BLOOM.length; i++)
      nounBloom[i] = BLOOM_ALPHABET.indexOf(NOUN_BLOOM[i]);
  }
  const filter = nounBloom;
  return bloomBits(word, filter.length * 6).every(
    (bit) => (filter[(bit / 6) | 0] >> (bit % 6)) & 1,
  );
}

// Invariable words the verb and noun lists leave out, vowel- or y-initial ones: what an elision
// runs into.
const FUNCTION_WORDS = new Set(
  (
    "il ils elle elles on en y un une à au aux avec après avant aussi alors ainsi assez autant " +
    "autour autre autres aucun aucune auprès aujourd'hui ailleurs afin encore ensuite ensemble " +
    "entre envers environ et est ici ou où oui eux enfin hier aussitôt autrefois auparavant " +
    "emblée exprès ô"
  ).split(" "),
);

/** Whether a lowercase word is French as far as the bundled lists know: a verb form, a noun or
 * adjective (singular or plural), an -ment adverb or a function word. Foreign words ("also",
 * "up", "off") are not. */
export function isFrenchWord(word: string): boolean {
  if (FUNCTION_WORDS.has(word) || word.endsWith("ment")) return true;
  if (verbReadings(word).length || isInflectedNoun(word)) return true;
  const singular = word.replace(/aux$/, "al").replace(/[sx]$/, "");
  return singular !== word && isInflectedNoun(singular);
}

export type Gender = "m" | "f";

// Endings that give a noun its gender; their exceptions are in the generated lists (from the
// n-gram counts), in SUFFIX_EXCEPTIONS or in EITHER_GENDER. Longest ending first.
const SUFFIX_GENDER: ReadonlyArray<[string, Gender]> = [
  ["graphie", "f"],
  ["logie", "f"],
  ["aison", "f"],
  ["ssure", "f"],
  ["trice", "f"],
  ["eille", "f"],
  ["illon", "m"],
  ["tion", "f"],
  ["sion", "f"],
  ["xion", "f"],
  ["ture", "f"],
  ["ance", "f"],
  ["ence", "f"],
  ["esse", "f"],
  ["ette", "f"],
  ["erie", "f"],
  ["euse", "f"],
  ["isme", "m"],
  ["ment", "m"],
  ["ité", "f"],
  ["age", "m"],
  ["eau", "m"],
  ["ail", "m"],
  ["eil", "m"],
  ["oir", "m"],
  ["ier", "m"],
  ["ing", "m"],
  ["et", "m"],
  ["at", "m"],
];
/** Exceptions to the endings that the n-gram counts may not show (null: either gender). */
const SUFFIX_EXCEPTIONS = new Map<string, Gender | null>([
  ["silence", "m"],
  ["bastion", "m"],
  ["jument", "f"],
  ["image", "f"],
  ["plage", "f"],
  ["cage", "f"],
  ["nage", "f"],
  ["rage", "f"],
  ["sage", null],
  ["eau", "f"],
  ["peau", "f"],
  ["comité", "m"],
  ["squelette", "m"],
]);

// Nouns of either gender: people named by one form ("un/une élève") and words whose gender
// changes their meaning ("le/la tour"). Endings of people's names are covered as a whole.
const EITHER_GENDER = new Set(
  (
    "enfant élève ministre secrétaire collègue camarade adulte malade partenaire bénévole " +
    "responsable membre juge guide garde interprète philosophe stagiaire cadre aide concierge " +
    "complice architecte astronaute pilote poète médecin professeur auteur docteur ingénieur chef " +
    "écrivain peintre maire témoin mannequin successeur prédécesseur défenseur entrepreneur " +
    "amateur sénateur gouverneur procureur notaire libraire vétérinaire militaire fonctionnaire " +
    "tour livre poste mode manche voile page moule somme vase critique mémoire physique pendule " +
    "crêpe greffe merci pupille radio solde office espace œuvre orge hymne foudre enseigne faune " +
    "finale geste mousse ombre parallèle platine pourpre relâche vague gens amour délice orgue " +
    "pâque couple interview chose personne propre"
  ).split(" "),
);
const EITHER_ENDINGS = /(?:iste|logue|graphe|naute|aire|crate|phile|phobe|cide)$/;

/** Whether a noun has one gender this module may tell. */
export function genderable(word: string): boolean {
  return !EITHER_GENDER.has(word) && !EITHER_ENDINGS.test(word);
}

/** The gender a noun's ending gives it, if any. */
export function suffixGender(word: string): Gender | null {
  if (SUFFIX_EXCEPTIONS.has(word)) return SUFFIX_EXCEPTIONS.get(word)!;
  for (const [ending, gender] of SUFFIX_GENDER)
    if (word.endsWith(ending) && word.length > ending.length + 1) return gender;
  return null;
}

let genders: Map<string, Gender> | null = null;

/** A singular noun's gender from the generated lists or its ending; null when either or unknown. */
export function nounGender(word: string): Gender | null {
  if (!genderable(word)) return null;
  if (!genders) {
    genders = new Map();
    for (const w of decodeFrontCoded(MASCULINE)) genders.set(w, "m");
    for (const w of decodeFrontCoded(FEMININE)) genders.set(w, "f");
  }
  return genders.get(word) ?? (isInflectedNoun(word) ? suffixGender(word) : null);
}

/** Masculine/feminine and singular/plural. */
export type Inflection = "ms" | "mp" | "fs" | "fp";

export interface AdjectiveReading {
  /** The masculine singular entry. */
  lemma: string;
  flag: string;
  slot: Inflection;
}

type AdjectiveRule = { add: string; slot: Inflection; strip: string; cond: RegExp };
let adjectiveRules: Map<string, AdjectiveRule[]> | null = null;
let adjectiveLemmas: Map<string, readonly string[]> | null = null;

function loadAdjectives() {
  if (adjectiveRules) return;
  adjectiveRules = new Map();
  let list: AdjectiveRule[] = [];
  for (const line of ADJECTIVE_RULES.split("\n")) {
    if (line.startsWith("@")) {
      list = [];
      adjectiveRules.set(line.slice(1), list);
      continue;
    }
    const [add, slot, strip, cond] = line.split(" ").map((part) => (part === "0" ? "" : part));
    list.push({ add, slot: slot as Inflection, strip, cond: new RegExp(`${cond}$`) });
  }
  adjectiveLemmas = new Map();
  for (const line of ADJECTIVE_LEMMAS.split("\n")) {
    const [flags, ending, ...rest] = line.split(" ");
    const list = flags.match(/../g) ?? [];
    for (const stem of decodeFrontCoded(rest.join(" "))) adjectiveLemmas.set(stem + ending, list);
  }
}

/** The gender and number readings of a lowercase adjective (or gendered noun) form. */
export function adjectiveReadings(word: string): AdjectiveReading[] {
  loadAdjectives();
  const out: AdjectiveReading[] = [];
  for (const [flag, rules] of adjectiveRules!) {
    for (const rule of rules) {
      if (!word.endsWith(rule.add)) continue;
      const lemma = word.slice(0, word.length - rule.add.length) + rule.strip;
      if (!rule.cond.test(lemma) || !adjectiveLemmas!.get(lemma)?.includes(flag)) continue;
      out.push({ lemma, flag, slot: rule.slot });
      // "frais", "gris": a masculine in s, x or z is its own plural.
      if (rule.slot === "ms" && /[sxz]$/.test(lemma)) out.push({ lemma, flag, slot: "mp" });
    }
  }
  return out;
}

/** A reading's forms for another gender and number. */
export function inflect(reading: AdjectiveReading, slot: Inflection): string[] {
  loadAdjectives();
  const forms = new Set<string>();
  for (const rule of adjectiveRules!.get(reading.flag) ?? []) {
    const ms = rule.slot === "ms" && slot === "mp" && /[sxz]$/.test(reading.lemma);
    if ((rule.slot !== slot && !ms) || !rule.cond.test(reading.lemma)) continue;
    if (!reading.lemma.endsWith(rule.strip)) continue;
    forms.add(reading.lemma.slice(0, reading.lemma.length - rule.strip.length) + rule.add);
  }
  return [...forms];
}
