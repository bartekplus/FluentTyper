import { memoize } from "../../implementations/helpers/GenericRuleShared";
import { graphWords } from "../wordGraph";
import {
  ADJECTIVES,
  AMBIGUOUS_ADJECTIVES,
  CLASSES,
  EXCEPTIONS,
  STEMS,
  TAGS,
} from "./lexicon.generated";
import {
  AMBIGUOUS_VERBS,
  IMPERATIVES,
  PERFECTIVES,
  PLACES,
  VERB_CLASSES,
  VERB_STEMS,
} from "./words.generated";

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
  /** Class -> its endings with their tags. */
  paradigms: Array<Array<[string, number]>>;
  longest: number;
  exceptions: Map<string, number>;
}
let lexicon: Lexicon | undefined;
/** The checks ask about the same words many times in a chunk: keep this many answers. */
const ANSWERS = 4096;

/** A word graph of "class|ending" entries as each class's endings, in order. */
function byClass(encoded: string): string[][] {
  const out: string[][] = [];
  for (const entry of graphWords(encoded)) {
    const bar = entry.indexOf("|");
    (out[Number(entry.slice(0, bar))] ??= []).push(entry.slice(bar + 1));
  }
  return out;
}

/** A word graph of "stem|class" entries as each class's stems. */
function stemsByClass(encoded: string): Array<Set<string>> {
  const out: Array<Set<string>> = [];
  for (const entry of graphWords(encoded)) {
    const bar = entry.lastIndexOf("|");
    (out[Number(entry.slice(bar + 1))] ??= new Set()).add(entry.slice(0, bar));
  }
  return out;
}

function load(): Lexicon {
  const endings = new Map<string, Array<[number, number]>>();
  const tags = TAGS.split(" ").map((mask) => parseInt(mask, 36));
  let longest = 0;
  const paradigms: Array<Array<[string, number]>> = [];
  byClass(CLASSES).forEach((pairs, id) => {
    paradigms[id] = [];
    for (const pair of pairs) {
      const [ending, mask] = pair.split(":");
      longest = Math.max(longest, ending.length);
      const list = endings.get(ending) ?? [];
      list.push([id, tags[parseInt(mask, 36)]]);
      endings.set(ending, list);
      paradigms[id].push([ending, tags[parseInt(mask, 36)]]);
    }
  });
  const exceptions = new Map<string, number>();
  for (const entry of graphWords(EXCEPTIONS)) {
    const [form, mask] = entry.split("|");
    exceptions.set(form, parseInt(mask, 36));
  }
  return { endings, stems: stemsByClass(STEMS), paradigms, longest, exceptions };
}

