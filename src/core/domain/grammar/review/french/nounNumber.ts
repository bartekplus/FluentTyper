import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  isInflectedNoun,
  isNounLemma,
  isVerbHomograph,
  nounGender,
  verbReadings,
} from "./frenchLexicon";
import { sontForSon } from "./homophones";
import { ownedFrenchWords, PREPOSITIONS, SUBJECT_PRONOUNS, tokensBefore } from "./frenchTokens";
import { finding } from "../finding";
import { carryCase } from "../../implementations/helpers/GenericRuleShared";
import { isLang } from "../phraseTemplates";

// A determiner and the noun or adjective right after it share their number: "mes livres",
// "la route". Which words are nouns comes from the dictionary (a Bloom filter of its inflected
// entries); gender would need a source the dictionary does not have.

const RULE = "frenchNounNumber";
const MESSAGE = "review_msg_fr_noun_number";

const PLURAL = new Set(
  // Numbers also name things ("le numéro deux allemand", "tous les trois été"): left out.
  "les des mes tes ses nos vos leurs ces aux plusieurs quelques".split(" "),
);
const SINGULAR = new Set(
  "le la un une mon ma ton ta son sa ce cet cette au du chaque notre votre".split(" "),
);
/** Determiners that are also object pronouns before a verb ("je les aime", "tu la portes"). */
const CLITIC = new Set(["le", "la", "les"]);
// Words after a plural determiner that are no singular nouns: adverbs ("les trop nombreux"),
// "quelque" (about), numbers ("les quatre").
const NOT_NOUNS = new Set(
  (
    "tout peu trop bien mal fort très plus moins quelque environ même autant presque leur " +
    "quatre cinq six sept huit neuf onze douze treize quatorze quinze seize vingt trente " +
    "quarante cinquante soixante cent mille un une super méga mini maxi extra ultra hyper " +
    "multi anti ex néo " +
    // "les lundi et mardi": days and months stay singular after a distributive "les".
    "lundi mardi mercredi jeudi vendredi samedi dimanche janvier février mars avril mai juin " +
    "juillet août septembre octobre novembre décembre " +
    // "un tiens vaut mieux que deux tu l'auras": the proverb's noun.
    "tiens rien"
  ).split(" "),
);
// "-al" and "-au/-eu" plurals that take an s.
const PLURAL_IN_S = new Set([
  "bal",
  "carnaval",
  "chacal",
  "festival",
  "récital",
  "régal",
  "cal",
  "naval",
  "fatal",
  "natal",
  "banal",
  "final",
  "bleu",
  "pneu",
  "landau",
  "sarrau",
  "émeu",
]);

const SUBJECTS = new Set([...SUBJECT_PRONOUNS, "ne", "n'", "qui", "ça", "cela"]);
const isVerbForm = (word: string) => verbReadings(word).some((r) => r.slot !== "Q");

/** The plural of a singular noun or adjective. */
function plural(word: string): string {
  if (PLURAL_IN_S.has(word)) return `${word}s`;
  if (/(?:eau|au|eu)$/.test(word)) return `${word}x`;
  if (/al$/.test(word)) return `${word.slice(0, -2)}aux`;
  return `${word}s`;
}

/** The singular a plural form comes from, when the dictionary knows it. */
function singular(word: string): string | null {
  const candidates = [
    /aux$/.test(word) ? `${word.slice(0, -3)}al` : null,
    /[xs]$/.test(word) ? word.slice(0, -1) : null,
  ];
  return candidates.find((c) => c && isNounLemma(c)) ?? null;
}

