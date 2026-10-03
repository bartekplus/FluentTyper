import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  type Gender,
  isInflectedNoun,
  isNounLemma,
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
    if (third && isNounLemma(third.w)) return null;
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
  // "une toute autre affaire": the adverb before "autre" after an article; "tout autre personne"
  // with no article: "any other", agreeing with the noun.
  if (w === "autre" && !plural) {
    if (before[0] && ["un", "une"].includes(before[0].w))
      return lower === "tout" ? null : fix(["tout"]);
    if (before[0] && before[0].w in SINGULAR_DETERMINERS) return null;
    const gender = after[1] ? (after[1].w === "personne" ? "f" : nounGender(after[1].w)) : null;
    if (!gender || adjectiveReadings(after[1].w).length) return null;
    const right = gender === "m" ? "tout" : "toute";
    return lower === right ? null : fix([right]);
  }
  // "elle est tout belle", "une veste tout neuve": the adverb takes the gender and number of a
  // feminine adjective starting with a consonant; before a vowel it stays "tout" ("toute
  // étonnée" -> "tout étonnée"). "tous" may be the pronoun ("ils sont tous contents"): left alone.
  if (lower !== "tous" && adverbialTout(before)) {
    const slots = new Set(adjectiveReadings(w).map((r) => r.slot));
    // "étonnée", "émues": a feminine participle.
    const participle = /é(?:e|es)$/.test(w) && verbReadings(w).every((r) => r.slot === "Q");
    if (!slots.size && participle && verbReadings(w).length)
      slots.add(w.endsWith("s") ? "fp" : "fs");
    const feminine = slots.size > 0 && [...slots].every((slot) => slot[0] === "f");
    if (
      feminine &&
      !isInflectedNoun(w) &&
      !verbReadings(w).some((r) => typeof r.slot === "number")
    ) {
      const vowel = /^[aeiouyâàéèêëîïôûœ]/.test(w);
      if (vowel && lower === "toute" && !slots.has("fp")) return fix(["tout"]);
      if (!vowel && !/^h/.test(w)) {
        const right =
          slots.has("fp") && !slots.has("fs")
            ? "toutes"
            : slots.has("fs") && !slots.has("fp")
              ? "toute"
              : null;
        if (right && lower !== right) return fix([right]);
      }
      return null;
    }
  }
  const finiteNext = verbReadings(w).some((r) => typeof r.slot === "number");
  // "Toute est prêt", "Toute arrive à point": the pronoun subject of a verb is "tout".
  // A capital "Toute" inside a sentence opens a title ("son livre, Toute la nuit").
  const sentenceStart = /(?:^|[.!?…]\s*)$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index));
  if (
    lower === "toute" &&
    !before[0] &&
    (sentenceStart || typed === lower) &&
    finiteNext &&
    (!isInflectedNoun(w) || verbReadings(w).some((r) => r.lemma === "être" || r.lemma === "avoir"))
  ) {
    // "toute sont en Australie": a plural verb takes the pronoun "toutes".
    const plural = verbReadings(w).every((r) => r.slot === 32);
    return fix([plural ? "toutes" : "tout"]);
  }
  // "il a toute oublié": the object pronoun between avoir and its participle is "tout" (after
  // être "tout" may be the adverb: left alone).
  if (
    lower === "toute" &&
    verbReadings(before[0]?.w ?? "").some(
      (r) => typeof r.slot === "number" && r.lemma === "avoir",
    ) &&
    verbReadings(w).length > 0 &&
    verbReadings(w).every((r) => r.slot === "Q")
  )
    // "elle nous a toute sauvées": a plural participle shows the pronoun "toutes".
    return fix([w.endsWith("es") ? "toutes" : w.endsWith("s") ? "tous" : "tout"]);
  // "tout personne" -> "toute personne", "toute sujet" -> "tout sujet".
  if (plural || TOUT_IDIOMS.has(w) || /^\p{Lu}/u.test(ctx.text.slice(next.start, next.end)))
    return null;
  // "il inspecte tout trace": after a verb or a preposition a noun that is also a verb form
  // ("trace") is the noun; at a clause start it may be the verb ("tout porte à croire").
  // After a verb, only when a "de" complement or nothing follows ("il sait tout montre qu'il..."
  // makes "tout" the subject).
  const nounSlot =
    !!before[0] &&
    (PREPOSITIONS.has(before[0].w) ||
      (verbReadings(before[0].w).some((r) => typeof r.slot === "number") &&
        (!after[1] || ["de", "d'", "du", "des"].includes(after[1].w))));
  if (adjectiveReadings(w).length) return null;
  if (isFiniteOrParticiple(w) && !(nounSlot && isInflectedNoun(w) && finiteNext)) return null;
  const gender = w === "personne" ? "f" : nounGender(w);
  if (!gender) return null;
  // "Elle est tout sourire": an adverb after être.
  if (before[0] && verbReadings(before[0].w).some((r) => r.lemma === "être")) return null;
  const right = gender === "m" ? "tout" : "toute";
  return lower === right ? null : fix([right]);
}

// Linking verbs after which "tout" before an adjective is the adverb: "elle est tout émue".
const LINKING = new Set(["être", "sembler", "paraître", "devenir", "rester", "demeurer"]);

/** Whether "tout" before an adjective is the adverb: after a linking verb or a noun. */
function adverbialTout(before: Token[]): boolean {
  const previous = before[0];
  if (!previous) return false;
  if (verbReadings(previous.w).some((r) => typeof r.slot === "number" && LINKING.has(r.lemma)))
    return true;
  // "une veste tout neuve": right after a noun its determiner opened.
  const det = before[1]?.w ?? "";
  return (
    (det in SINGULAR_DETERMINERS || PLURAL_DETERMINERS.has(det) || ["une", "des"].includes(det)) &&
    Boolean(nounGender(previous.w) || nounGender(previous.w.replace(/s$/, "")))
  );
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