/** The tags of a lowercase word, or 0 when it is not a form of a listed noun. */
function readNounTags(word: string): number {
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
export const nounTags = memoize(readNounTags, ANSWERS);

/**
 * The forms of the noun(s) `word` belongs to that carry one of the `wanted` tags, in the
 * paradigm's own number when `wanted` names cases of both ("sklepie", Is -> "sklepem"); only
 * paradigms where `word` itself carries one of the `reading` tags ("ludzie" as Np, not "lud").
 */
export function inflect(word: string, wanted: number, reading = ALL_CASES): string[] {
  lexicon ??= load();
  const forms = new Set<string>();
  for (let cut = Math.max(0, word.length - lexicon.longest); cut <= word.length; cut++) {
    const classes = lexicon.endings.get(word.slice(cut));
    if (!classes) continue;
    const stem = word.slice(0, cut);
    for (const [id, own] of classes) {
      if (!lexicon.stems[id].has(stem) || !(own & reading)) continue;
      for (const [ending, mask] of lexicon.paradigms[id])
        if (mask & wanted && stem + ending !== word) forms.add(stem + ending);
    }
  }
  return [...forms];
}

/** A form only ever read as a noun (or, `verbs`, as a noun or a finite verb). */
export function onlyNoun(tags: number, verbs = false): boolean {
  return (tags & ALL_CASES) !== 0 && (tags & (ADJECTIVE | NOT_NOUN | (verbs ? 0 : VERB))) === 0;
}

/* -------------------------------------------------------------------- verbs */

interface Verbs {
  endings: Map<string, number[]>;
  stems: Array<Set<string>>;
  longest: number;
  ambiguous: Set<string>;
}
let verbs: Verbs | undefined;

function loadVerbs(): Verbs {
  const endings = new Map<string, number[]>();
  let longest = 0;
  byClass(VERB_CLASSES).forEach((classEndings, id) => {
    for (const ending of classEndings) {
      longest = Math.max(longest, ending.length);
      endings.set(ending, [...(endings.get(ending) ?? []), id]);
    }
  });
  const stems = stemsByClass(VERB_STEMS);
  return { endings, stems, longest, ambiguous: new Set(graphWords(AMBIGUOUS_VERBS)) };
}

/** "być", "mieć", "iść" and their compounds, which the dictionary lists without flags. */
const IRREGULAR =
  /^(?:jest|są|jestem|jesteś|jesteśmy|jesteście|wie|wiesz|wiemy|wiecie|wiedzą|będ(?:ę|ziesz|zie|ziemy|ziecie|ą)|ma|masz|macie|mają|id(?:ę|ziesz|zie|ziemy|ziecie|ą)|(?:po|przy|wy|w|we|od|ode|do|z|ze|nad|pod|prze|ob|roz|za)?sz(?:edł|ła|ło|li|ły)(?:em|am|eś|aś|śmy|ście)?|powin(?:ien(?:em|eś)?|n(?:a|am|aś|o|i|iśmy|iście|y|yśmy|yście)))$/u;

/** A lowercase word that is only ever a finite verb form ("kupiłem", "przegrywały", "jest"). */
function readFiniteVerb(word: string): boolean {
  if (IRREGULAR.test(word)) return true;
  verbs ??= loadVerbs();
  if (verbs.ambiguous.has(word) || nounTags(word) || adjectiveOf(word)) return false;
  return listedVerb(word);
}
export const finiteVerb = memoize(readFiniteVerb, ANSWERS);

/** The verb tables list the form, whatever else it may be ("trwały", "woli"). */
function readListedVerb(word: string): boolean {
  if (IRREGULAR.test(word)) return true;
  verbs ??= loadVerbs();
  for (let cut = Math.max(0, word.length - verbs.longest); cut <= word.length; cut++) {
    const classes = verbs.endings.get(word.slice(cut));
    if (classes?.some((id) => verbs!.stems[id].has(word.slice(0, cut)))) return true;
  }
  return false;
}
export const listedVerb = memoize(readListedVerb, ANSWERS);

/** A finite verb form that is also another word ("miał" coal dust, "należy"); context decides. */
function readAmbiguousVerb(word: string): boolean {
  verbs ??= loadVerbs();
  return verbs.ambiguous.has(word) || (nounTags(word) & VERB) !== 0;
}
export const ambiguousVerb = memoize(readAmbiguousVerb, ANSWERS);

/**
 * The impersonal past in -no/-to ("szorowano", "zrobiono", "wypito", "zaczęto"): its past
 * form ("szorował", "zrobił") is a verb and the word itself is no noun ("siano", "wino").
 */
function readImpersonalVerb(word: string): boolean {
  if (word.length < 5 || nounTags(word) || adjectiveOf(word)) return false;
  const base = word.slice(0, -3);
  const pasts = /ano$|[iyu]to$/u.test(word)
    ? [`${word.slice(0, -2)}ł`]
    : word.endsWith("ono")
      ? [`${base}ył`, `${base}ił`, `${base}ł`]
      : word.endsWith("ęto")
        ? [`${base}ął`]
        : [];
  return pasts.some((past) => past.length > 3 && finiteVerb(past));
}
export const impersonalVerb = memoize(readImpersonalVerb, ANSWERS);

/**
 * A past form by its shape when the lexicon does not list the verb ("ubawił", "rzekł",
 * "zaczęła"): endings no common noun or adjective has. "-ał" stays out ("kanał", "upał").
 */
function readPastByShape(word: string): boolean {
  if (word.length < 5 || nounTags(word) || adjectiveOf(word)) return false;
  if (!/(?:[iy]ł|ął|ęł|[kg]ł)(?:a|o|em|eś|am|aś)?$|(?:[iy]l|ęl)i$|(?:[iy]ł|ęł)y$/u.test(word))
    return false;
  // "mili", "zgnili": a virile adjective ("miły").
  return !(word.endsWith("li") && hasAdjective(`${word.slice(0, -2)}ły`));
}
export const pastByShape = memoize(readPastByShape, ANSWERS);

let imperatives: Set<string> | undefined;

/** An imperative of a common verb that is no other word ("przeczytaj", "zróbcie", "idźmy"). */
export function imperativeVerb(word: string): boolean {
  imperatives ??= new Set(graphWords(IMPERATIVES));
  const stem = word.replace(/(?:cie|my)$/u, "");
  return imperatives.has(word) || (stem !== word && imperatives.has(stem));
}

let perfectives: Set<string> | undefined;

/**
 * A perfective infinitive ("zrobić") or past form ("zrobił", "zamknęła") of a common verb with
 * an imperfective base ("robić"); unlisted verbs are not known either way.
 */
export function perfectiveVerb(word: string): boolean {
  perfectives ??= new Set(graphWords(PERFECTIVES));
  if (perfectives.has(word)) return true;
  const stem = /^(.{3,}?)(?:ł|ła|ło|li|ły)$/u.exec(word)?.[1];
  return !!stem && perfectives.has(`${stem.replace(/ę$/u, "ą")}ć`);
}

let places: Set<string> | undefined;

/** A lowercased case form of a common place name that is no other word ("gdańsku"). */
export function placeForm(word: string): boolean {
  places ??= new Set(graphWords(PLACES));
  return places.has(word);
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
  ambiguous ??= new Set(graphWords(AMBIGUOUS_ADJECTIVES));
  return ambiguous.has(word);
}

/** An adjective form's masculine form and hard ending ("ego", "ą"…), or null. */
function readAdjectiveOf(word: string): { lemma: string; ending: string } | null {
  adjectives ??= new Set(graphWords(ADJECTIVES));
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
export const adjectiveOf = memoize(readAdjectiveOf, ANSWERS);

/** The lexicon lists `lemma` (a masculine form) as an adjective. */
export function hasAdjective(lemma: string): boolean {
  adjectives ??= new Set(graphWords(ADJECTIVES));
  return adjectives.has(lemma);
}

/** The form of adjective `lemma` with hard ending `ending`. */
export function adjectiveForm(lemma: string, ending: string): string {
  return adjectiveForms(lemma)[HARD.indexOf(ending)];
}

/**
 * A masculine form's ending and its men's plural ending ("dobry" -> "dobrzy", "wysoki" ->
 * "wysocy", "zmęczony" -> "zmęczeni"), longest first.
 */
const VIRILE_ENDINGS: Array<[string, string]> = [
  ["wesoły", "weseli"],
  ["zielony", "zieloni"],
  ["czerwony", "czerwoni"],
  ["słony", "słoni"],
  ["ony", "eni"],
  ["sny", ""],
  ["eży", "eży"],
  ["sły", "śli"],
  ["zły", "źli"],
  ["sty", "ści"],
  ["chy", "si"],
  ["szy", "si"],
  ["ży", "zi"],
  ["sy", "si"],
  ["ki", "cy"],
  ["gi", "dzy"],
  ["ty", "ci"],
  ["dy", "dzi"],
  ["ry", "rzy"],
  ["ny", "ni"],
  ["ły", "li"],
  ["wy", "wi"],
  ["by", "bi"],
  ["py", "pi"],
  ["my", "mi"],
  ["cy", "cy"],
];

/** An adjective's men's plural ("zmęczeni"), or "" where the ending does not say. */
export function virileAdjective(lemma: string): string {
  const rule = VIRILE_ENDINGS.find(([ending]) => lemma.endsWith(ending));
  if (rule) return rule[1] && lemma.slice(0, -rule[0].length) + rule[1];
  // Soft stems keep "-i" ("tani", "ostatni").
  return /[^kg]i$/u.test(lemma) ? lemma : "";
}

/** The masculine form of a listed adjective whose men's plural `word` is ("dobrzy" -> "dobry"). */
export function virileLemma(word: string): string | null {
  for (const [ending, virile] of VIRILE_ENDINGS) {
    if (!word.endsWith(virile)) continue;
    const lemma = word.slice(0, -virile.length) + ending;
    if (hasAdjective(lemma) && virileAdjective(lemma) === word) return lemma;
  }
  return null;
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

/**
 * The hard endings that agree with a noun of these tags. A masculine accusative plural that is
 * also the genitive ("malarzy", "aktorów") is a man's, so it takes "-ych", not "-e".
 */
export function agreeingEndings(tags: number): string[] {
  if (tags & MASCULINE && tags & cases("Gp")) tags &= ~cases("Ap");
  return HARD.filter((ending) => adjectiveAgrees(ending, tags));
}