function nounNumber(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const determiner = m.groups!.det.toLowerCase();
  const typed = m.groups!.noun;
  const word = typed.toLowerCase();
  if (typed !== word || word.length < 3 || ctx.dictionary.has(word)) return null;
  if (NOT_NOUNS.has(word) || namedExampleBefore(ctx.text, m.index)) return null;
  // "quatre enfant": a number from two up is a plural determiner, unless a determiner or a
  // label before makes it a name or a rank ("le numéro deux allemand", "les trois été").
  const digits = /^\d/.test(determiner);
  if (digits && !countable(ctx, m, determiner)) return null;
  if (NUMBER_DETERMINERS.has(determiner) || digits) {
    const before = digits ? undefined : tokensBefore(ctx.text, m.index, 1)[0];
    if (before && (PLURAL.has(before.w) || SINGULAR.has(before.w) || RANKS.has(before.w)))
      return null;
    // "cinq et six", "cent pour cent", "à neuf": parts of a number, a ratio, an adjective.
    if (before && (before.w === "et" || before.w === "pour" || NUMBER_DETERMINERS.has(before.w)))
      return null;
    // "4 ami", "en 3 partie": after a figure, a noun entry is the noun.
    if (adjectiveReadings(word).length && !(digits && nounGender(word))) return null;
    // "en 10 minute": after a figure, a gendered noun that is also a verb form is the noun.
    const verb = isVerbForm(word) && !(digits && isVerbHomograph(word) && nounGender(word));
    if (verb || /[sxz]$/.test(word) || !isInflectedNoun(word)) return null;
    const [start] = m.indices!.groups!.noun;
    const after = ctx.text.slice(start + typed.length, start + typed.length + 12);
    if (/^[-'’]|^[\s ]{0,8}(?:,|et\b|ou\b)/u.test(after)) return null;
    return finding(RULE, MESSAGE, start, start + typed.length, [plural(word)], {
      context: { start: m.index, end: start + typed.length },
    });
  }
  // "deux cent une personnes", "soixante et un ans": a number, not an article. "de ton
  // distincts": the noun "ton" (tone), "son" (sound).
  const previous = tokensBefore(ctx.text, m.index, 2);
  const numberBefore = (t?: { w: string }) =>
    !!t &&
    /^(?:\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|vingt|trente|quarante|cinquante|soixante|cent|mille)$/.test(
      t.w,
    );
  if (
    (determiner === "un" || determiner === "une") &&
    (numberBefore(previous[0]) ||
      (previous[0]?.w === "et" && numberBefore(previous[1])) ||
      /\d[\s\u00a0]*$/u.test(ctx.text.slice(Math.max(0, m.index - 3), m.index)))
  )
    return null;
  if (
    (determiner === "son" || determiner === "ton") &&
    previous[0] &&
    ["de", "le", "un", "du", "ce", "au"].includes(previous[0].w)
  )
    return null;
  // "les épaules son larges": "sont" misspelt after a plural subject.
  if (determiner === "son" && sontForSon(ctx.text, m.index)) return null;
  // "il ne leurs reste rien": the pronoun "leur" misspelt before its verb.
  if (determiner === "leurs" && ["ne", "n'", "se", "s'"].includes(previous[0]?.w ?? ""))
    return null;
  // "vos nom et prénom", "les premier et deuxième": singulars sharing one determiner.
  const [start] = m.indices!.groups!.noun;
  const rest = ctx.text.slice(start + typed.length);
  if (/^[\s\u00a0]*(?:,|et\b|ou\b)/u.test(rest)) return null;
  // "étudiant*es", "résistant(e)s": inclusive endings.
  if (/^[*·(.]\p{L}/u.test(rest)) return null;
  // "ces don Juan": a title before a name.
  if (PLURAL.has(determiner) && /^[ \t]+\p{Lu}/u.test(rest)) return null;
  // "je les aime", "tu la portes", "ce sont": a pronoun before its verb. A word that is
  // also a noun ("la routes", "des porte") counts as one where no verb can follow: after a
  // preposition, a verb or at a clause start, or after a determiner that is no pronoun.
  // "nous la sorts": a pronoun subject makes "la" an object pronoun, whatever follows.
  if (CLITIC.has(determiner) && SUBJECTS.has(previous[0]?.w ?? "")) return null;
  if (isVerbForm(word)) {
    if (!isVerbHomograph(word)) return null;
    if (CLITIC.has(determiner)) {
      // "les voyant si nerveux", "de les avoir vus": a present participle or an infinitive.
      if (verbReadings(word).some((r) => r.slot === "G" || r.slot === "I")) return null;
      const before = tokensBefore(ctx.text, m.index, 1)[0];
      const nounSlot =
        !before ||
        PREPOSITIONS.has(before.w) ||
        (!isVerbHomograph(before.w) &&
          verbReadings(before.w).some((r) => typeof r.slot === "number") &&
          !SUBJECTS.has(before.w));
      if (!nounSlot) return null;
    }
  }
  let fixed: string | null = null;
  if (PLURAL.has(determiner)) {
    if (/[sxz]$/.test(word) || !isInflectedNoun(word)) return null;
    fixed = plural(word);
  } else if (SINGULAR.has(determiner)) {
    // "un enfants": a regular plural, not an entry of its own ("un temps") or a function word.
    if (!/[sx]$/.test(word) || isNounLemma(word) || !isInflectedNoun(word)) return null;
    fixed = singular(word);
  }
  if (!fixed) return null;
  return finding(RULE, MESSAGE, start, start + typed.length, [fixed], {
    context: { start: m.index, end: start + typed.length },
  });
}

// Nouns after a figure that name a place or a score, not a count ("au 12 rue", "à 3 contre 1"),
// and abbreviations ("5 min", "2 vol.").
const NOT_COUNTED = new Set(
  "rue avenue boulevard place allée impasse chemin quai route contre min max hab vol".split(" "),
);

/** "j'ai 4 enfant", "en 3 partie": a figure from 2 up counts the noun after it. Not a year, a
 * decimal, a range, a score or a label ("page 4 ligne"): only after a preposition, a plural
 * determiner, a verb or at a clause start. */
function countable(ctx: DetectContext, m: RegExpExecArray, figure: string): boolean {
  const value = Number(figure.replace(/\D/g, ""));
  if (value < 2 || (figure.length === 4 && value >= 1000 && value < 2100)) return false;
  const noun = m.groups!.noun.toLowerCase();
  if (NOT_COUNTED.has(noun) || /^i?[eè]me$/.test(noun)) return false;
  const rest = ctx.text.slice(m.indices!.groups!.noun[1], m.indices!.groups!.noun[1] + 3);
  // "4 partie 2", "420 sujet(s)": a label, an inclusive ending.
  if (/^(?:[\s\u00a0]*\d|[(*·])/u.test(rest)) return false;
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  if (!before || /[.!?:;\n]/.test(ctx.text.slice(before.end, m.index))) return true;
  const readings = verbReadings(before.w);
  return (
    PREPOSITIONS.has(before.w) ||
    PLURAL.has(before.w) ||
    before.w === "et" ||
    before.w === "en" ||
    (readings.length > 0 && (!isInflectedNoun(before.w) || readings.every((r) => r.slot === "Q")))
  );
}

const NUMBER_DETERMINERS = new Set(
  (
    "deux trois quatre cinq six sept huit dix onze douze treize quatorze quinze seize vingt " +
    "trente quarante cinquante soixante cent mille"
  ).split(" "),
);
// Labels a number names a rank or an item after: "numéro deux", "page trois", "chapitre dix".
const RANKS = new Set(
  "numéro page chapitre article tome acte scène étage rang n° volume livre partie leçon".split(" "),
);

const DETERMINER_NOUN = new RegExp(
  `(?:(?<![\\p{L}\\p{M}\\p{N}_'’-])(?<det>${[...PLURAL, ...SINGULAR, ...NUMBER_DETERMINERS].join("|")}|(?<![\\d.,:/°#№]|n°[ \\t]?)\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|(?<![\\d.,:/°#№]|n°[ \\t]?)\\d+))(?=[ \\t]+(?<noun>\\p{L}+)(?![\\p{L}\\p{M}\\p{N}_'’-]))`,
  "dgiu",
);

// Adjectives that stand before their noun; the masculine forms in s or x ("gros", "vieux")
// show no number and are left out.
const PRENOMINAL_BASES = (
  "grand grande petit petite grosse beau belle bon bonne mauvaise jeune vieille nouveau " +
  "nouvelle joli jolie long longue haut haute vrai vraie fausse propre premier première " +
  "dernier dernière prochain prochaine seul seule même autre meilleur meilleure pire " +
  "gentil gentille excellent excellente"
).split(" ");
const SINGULAR_ADJECTIVES = new Set(PRENOMINAL_BASES);
const PLURAL_ADJECTIVES = new Set(PRENOMINAL_BASES.map(plural));
const DEGREE_WORDS = new Set("plus moins très si aussi trop".split(" "));
// Nouns that stay singular in apposition: "des idées choc", "des dates limite".
const APPOSITIVE_NOUNS = new Set(
  "clé choc culte limite phare pilote type éclair record modèle témoin maison minute".split(" "),
);

/** "de grosses société", "leurs propres démarcation", "un autre jours": a noun after an
 * adjective that stands before it takes the number the adjective and its determiner show. */
function adjectiveNounNumber(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const adjective = m.groups!.adj.toLowerCase();
  const typed = m.groups!.noun;
  const word = typed.toLowerCase();
  if (typed !== word || word.length < 3 || ctx.dictionary.has(word)) return null;
  // "deux Parisiennes bascule": a capitalized word inside the sentence names people, and the
  // word after it may be their verb.
  if (/^\p{Lu}/u.test(m.groups!.adj) && tokensBefore(ctx.text, m.index, 1).length) return null;
  if (NOT_NOUNS.has(word) || namedExampleBefore(ctx.text, m.index)) return null;
  if (isVerbForm(word) && !isVerbHomograph(word)) return null;
  // "laisser les autres noyer", "les seuls restant": an infinitive or a present participle.
  if (verbReadings(word).some((r) => r.slot === "I" || r.slot === "G")) return null;
  const tokens = tokensBefore(ctx.text, m.index, 4);
  const at = tokens.findIndex((t) => !DEGREE_WORDS.has(t.w));
  const before = tokens[at];
  if (!before) return null;
  // "une des plus anciennes fabrique encore": "une des" is the subject of the verb that follows.
  if (before.w === "des" && ["un", "une", "l'un", "l'une"].includes(tokens[at + 1]?.w ?? ""))
    return null;
  const [start] = m.indices!.groups!.noun;
  const rest = ctx.text.slice(start + typed.length);
  // "les mêmes nom et prénom", "les grands-parents", "étudiant*es".
  if (/^(?:[\s ]*(?:,|et\b|ou\b)|[-*·(.]\p{L})/u.test(rest)) return null;
  let fixed: string | null = null;
  // "de violentes migraine": any feminine plural adjective before a feminine noun.
  const femininePlural =
    /es$/.test(adjective) &&
    !APPOSITIVE_NOUNS.has(word) &&
    nounGender(word) === "f" &&
    adjectiveReadings(adjective).some((r) => r.slot === "fp");
  if (PLURAL_ADJECTIVES.has(adjective) || femininePlural) {
    const pluralBefore =
      PLURAL.has(before.w) || NUMBER_DETERMINERS.has(before.w) || /^d[e']$/.test(before.w);
    if (!pluralBefore || /[sxz]$/.test(word) || !isInflectedNoun(word)) return null;
    fixed = plural(word);
  } else if (SINGULAR_ADJECTIVES.has(adjective) && SINGULAR.has(before.w)) {
    if (!/[sx]$/.test(word) || isNounLemma(word) || !isInflectedNoun(word)) return null;
    fixed = singular(word);
  }
  if (!fixed) return null;
  return finding(RULE, MESSAGE, start, start + typed.length, [fixed], {
    context: { start: before.start, end: start + typed.length },
  });
}

const ADJECTIVE_NOUN = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_-])(?<adj>${[...SINGULAR_ADJECTIVES, ...PLURAL_ADJECTIVES].join("|")}|\\p{L}+es)(?=[ \\t]+(?<noun>\\p{L}+)(?![\\p{L}\\p{M}\\p{N}_'’-]))`,
  "dgiu",
);

// Determiners whose number a superlative may contradict, with their forms for ms, fs and plural.
const DEGREE_DETERMINERS: Record<string, [string, string, string]> = {
  le: ["le", "la", "les"],
  la: ["le", "la", "les"],
  les: ["le", "la", "les"],
  au: ["au", "à la", "aux"],
  aux: ["au", "à la", "aux"],
  ce: ["ce", "cette", "ces"],
  cette: ["ce", "cette", "ces"],
  ces: ["ce", "cette", "ces"],
  leur: ["leur", "leur", "leurs"],
  leurs: ["leur", "leur", "leurs"],
};
// Words in the adjective slot that are determiners: "au moins certaines règles".
const NOT_SUPERLATIVES = new Set(
  "certain certaine certains certaines autre autres même mêmes".split(" "),
);
const SUPERLATIVE = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?<det>${Object.keys(DEGREE_DETERMINERS).join("|")})(?=[ \\t]+(?<degree>plus|moins|très)[ \\t]+(?<adj>\\p{L}+)[ \\t]+(?<noun>\\p{L}+)(?![\\p{L}\\p{M}\\p{N}_'’-]))`,
  "dgiu",
);

/** "Les plus beau garçon" -> "Le", "la plus beaux parcs" -> "les": before a degree word, an
 * adjective and a noun that agree, the determiner takes their number. */
function superlativeDeterminer(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m.groups!.det;
  const det = typed.toLowerCase();
  const { adj, noun } = m.groups!;
  if (ctx.dictionary.has(noun) || namedExampleBefore(ctx.text, m.index)) return null;
  if (!isInflectedNoun(noun) || (verbReadings(noun).length && !isVerbHomograph(noun))) return null;
  // "les temps": a noun in s that is its own singular shows no number.
  if (isNounLemma(noun) && /[sxz]$/.test(noun)) return null;
  const nounPlural = /[sx]$/.test(noun);
  const gender = nounGender(nounPlural ? (singular(noun) ?? noun) : noun);
  // "au moins certaines règles": a locution and a determiner, no superlative. "les plus gros
  // budget": an adjective in s or x shows no number.
  if (det === "au" && m.groups!.degree.toLowerCase() === "moins") return null;
  const all = adjectiveReadings(adj).map((r) => r.slot);
  if (NOT_SUPERLATIVES.has(adj) || new Set(all.map((slot) => slot[1])).size > 1) return null;
  const slots = all.filter(
    (slot) => slot.endsWith(nounPlural ? "p" : "s") && (!gender || slot[0] === gender),
  );
  if (!slots.length || new Set(slots).size > 1) return null;
  const forms = DEGREE_DETERMINERS[det];
  const right = nounPlural ? forms[2] : slots[0] === "fs" ? forms[1] : forms[0];
  if ((forms[2] === det) === nounPlural) return null;
  // "je les plus": a pronoun before a verb is no determiner.
  if (CLITIC.has(det) && tokensBefore(ctx.text, m.index, 1).some((t) => SUBJECT_PRONOUNS.has(t.w)))
    return null;
  return finding(RULE, MESSAGE, m.index, m.index + typed.length, [carryCase(typed, right)], {
    context: { start: m.index, end: m.indices!.groups!.noun[1] },
  });
}

function nounNumbers(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, DETERMINER_NOUN)) {
    const finding = nounNumber(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, ADJECTIVE_NOUN)) {
    const finding = adjectiveNounNumber(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, SUPERLATIVE)) {
    const finding = superlativeDeterminer(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: nounNumbers }];
