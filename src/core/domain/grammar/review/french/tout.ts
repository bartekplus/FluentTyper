import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  type Gender,
  isInflectedNoun,
  nounGender,
  verbReadings,
} from "./frenchLexicon";
import {
  CLITICS,
  ownedFrenchWords,
  SUBJECT_PRONOUNS,
  tokensAfter,
  tokensBefore,
  wordFinding,
  type Token,
} from "./frenchTokens";

// "tout" agrees with the noun phrase it opens: "tout le monde", "toute la journée", "tous les
// jours", "toutes ces idées", "tous ceux", "tout cela". The determiner gives the number and,
// when it can, the gender; otherwise the noun's gender list decides.

const RULE = "frenchTout";
const MESSAGE = "review_msg_fr_tout";

const FORMS: Record<string, string> = { ms: "tout", fs: "toute", mp: "tous", fp: "toutes" };
const SINGULAR_DETERMINERS: Record<string, Gender | null> = {
  le: "m",
  ce: "m",
  cet: "m",
  la: "f",
  cette: "f",
  ma: "f",
  ta: "f",
  sa: "f",
  mon: null,
  ton: null,
  son: null,
  notre: null,
  votre: null,
  "l'": null,
};
const PLURAL_DETERMINERS = new Set("les ces mes tes ses nos vos leurs".split(" "));
const NUMERALS = new Set("deux trois quatre cinq six sept huit neuf dix".split(" "));
// Words between a plural determiner and its noun that say nothing of its gender.
const PRE_NOUN = new Set("autres premiers premières derniers dernières mêmes".split(" "));
const PREPOSITIONS = new Set(
  "à de d' pour par dans sur sous avec sans chez vers entre après avant contre pendant malgré selon et ou mais".split(
    " ",
  ),
);
// Idioms whose "tout" is right as written before a feminine noun.
const TOUT_IDIOMS = new Set(["ouïe", "flamme", "chose", "pile", "laine", "soie", "honte"]);

const isFiniteOrParticiple = (word: string) =>
  verbReadings(word).some((r) => typeof r.slot === "number" || r.slot === "Q" || r.slot === "I");
/** A verb form that is not also a noun: "savent", "voir". */
const verbOnly = (word: string) => !isInflectedNoun(word) && isFiniteOrParticiple(word);

function singularGender(word: string): Gender | null {
  if (word === "personne" || word === "personnes") return "f";
  const direct = nounGender(word);
  if (direct) return direct;
  const singular = word.endsWith("aux") ? `${word.slice(0, -3)}al` : word.replace(/[sx]$/, "");
  return singular !== word ? nounGender(singular) : null;
}

/** The gender of the noun a determiner opens, skipping numerals and "autres". */
function headGender(after: Token[], from: number): Gender | null | "verb" {
  let numeral = false;
  for (let i = from; i < Math.min(after.length, from + 3); i++) {
    const w = after[i].w;
    if (i === from && verbOnly(w)) return "verb";
    if (NUMERALS.has(w) || PRE_NOUN.has(w)) {
      numeral ||= NUMERALS.has(w);
      continue;
    }
    // "tous les deux partie de": after a numeral only a plural noun belongs to the determiner.
    if (numeral && !/[sx]$/.test(w)) return null;
    return singularGender(w);
  }
  return null;
}

/**
 * "Ils prennent tous le bus", "Elles ont toutes la grippe": a plural "tous" after its verb is a
 * pronoun, and the determiner after it opens the object.
 */
function floating(before: Token[], text: string, index: number): boolean {
  const previous = before[0];
  if (!previous) return /,[\s  ]*$/u.test(text.slice(Math.max(0, index - 4), index));
  if (PREPOSITIONS.has(previous.w)) return false;
  return (
    SUBJECT_PRONOUNS.has(previous.w) || CLITICS.has(previous.w) || isFiniteOrParticiple(previous.w)
  );
}

