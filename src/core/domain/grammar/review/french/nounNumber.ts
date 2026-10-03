import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { adjectiveReadings, isInflectedNoun, isVerbHomograph, verbReadings } from "./frenchLexicon";
import { ownedFrenchWords, SUBJECT_PRONOUNS, tokensBefore } from "./frenchTokens";

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
    "tiens"
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
const PREPOSITIONS = new Set(
  "de d' à dans sur sous pour par avec sans chez vers entre après avant contre pendant depuis selon".split(
    " ",
  ),
);

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
  return candidates.find((c) => c && isInflectedNoun(c)) ?? null;
}

function nounNumber(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const determiner = m.groups!.det.toLowerCase();
  const typed = m.groups!.noun;
  const word = typed.toLowerCase();
  if (typed !== word || word.length < 3 || ctx.dictionary.has(word)) return null;
  if (NOT_NOUNS.has(word) || namedExampleBefore(ctx.text, m.index)) return null;
  // "quatre enfant": a number from two up is a plural determiner, unless a determiner or a
  // label before makes it a name or a rank ("le numéro deux allemand", "les trois été").
  if (NUMBER_DETERMINERS.has(determiner)) {
    const before = tokensBefore(ctx.text, m.index, 1)[0];
    if (before && (PLURAL.has(before.w) || SINGULAR.has(before.w) || RANKS.has(before.w)))
      return null;
    // "cinq et six", "cent pour cent", "à neuf": parts of a number, a ratio, an adjective.
    if (before && (before.w === "et" || before.w === "pour" || NUMBER_DETERMINERS.has(before.w)))
      return null;
    if (adjectiveReadings(word).length) return null;
    if (isVerbForm(word) || /[sxz]$/.test(word) || !isInflectedNoun(word)) return null;
    const [start] = m.indices!.groups!.noun;
    const after = ctx.text.slice(start + typed.length, start + typed.length + 12);
    if (/^[-'’]|^[\s ]{0,8}(?:,|et\b|ou\b)/u.test(after)) return null;
    return {
      ruleId: RULE,
      messageKey: MESSAGE,
      range: { start, end: start + typed.length },
      alternatives: [plural(word)],
      context: { start: m.index, end: start + typed.length },
    };
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
  if (
    determiner === "son" &&
    previous[1] &&
    PLURAL.has(previous[1].w) &&
    /[sx]$/.test(previous[0].w)
  )
    return null;
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
    if (!/[sx]$/.test(word) || isInflectedNoun(word)) return null;
    fixed = singular(word);
  }
  if (!fixed) return null;
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start, end: start + typed.length },
    alternatives: [fixed],
    context: { start: m.index, end: start + typed.length },
  };
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
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?<det>${[...PLURAL, ...SINGULAR, ...NUMBER_DETERMINERS].join("|")})(?=[ \\t]+(?<noun>\\p{L}+)(?![\\p{L}\\p{M}\\p{N}_'’-]))`,
  "dgiu",
);

function nounNumbers(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, DETERMINER_NOUN)) {
    const finding = nounNumber(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: nounNumbers }];
