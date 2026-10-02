import { decodeWords } from "../swedish/lexicon";
import {
  ADJECTIVES,
  AMBIGUOUS_ADJECTIVES,
  CLASSES,
  EXCEPTIONS,
  STEMS,
  TAGS,
} from "./lexicon.generated";

/*
 * The paradigms of common Polish nouns with the cases each form can carry, derived from the
 * bundled Hunspell dictionary (scripts/generate-polish-lexicon.ts). A form's tags are the union
 * over every dictionary entry that spells it, so a word that is also an adjective or a verb
 * says so.
 */

/** Case letters; bit i is the singular, bit i + 7 the plural. */
export const CASES = "NGDAILV";
export const ALL_CASES = (1 << 14) - 1;
export const SINGULAR = (1 << 7) - 1;
export const PLURAL = SINGULAR << 7;
export const MASCULINE = 1 << 14;
export const FEMININE = 1 << 15;
export const NEUTER = 1 << 16;
/** Masculine personal ("studenci", "koledzy"). */
export const VIRILE = 1 << 17;
/** Also an adjective or participle form. */
export const ADJECTIVE = 1 << 18;
/** Also an adverb, particle or other uninflected word. */
export const NOT_NOUN = 1 << 19;
/** Also a finite verb form. */
export const VERB = 1 << 20;

/** The mask of case tags: `cases("Gs Ap")`. */
export function cases(spec: string): number {
  return spec
    .split(" ")
    .reduce((mask, tag) => mask | (1 << (CASES.indexOf(tag[0]) + (tag[1] === "p" ? 7 : 0))), 0);
}

interface Lexicon {
  /** Ending -> the classes that have it, with its tags there. */
  endings: Map<string, Array<[number, number]>>;
  /** Class -> its stems. */
  stems: Array<Set<string>>;
  longest: number;
  exceptions: Map<string, number>;
}
let lexicon: Lexicon | undefined;

function load(): Lexicon {
  const endings = new Map<string, Array<[number, number]>>();
  const tags = TAGS.split(" ").map((mask) => parseInt(mask, 36));
  let longest = 0;
  CLASSES.split("\n").forEach((line, id) => {
    for (const pair of line.split(" ")) {
      const [ending, mask] = pair.split(":");
      longest = Math.max(longest, ending.length);
      const list = endings.get(ending) ?? [];
      list.push([id, tags[parseInt(mask, 36)]]);
      endings.set(ending, list);
    }
  });
  const stems = STEMS.split("\n").map((line) => new Set(decodeWords(line)));
  const exceptions = new Map<string, number>();
  for (const [mask, packed] of Object.entries(EXCEPTIONS))
    for (const form of decodeWords(packed)) exceptions.set(form, parseInt(mask, 36));
  return { endings, stems, longest, exceptions };
}

/** The tags of a lowercase word, or 0 when it is not a form of a listed noun. */
export function nounTags(word: string): number {
  lexicon ??= load();
  let tags = 0;
  for (let cut = Math.max(0, word.length - lexicon.longest); cut <= word.length; cut++) {
    const classes = lexicon.endings.get(word.slice(cut));
    if (!classes) continue;
    const stem = word.slice(0, cut);
    for (const [id, mask] of classes) if (lexicon.stems[id].has(stem)) tags |= mask;
  }
  if (!tags) return 0;
  return tags | (lexicon.exceptions.get(word) ?? 0) | (adjectiveOf(word) ? ADJECTIVE : 0);
}

/** A form only ever read as a noun (or, `verbs`, as a noun or a finite verb). */
export function onlyNoun(tags: number, verbs = false): boolean {
  return (tags & ALL_CASES) !== 0 && (tags & (ADJECTIVE | NOT_NOUN | (verbs ? 0 : VERB))) === 0;
}

/* --------------------------------------------------------------- adjectives */