function tout(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const lower = typed.toLowerCase();
  const plural = lower.endsWith("s");
  const after = tokensAfter(ctx.text, m.index + typed.length, 5);
  const next = after[0];
  if (!next || next.start > m.index + typed.length + 3) return null;
  if (ctx.text[m.index + typed.length] === "-") return null;
  const before = tokensBefore(ctx.text, m.index, 2);
  // "le tout", "un tout": the noun.
  if (before[0] && ["le", "un", "du", "au"].includes(before[0].w)) return null;
  const fix = (alternatives: string[]) =>
    wordFinding(ctx, m.index, typed, alternatives, RULE, MESSAGE, {
      start: m.index,
      end: after[Math.min(after.length - 1, 1)].end,
    });
  const w = next.w;

  // "tous ça" -> "tout ça".
  if (w === "ça" || w === "cela" || w === "ceci") {
    if (lower === "tout" || floating(before, ctx.text, m.index)) return null;
    return fix(["tout"]);
  }
  // "tout ceux" -> "tous ceux", "toutes ceux" -> "tous ceux".
  if (w === "ceux" || w === "celles") {
    // "avant tout ceux-là", "après tout".
    if (before[0] && ["avant", "après", "malgré"].includes(before[0].w)) return null;
    const right = w === "ceux" ? "tous" : "toutes";
    return lower === right ? null : fix([right]);
  }
  if (w in SINGULAR_DETERMINERS) {
    let gender = SINGULAR_DETERMINERS[w];
    const head = headGender(after, 1);
    // "tout le ranger": the pronoun before its verb.
    if (head === "verb") return null;
    // "Tout l'alarme": an object pronoun before a verb that is also a noun.
    if (w === "l'" && after[1] && verbReadings(after[1].w).some((r) => typeof r.slot === "number"))
      return null;
    if (gender === null) {
      // "toute mon enfance": a possessive keeps "mon" before a feminine vowel noun.
      gender = head;
      if (!gender) return null;
    }
    if (plural) {
      // "tous le monde", "tous le temps" ("ils ont tous le temps" is fine); before other nouns
      // only after a preposition or at a clause start, where "tous" cannot be the subject.
      const noun = after[1]?.w;
      const idiom = noun === "monde" || noun === "temps";
      // "à tous la vérité": "à tous" (to everyone) is a pronoun too.
      if (idiom ? auxiliaryBefore(before) : before[0] || floating(before, ctx.text, m.index))
        return null;
    }
    const right = gender === "m" ? "tout" : "toute";
    return lower === right ? null : fix([right]);
  }
  if (PLURAL_DETERMINERS.has(w)) {
    const head = headGender(after, 1);
    if (head === "verb") {
      // "tous les voir": a pronoun object; only the singular is wrong.
      return plural ? null : fix(["tous", "toutes"]);
    }
    if (!head) return plural ? null : fix(["tous", "toutes"]);
    // "Nous avons tous nos secrets": a "tous" after its verb belongs to the subject.
    if (plural && floating(before, ctx.text, m.index)) return null;
    const right = head === "m" ? "tous" : "toutes";
    return lower === right ? null : fix([right]);
  }
  // "Ils sont tout deux" -> "tous deux".
  if ((w === "deux" || w === "trois") && !plural) {
    const previous = before[0];
    const third = after[1];
    if (third && isInflectedNoun(third.w)) return null;
    if (
      !previous ||
      !(
        SUBJECT_PRONOUNS.has(previous.w) ||
        ["à", "pour", "entre"].includes(previous.w) ||
        isFiniteOrParticiple(previous.w)
      )
    )
      return null;
    return fix(lower === "toute" ? ["toutes"] : ["tous", "toutes"]);
  }
  // "tout personne" -> "toute personne", "toute sujet" -> "tout sujet".
  if (plural || TOUT_IDIOMS.has(w) || /^\p{Lu}/u.test(ctx.text.slice(next.start, next.end)))
    return null;
  if (adjectiveReadings(w).length || isFiniteOrParticiple(w)) return null;
  const gender = w === "personne" ? "f" : nounGender(w);
  if (!gender) return null;
  // "Elle est tout sourire": an adverb after être.
  if (before[0] && verbReadings(before[0].w).some((r) => r.lemma === "être")) return null;
  const right = gender === "m" ? "tout" : "toute";
  return lower === right ? null : fix([right]);
}

function auxiliaryBefore(before: Token[]): boolean {
  return verbReadings(before[0]?.w ?? "").some(
    (r) => typeof r.slot === "number" && (r.lemma === "avoir" || r.lemma === "être"),
  );
}

// FORMS lists the four forms; the pattern is built from them.
const TOUT = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?:${Object.values(FORMS).join("|")})(?![\\p{L}\\p{M}\\p{N}_'’])`,
  "giu",
);

function touts(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, TOUT)) {
    const finding = tout(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: touts }];
