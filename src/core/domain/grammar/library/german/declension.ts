// The rule library (library.ts): German declension. The forms of the determiners by gender and
// case, and the adjective endings after them.
import { germanGender, type GermanGenderReading } from "../../review/german/germanLexicon";
import { likeTyped } from "../../review/german/shared";

export type GermanCaseGender = "m" | "f" | "n" | "pl";
export type GermanCase = "nom" | "acc" | "dat" | "gen";
type Kind = "d" | "dies" | "ein";

const CASE_ORDER: readonly GermanCase[] = ["nom", "acc", "dat", "gen"];
// Endings by gender and case, in CASE_ORDER: the definite article spelled out, dies- and ein-
// words as endings ("" for the bare "ein").
const FORMS: Readonly<Record<Kind, Readonly<Record<GermanCaseGender, readonly string[]>>>> = {
  d: {
    m: ["der", "den", "dem", "des"],
    f: ["die", "die", "der", "der"],
    n: ["das", "das", "dem", "des"],
    pl: ["die", "die", "den", "der"],
  },
  dies: {
    m: ["er", "en", "em", "es"],
    f: ["e", "e", "er", "er"],
    n: ["es", "es", "em", "es"],
    pl: ["e", "e", "en", "er"],
  },
  ein: {
    m: ["", "en", "em", "es"],
    f: ["e", "e", "er", "er"],
    n: ["", "", "em", "es"],
    pl: ["e", "e", "en", "er"],
  },
};
// The adjective ending after a definite or dies-word (weak), after an ein-word (mixed) and with
// no determiner (strong).
const ADJECTIVE_ENDINGS: Readonly<
  Record<"weak" | "mixed" | "strong", Readonly<Record<GermanCaseGender, readonly string[]>>>
> = {
  weak: {
    m: ["e", "en", "en", "en"],
    f: ["e", "e", "en", "en"],
    n: ["e", "e", "en", "en"],
    pl: ["en", "en", "en", "en"],
  },
  mixed: {
    m: ["er", "en", "en", "en"],
    f: ["e", "e", "en", "en"],
    n: ["es", "es", "en", "en"],
    pl: ["en", "en", "en", "en"],
  },
  strong: {
    m: ["er", "en", "em", "en"],
    f: ["e", "e", "er", "er"],
    n: ["es", "es", "em", "en"],
    pl: ["e", "e", "en", "er"],
  },
};
// Contractions of a preposition and "dem", "der" or "das": [preposition, article].
const CONTRACTIONS: Readonly<Record<string, [string, string]>> = {
  zum: ["zu", "dem"],
  zur: ["zu", "der"],
  im: ["in", "dem"],
  am: ["an", "dem"],
  vom: ["von", "dem"],
  beim: ["bei", "dem"],
  ins: ["in", "das"],
};
const EIN_STEMS = new Set("ein kein mein dein sein ihr unser euer eur".split(" "));
const DIES_STEMS = new Set("dies jed jen".split(" "));

/** A determiner: its kind (d-, dies- or ein-word), stem, ending and contracted preposition. */
export type GermanDeterminer = { kind: Kind; stem: string; ending: string; prep?: string };

/** A preposition contracted with its article ("zum", "ins"). */
export const germanContraction = (word: string) => Object.hasOwn(CONTRACTIONS, word);

/** The stem and ending of a determiner: "keinen" → ein-word "kein" + "en". */
export function germanDeterminer(typed: string): GermanDeterminer | null {
  const low = typed.toLowerCase();
  if (Object.hasOwn(CONTRACTIONS, low)) {
    const [prep, article] = CONTRACTIONS[low];
    return { kind: "d", stem: "d", ending: article, prep };
  }
  if (/^d(?:er|ie|as|em|en|es)$/.test(low)) return { kind: "d", stem: "d", ending: low };
  const m = /^(.*?)(e|en|em|er|es|)$/.exec(low)!;
  for (const [stem, ending] of [
    [m[1], m[2]],
    [low, ""],
  ]) {
    if (DIES_STEMS.has(stem) && ending) return { kind: "dies", stem, ending };
    if (EIN_STEMS.has(stem)) return { kind: "ein", stem, ending };
  }
  return null;
}

/** The determiner's spelling for a gender and case, in the typed word's casing. */
export function germanDeterminerFor(
  det: GermanDeterminer,
  gender: GermanCaseGender,
  c: GermanCase,
  typed: string,
): string | null {
  const form = FORMS[det.kind][gender][CASE_ORDER.indexOf(c)];
  // "ein" has no plural.
  if (det.kind === "ein" && det.stem === "ein" && gender === "pl") return null;
  let word: string;
  if (det.prep) {
    const contracted = Object.entries(CONTRACTIONS).find(
      ([, [prep, article]]) => prep === det.prep && article === form,
    );
    word = contracted ? contracted[0] : `${det.prep} ${form}`;
  } else if (det.kind === "d") word = form;
  else {
    // "euer" drops its e before an ending: "eure".
    const stem = det.stem === "euer" || det.stem === "eur" ? (form ? "eur" : "euer") : det.stem;
    word = stem + form;
  }
  return likeTyped(typed, word);
}

/** The gender and case readings a determiner spells. */
export function germanDeterminerReadings(
  det: GermanDeterminer,
): Array<[GermanCaseGender, GermanCase]> {
  const out: Array<[GermanCaseGender, GermanCase]> = [];
  for (const gender of ["m", "f", "n", "pl"] as GermanCaseGender[]) {
    if (det.kind === "ein" && det.stem === "ein" && gender === "pl") continue;
    CASE_ORDER.forEach((c, i) => {
      // "zur", "im": the preposition's dative; "ins": the accusative.
      if (det.prep && c !== (det.ending === "das" ? "acc" : "dat")) return;
      if (FORMS[det.kind][gender][i] === det.ending) out.push([gender, c]);
    });
  }
  return out;
}

/**
 * Whether the noun form can take a gender and case: a masculine or neuter genitive ends in
 * -s or -n ("des Autos", "des Menschen"), a dative plural in -n or -s ("den Kindern").
 */
export function germanCaseFits(
  noun: string,
  reading: GermanGenderReading,
  gender: GermanCaseGender,
  c: GermanCase,
): boolean {
  if (gender === "pl") {
    return reading.plural && (c !== "dat" || /[ns]$/.test(noun));
  }
  const genders = reading.gender === "x" ? ["m", "n"] : [reading.gender];
  if (!genders.includes(gender)) return false;
  return c !== "gen" || gender === "f" || /[sn]$/.test(noun);
}

/** The adjective ending of a declension ("weak", "mixed", "strong") for a gender and case. */
export const germanAdjectiveEnding = (
  declension: "weak" | "mixed" | "strong",
  gender: GermanCaseGender,
  c: GermanCase,
) => ADJECTIVE_ENDINGS[declension][gender][CASE_ORDER.indexOf(c)];

/** Whether a determiner can stand before a noun; null when either is unknown. */
export function germanDeterminerFits(typed: string, noun: string): boolean | null {
  const det = germanDeterminer(typed);
  const head = noun.split("-").at(-1)!;
  const reading = det && germanGender(head);
  if (!det || !reading) return null;
  return germanDeterminerReadings(det).some(([g, c]) => germanCaseFits(head, reading, g, c));
}