/** Hard-stem endings ("dobry"), and the -i spellings after k/g ("polski") and soft stems ("tani"). */
const HARD = ["y", "a", "e", "ego", "ej", "emu", "ą", "ym", "ych", "ymi"];
const AFTER_KG = ["i", "a", "ie", "iego", "iej", "iemu", "ą", "im", "ich", "imi"];
const SOFT = ["", "a", "e", "ego", "ej", "emu", "ą", "m", "ch", "mi"];

/** The singular and non-virile plural forms of an adjective's masculine form. */
export function adjectiveForms(lemma: string): string[] {
  if (/[kg]i$/.test(lemma)) return AFTER_KG.map((ending) => lemma.slice(0, -1) + ending);
  if (lemma.endsWith("i")) return SOFT.map((ending) => lemma + ending);
  return HARD.map((ending) => lemma.slice(0, -1) + ending);
}

const M = MASCULINE;
const F = FEMININE;
const N = NEUTER;
const ANY = M | F | N;
/** What each hard ending agrees with: [genders, cases] pairs. */
const READINGS: Record<string, Array<[number, number]>> = {
  y: [[M, cases("Ns As Vs")]],
  a: [[F, cases("Ns Vs")]],
  e: [
    [N, cases("Ns As Vs")],
    [ANY, cases("Np Ap Vp")],
  ],
  ego: [
    [M, cases("Gs As")],
    [N, cases("Gs")],
  ],
  ej: [[F, cases("Gs Ds Ls")]],
  emu: [[M | N, cases("Ds")]],
  ą: [[F, cases("As Is")]],
  ym: [
    [M | N, cases("Is Ls")],
    [ANY, cases("Dp")],
  ],
  ych: [[ANY, cases("Gp Lp Ap")]],
  ymi: [[ANY, cases("Ip")]],
};

let adjectives: Set<string> | undefined;
let ambiguous: Set<string> | undefined;

/** The form is also a noun, a verb or another word. */
export function ambiguousAdjective(word: string): boolean {
  ambiguous ??= new Set(decodeWords(AMBIGUOUS_ADJECTIVES));
  return ambiguous.has(word);
}

/** An adjective form's masculine form and hard ending ("ego", "ą"…), or null. */
export function adjectiveOf(word: string): { lemma: string; ending: string } | null {
  adjectives ??= new Set(decodeWords(ADJECTIVES));
  for (const [endings, lemmaOf] of [
    [HARD, (base: string) => `${base}y`],
    [AFTER_KG, (base: string) => (/[kg]$/.test(base) ? `${base}i` : "")],
    [SOFT, (base: string) => (base.endsWith("i") ? base : "")],
  ] as const) {
    for (let i = endings.length - 1; i >= 0; i--) {
      const ending = endings[i];
      if (!word.endsWith(ending)) continue;
      const lemma = lemmaOf(word.slice(0, word.length - ending.length));
      if (lemma && adjectives.has(lemma)) return { lemma, ending: HARD[i] };
    }
  }
  return null;
}

/** The form of adjective `lemma` with hard ending `ending`. */
export function adjectiveForm(lemma: string, ending: string): string {
  return adjectiveForms(lemma)[HARD.indexOf(ending)];
}

/** The adjective ending agrees with a noun of these tags (some shared case in its gender). */
export function adjectiveAgrees(ending: string, tags: number): boolean {
  const genders = tags & ANY || ANY;
  return READINGS[ending].some(
    ([gender, wanted]) => (gender & genders) !== 0 && (wanted & tags) !== 0,
  );
}

/** Every case an adjective ending can stand in, whatever the gender. */
export function readingCases(ending: string): number {
  return READINGS[ending].reduce((mask, [, wanted]) => mask | wanted, 0);
}

/** The hard endings that agree with a noun of these tags. */
export function agreeingEndings(tags: number): string[] {
  return HARD.filter((ending) => adjectiveAgrees(ending, tags));
}
