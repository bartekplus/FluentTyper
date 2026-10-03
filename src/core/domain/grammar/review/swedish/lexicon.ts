import { graphWords } from "../wordGraph";
import { ADJECTIVES, COMMON, NEUTER } from "./lexicon.generated";

/**
 * Swedish noun genders and adjective -t forms, read from the bundled sv_SE
 * Hunspell dictionary by scripts/generate-swedish-lexicon.ts. A compound takes
 * the gender (or the -t form) of its last part, so the data keeps only the
 * words that rule does not already predict, as word graphs (../wordGraph.ts).
 */

/** The shortest prefix a compound needs, and the shortest last part read on its own. */
const MIN_PREFIX = 2;
const MIN_TAIL = 3;

/** The value of `word`, or of its longest known last part. */
export function predict<T>(table: ReadonlyMap<string, T>, word: string): T | undefined {
  const exact = table.get(word);
  if (exact !== undefined) return exact;
  for (let at = MIN_PREFIX; at <= word.length - MIN_TAIL; at++) {
    const tail = table.get(word.slice(at));
    if (tail !== undefined) return tail;
  }
  return undefined;
}

/**
 * How an adjective spells its neuter -t form, as [strip, add]: "mörk" + t,
 * "hård" d -> t, "röd" d -> tt, "ny" + tt, "öppen" n -> t, "bredd" dd -> tt;
 * "svart" stays as it is.
 */
export const T_FORMS: ReadonlyArray<readonly [string, string]> = [
  ["", "t"],
  ["d", "t"],
  ["d", "tt"],
  ["", "tt"],
  ["n", "t"],
  ["dd", "tt"],
  ["", ""],
];

let genders: Map<string, "en" | "ett"> | undefined;
let adjectives: Map<string, number> | undefined;

function load() {
  genders = new Map();
  for (const word of graphWords(NEUTER)) genders.set(word, "ett");
  for (const word of graphWords(COMMON)) genders.set(word, "en");
  adjectives = new Map();
  for (const entry of graphWords(ADJECTIVES)) {
    const [word, code] = entry.split("|");
    adjectives.set(word, Number(code));
  }
}

// Pronoun-like adjectives with their own neuter.
const IRREGULAR = new Map([
  ["liten", "litet"],
  ["annan", "annat"],
  ["sådan", "sådant"],
  ["egen", "eget"],
  ["gammal", "gammalt"],
]);
const IRREGULAR_BASE = new Map([...IRREGULAR].map(([base, neuter]) => [neuter, base]));

// Productive noun endings, for words neither the table nor their last part covers.
const NEUTER_ENDINGS = /(?:ande|ende|eri|ium|um|ment)$/;
const COMMON_ENDINGS = /(?:het|ning|tion|sion|itet|ism|dom|else|inna)$/;

/** A noun's gender from the table, its last part, or a productive ending. */
export function predictGender(
  table: ReadonlyMap<string, "en" | "ett">,
  word: string,
): "en" | "ett" | undefined {
  return (
    predict(table, word) ??
    (NEUTER_ENDINGS.test(word) ? "ett" : COMMON_ENDINGS.test(word) ? "en" : undefined)
  );
}

/** "en" or "ett" for a noun the dictionary (or its last part) knows, else undefined. */
export function nounGender(word: string): "en" | "ett" | undefined {
  if (!genders) load();
  return predictGender(genders!, word);
}

export type AdjectiveForm = { form: "common" | "neuter"; other: string } | { form: "both" };

/** The -t form `word` would take as the base of adjective class `code`. */
function forward(word: string, code: number): AdjectiveForm {
  const [strip, add] = T_FORMS[code];
  return add
    ? { form: "common", other: word.slice(0, word.length - strip.length) + add }
    : { form: "both" };
}

/** The base whose -t form `word` is, by `lookup`. */
function neuterOf(word: string, lookup: (base: string) => number | undefined) {
  for (const [code, [strip, add]] of T_FORMS.entries()) {
    if (!add || !word.endsWith(add)) continue;
    const base = word.slice(0, word.length - add.length) + strip;
    if (base.length > 1 && lookup(base) === code) return base;
  }
}

/** An adjective's gender form and its other form, or undefined for an unknown word. */
export function adjectiveForm(word: string): AdjectiveForm | undefined {
  if (!adjectives) load();
  const table = adjectives!;
  const irregular = IRREGULAR.get(word);
  if (irregular) return { form: "common", other: irregular };
  const irregularBase = IRREGULAR_BASE.get(word);
  if (irregularBase) return { form: "neuter", other: irregularBase };
  // Exact entries first: "målat" is "målad" in the neuter, not a compound of "lat".
  const exact = table.get(word);
  if (exact !== undefined) return forward(word, exact);
  const exactBase = neuterOf(word, (base) => table.get(base));
  if (exactBase) return { form: "neuter", other: exactBase };
  const predicted = predict(table, word);
  if (predicted !== undefined) return forward(word, predicted);
  const base = neuterOf(word, (candidate) => predict(table, candidate));
  return base ? { form: "neuter", other: base } : undefined;
}
