import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  genderable,
  IL,
  ILS,
  inflect,
  isInflectedNoun,
  isNounLemma,
  type Inflection,
  isVerbHomograph,
  JE,
  nounGender,
  NOUS,
  pastParticiple,
  pluralSingulars,
  TU,
  verbReadings,
} from "./frenchLexicon";
import { firstNameGender } from "./firstNames";
import { ownedFrenchWords, type Token, tokensAfter, tokensBefore } from "./frenchTokens";
import { finding } from "../finding";
import { carryCase } from "../../implementations/helpers/GenericRuleShared";
import { isLang } from "../phraseTemplates";

// An adjective or a past participle takes the gender and number of its noun: right after it
// ("une forêt tropicale", "des dossiers triés") or after être with the noun phrase or a
// third-person pronoun as its subject ("la réunion est annulée", "ils sont français"). The gender
// comes from the determiner or the noun; adjective forms from the dictionary's gender flags.

const RULE = "frenchAdjectiveAgreement";
const MESSAGE = "review_msg_fr_adjective_agreement";

type Gender = "m" | "f";
/** Determiners with the gender (null: either) and number they show. */
const DETERMINERS: Record<string, [Gender | null, "s" | "p"]> = {
  le: ["m", "s"],
  la: ["f", "s"],
  "l'": [null, "s"],
  un: ["m", "s"],
  une: ["f", "s"],
  ce: ["m", "s"],
  cet: ["m", "s"],
  cette: ["f", "s"],
  mon: [null, "s"],
  ton: [null, "s"],
  son: [null, "s"],
  ma: ["f", "s"],
  ta: ["f", "s"],
  sa: ["f", "s"],
  notre: [null, "s"],
  votre: [null, "s"],
  leur: [null, "s"],
  les: [null, "p"],
  ces: [null, "p"],
  mes: [null, "p"],
  tes: [null, "p"],
  ses: [null, "p"],
  nos: [null, "p"],
  vos: [null, "p"],
  leurs: [null, "p"],
  des: [null, "p"],
};
const LINKING = new Set(
  (
    "est sont était étaient sera seront serait seraient fut furent soit soient " +
    "semble semblent paraît paraissent devient deviennent reste restent demeure demeurent"
  ).split(" "),
);
const ADVERBS = new Set(
  (
    "très si trop assez plus moins bien fort peu vraiment toujours encore déjà souvent rien " +
    "pas jamais donc pourtant aussi parfois enfin alors certes presque absolument guère point " +
    "particulièrement extrêmement totalement complètement entièrement désormais beaucoup " +
    "tellement longtemps"
  ).split(" "),
);
const PREPOSITIONS = new Set(
  "pour sur dans avec sans sous chez vers entre selon malgré pendant depuis contre devant derrière".split(
    " ",
  ),
);
/** Words after which a noun phrase or a pronoun opens a clause. */
const OPENERS = new Set(
  "mais car donc que qu' quand si lorsque lorsqu' puisque puisqu' comme où alors".split(" "),
);
// "bleu clair", "bon marché": a compound color or price is invariable.
const COMPOUND_SECOND = new Set(
  "clair foncé vif pâle marine ciel nuit roi électrique canard pétrole sombre marché cri devant public sur".split(
    " ",
  ),
);
// Adjective entries that are mostly something else here: prepositions ("sur"), numbers ("un",
// "neuf"), invariable colors ("marron"), determiners ("certain", "tel").
const NOT_ADJECTIVES = new Set(
  (
    "sur un neuf marron orange kaki cerise crème olive paille saumon turquoise bordeaux " +
    "certain tel nul aucun même autre tors soudain client cadre modèle type standard clé " +
    // Adjectives used as adverbs: "plus haut", "voir clair", "coûter cher".
    "haut bas fort cher juste net clair faux droit"
  ).split(" "),
);
// Of those, the ones that are plain adjectives after être: "les actions sont fortes".
const PREDICATE_ADJECTIVES = new Set("haut bas fort cher juste net clair faux droit".split(" "));
// Nouns that open adverbial or quantity phrases ("un peu", "la plupart", "l'air").
const NOT_NOUNS = new Set(
  (
    "peu plupart air autre tout rien reste moins plus point fait cas soit fois pas avant devant " +
    "derrière dessus dessous arrière environ abord"
  ).split(" "),
);

// Nouns a "que" clause may complete rather than qualify: "l'idée que tu as compris".
const COMPLETED_NOUNS = new Set(
  (
    "impression idée sentiment espoir peur crainte certitude preuve conviction hypothèse " +
    "sensation illusion opinion avis pensée constat conclusion signe garantie assurance"
  ).split(" "),
);

/** Where an agreeing word stands: after a noun, after être, or as the participle after avoir. */
type Place = "noun" | "être" | "avoir";

/** The masculine singular of a past participle no noun or adjective entry spells: "trié" for
 * "triées", "pris" for "prise". Right after être a first-group participle that is also a noun
 * ("arrivée", "passé") is the participle; after avoir any is ("attendu", "rendus"). */
function participleBase(word: string, place: Place = "noun"): string | null {
  if (word === "dû") return null;
  const verbal = place === "avoir" || (place === "être" && /é(?:e|s|es)?$/.test(word));
  if (isVerbHomograph(word) && !verbal) return null;
  const lemmas = new Set(verbReadings(word).flatMap((r) => (r.slot === "Q" ? [r.lemma] : [])));
  if (!lemmas.size) return null;
  const participle = (base: string) =>
    verbReadings(base).some((r) => r.slot === "Q" && lemmas.has(r.lemma));
  const candidates = [/es$/, /e$/, /s$/]
    .map((ending) => word.replace(ending, ""))
    .filter((base) => base !== word)
    .concat(word);
  return candidates.find((base) => !/e$/.test(base) && participle(base)) ?? null;
}

/** The form of an adjective or participle for an inflection; null when it has it already or is
 * no adjective the dictionary inflects. */
function agreeing(word: string, target: Inflection, place: Place = "noun"): string | null {
  const readings = adjectiveReadings(word);
  if (readings.length) {
    if (readings.some((r) => r.slot === target || !genderable(r.lemma))) return null;
    const adverbial = (lemma: string) =>
      NOT_ADJECTIVES.has(lemma) && !(place === "être" && PREDICATE_ADJECTIVES.has(lemma));
    if (readings.some((r) => adverbial(r.lemma) || /(?:eur|rice|euse)$/.test(r.lemma))) return null;
    // "avares", "torse": an epicene adjective or a noun spelled like a gendered form.
    const singular = word.replace(/s$/, "");
    if (readings.every((r) => r.lemma !== singular) && isInflectedNoun(singular)) return null;
    return inflect(readings[0], target)[0] ?? null;
  }
  const base = participleBase(word, place);
  if (!base) return null;
  const forms: Record<Inflection, string> = {
    ms: base,
    mp: /[sx]$/.test(base) ? base : `${base}s`,
    fs: `${base}e`,
    fp: `${base}es`,
  };
  const slots = (Object.keys(forms) as Inflection[]).filter((slot) => forms[slot] === word);
  if (!slots.length || slots.includes(target)) return null;
  // "été", "pu": a participle that never agrees has no other form to offer.
  return verbReadings(forms[target]).some((r) => r.slot === "Q") ? forms[target] : null;
}

function adjectiveFinding(
  ctx: DetectContext,
  word: Token,
  target: Inflection,
  from: number,
  place: Place = "noun",
) {
  const typed = ctx.text.slice(word.start, word.end);
  if (typed !== word.w || word.hyphen || ctx.dictionary.has(word.w)) return null;
  // "bien sûr": the adverb.
  if (word.w === "sûr" && tokensBefore(ctx.text, word.start, 1)[0]?.w === "bien") return null;
  const after = tokensAfter(ctx.text, word.end, 1)[0];
  if (after && COMPOUND_SECOND.has(after.w)) return null;
  // "des cheveux noir de jais": a color with a complement is invariable.
  if (after && /^d[e']$/.test(after.w) && word.w in COLOR_FORMS) return null;
  // "rouge et blanc", "noir, blanc": coordinated adjectives may share out a plural noun;
  // "petites fleurs": an adjective before its own noun.
  if (/^[\s\u00a0]{0,8},/u.test(ctx.text.slice(word.end, word.end + 9))) return null;
  // "des conseils spécial bébés": an adjective before a noun.
  const nounAfter = (w: string) => nounGender(w) || pluralSingulars(w).some((s) => nounGender(s));
  if (after && (["et", "ou"].includes(after.w) || nounAfter(after.w))) return null;
  const form = agreeing(word.w, target, place);
  if (!form) return null;
  return finding(RULE, MESSAGE, word.start, word.end, [carryCase(typed, form)], {
    context: { start: from, end: word.end },
  }) satisfies RawFinding;
}

/** A noun phrase's gender and number from its determiner and noun; null when unknown or when
 * they disagree (another check's finding). */
function phraseInflection(det: string, noun: string): Inflection | null {
  const [detGender, number] = DETERMINERS[det];
  const plural = /[sx]$/.test(noun);
  if (number === "p" && !plural) return null;
  const singular = number === "p" ? noun.replace(/aux$/, "al").replace(/[sx]$/, "") : noun;
  // "un somme" (nap) or "une somme", "une interprète": a noun of either gender takes the gender
  // its determiner shows.
  if (!genderable(singular) || !genderable(noun))
    return detGender ? (`${detGender}${number}` as Inflection) : null;
  // "les cours", "les temps": an entry in s is its own plural, and its gender is its own.
  if (plural && isNounLemma(noun) && !nounGender(noun)) return null;
  // "les nouvelles": a gendered form used as a noun shows its gender.
  const shown = [...new Set(adjectiveReadings(noun).map((r) => r.slot[0] as Gender))];
  const gender =
    (plural && nounGender(noun)) || nounGender(singular) || (shown.length === 1 ? shown[0] : null);
  if (number === "s" && plural && !gender) return null;
  if (detGender && gender && detGender !== gender) return null;
  const g = detGender ?? gender;
  return g ? `${g}${number}` : null;
}

const SUBJECT_INFLECTIONS: Record<string, Inflection[]> = {
  je: ["ms", "fs"],
  "j'": ["ms", "fs"],
  tu: ["ms", "fs"],
  il: ["ms"],
  elle: ["fs"],
  on: ["ms", "fs", "mp", "fp"],
  nous: ["mp", "fp"],
  vous: ["ms", "fs", "mp", "fp"],
  ils: ["mp"],
  elles: ["fp"],
};

/** The inflections a form already has. */
function slotsOf(word: string, place: Place = "noun"): Inflection[] {
  const readings = adjectiveReadings(word);
  if (readings.length) return readings.map((r) => r.slot);
  const base = participleBase(word, place);
  if (!base) return [];
  const forms = {
    ms: base,
    mp: /[sx]$/.test(base) ? base : `${base}s`,
    fs: `${base}e`,
    fp: `${base}es`,
  };
  return (Object.keys(forms) as Inflection[]).filter((slot) => forms[slot] === word);
}

/** Whether a word after an object could describe the clause's subject: a pronoun or a name it
 * agrees with, or a subject this check cannot read. */
function fitsSubject(ctx: DetectContext, verbStart: number, word: string): boolean {
  const slots = slotsOf(word);
  for (const token of tokensBefore(ctx.text, verbStart, 6)) {
    if (token.w in SUBJECT_INFLECTIONS)
      return SUBJECT_INFLECTIONS[token.w].some((slot) => slots.includes(slot));
    if (/^\p{Lu}/u.test(ctx.text[token.start])) return true;
    if (token.w in DETERMINERS) {
      const noun = tokensAfter(ctx.text, token.start, 2)[1];
      const subject = noun && phraseInflection(token.w, noun.w);
      return !subject || slots.includes(subject);
    }
  }
  // Only an imperative opening its sentence has no subject ("Range les dossiers").
  return tokensBefore(ctx.text, verbStart, 1).length > 0;
}

const ADVERB_PAIRS = new Set([
  "par conséquent",
  "bien entendu",
  "pour autant",
  "de nouveau",
  "en effet",
  "sans doute",
]);

/** Skips adverbs ("très", "un peu", "un petit peu") from index i. */
function skipAdverbs(tokens: Token[], i: number): number {
  for (;;) {
    const w = tokens[i]?.w;
    // "peut-être", "par conséquent", "bien entendu", "pour autant".
    if (w && ADVERB_PAIRS.has(`${w} ${tokens[i + 1]?.w}`)) i += 2;
    else if (w && (ADVERBS.has(w) || (/..ment$/.test(w) && !isInflectedNoun(w)))) i++;
    else if (w === "peut" && tokens[i].hyphen && tokens[i + 1]?.w === "être") i += 2;
    else if (tokens[i]?.w === "un" && tokens[i + 1]?.w === "peu") i += 2;
    else if (tokens[i]?.w === "un" && tokens[i + 1]?.w === "petit" && tokens[i + 2]?.w === "peu")
      i += 3;
    else return i;
  }
}

// Adjectives that stand before their noun: "la petite maison".
const PRENOMINAL = new Set(
  (
    "grand petit beau bon nouveau vieux jeune joli gros long haut mauvais premier dernier seul " +
    "vrai faux meilleur"
  ).split(" "),
);

/** The words from a determiner on, read as determiner, noun, then the rest. Left out: an adjective
 * before the noun of a subject ("la petite maison est"), a number after the noun ("le chapitre 4
 * est") and an adjective between the noun and a linking verb ("des guillemets anglais sont"). */
function subjectTokens(ctx: DetectContext, index: number): Token[] {
  let tokens = tokensAfter(ctx.text, index, 7);
  const prenominal = (t: Token | undefined) =>
    t !== undefined && adjectiveReadings(t.w).some((r) => PRENOMINAL.has(r.lemma));
  if (
    prenominal(tokens[1]) &&
    tokens[2] &&
    isInflectedNoun(tokens[2].w) &&
    !prenominal(tokens[2])
  ) {
    const dropped = [tokens[0], ...tokens.slice(2)];
    if (linkingEnd(dropped, 2, IL | ILS) > 0) tokens = dropped;
  }
  const label =
    tokens.length === 2 && /^[ \t]+\d+[ \t]+(?=\p{L})/u.exec(ctx.text.slice(tokens[1].end));
  if (label) tokens = [...tokens, ...tokensAfter(ctx.text, tokens[1].end + label[0].length, 5)];
  const third = tokens[2];
  if (
    third &&
    !third.hyphen &&
    (adjectiveReadings(third.w).length || verbReadings(third.w).some((r) => r.slot === "Q")) &&
    !verbReadings(third.w).some((r) => typeof r.slot === "number") &&
    linkingEnd(tokens, 3, IL | ILS) > 0
  )
    tokens = [tokens[0], tokens[1], ...tokens.slice(3)];
  return tokens;
}

/** "une forêt tropical", "la réunion est annulé". */
function afterNoun(ctx: DetectContext, m: RegExpExecArray, det: string): RawFinding | null {
  const tokens = subjectTokens(ctx, m.index);
  const noun = tokens[1];
  if (!noun || tokens[0].w !== det || noun.hyphen) return null;
  if (ctx.text.slice(noun.start, noun.end) !== noun.w || noun.w.length < 3) return null;
  if (NOT_NOUNS.has(noun.w) || noun.w.endsWith("ment")) return null;
  if (!isVerbHomograph(noun.w) && verbReadings(noun.w).some((r) => typeof r.slot === "number"))
    return null;
  const [detGender, detNumber] = DETERMINERS[det];
  // "un grand chien", "la porte": the noun slot holds an adjective or a verb. Before être it is
  // the noun ("le plan est"), with the determiner's gender.
  const forms = new Set(adjectiveReadings(noun.w).map((r) => r.slot));
  const adjectival = forms.size > 0;
  const linkAt = linkingEnd(tokens, 2, detNumber === "p" ? ILS : IL);
  // "ses voisines": a plural gendered noun has the one inflection its form shows.
  const shown = detNumber === "p" && forms.size === 1 ? [...forms][0] : null;
  if (shown && !shown.endsWith("p")) return null;
  if (adjectival && (linkAt < 0 || ((!detGender || detNumber === "p") && !shown))) return null;
  const target = adjectival
    ? (shown ?? (`${detGender}s` as Inflection))
    : phraseInflection(det, noun.w);
  if (!target) return null;
  // "toute la matinée": the word before the predeterminer.
  const previous = tokensBefore(ctx.text, m.index, 2);
  const predeterminer = ["tout", "toute", "tous", "toutes"].includes(previous[0]?.w ?? "");
  const before = predeterminer ? previous[1] : previous[0];
  const anchor = predeterminer ? previous[0].start : m.index;
  // "de la porte du garage, ouverte": the adjective may go with another noun. Before a verb that
  // agrees with the noun phrase alone, a comma only ends an opening phrase.
  if (linkAt < 0 && /[,;]\s*$/.test(ctx.text.slice(Math.max(0, anchor - 3), anchor))) return null;
  if (["et", "ou", "ni"].includes(before?.w ?? "")) return null;
  if (linkAt > 0) {
    // The noun phrase opens its clause and is the subject of être.
    if (before && !OPENERS.has(before.w)) return null;
    const word = tokens[skipAdverbs(tokens, linkAt)];
    return word ? predicateFinding(ctx, word, [target], m.index) : null;
  }
  // "des" may be "de" + "les" ("le bruit des moteurs puissant"): only at a clause start or after
  // a preposition other than "de" is it the plural article.
  if (det === "des" && before && !PREPOSITIONS.has(before.w)) return null;
  const i = skipAdverbs(tokens, 2);
  const next = tokens[i];
  if (!next) return null;
  if (!LINKING.has(next.w)) {
    if (before && ["de", "d'", "à", "par", "en"].includes(before.w)) return null;
    // "est pour sa part élu": a participle after a prepositional phrase goes with the subject.
    if (before && PREPOSITIONS.has(before.w) && verbReadings(next.w).some((r) => r.slot === "Q"))
      return null;
    // "Thomas passe ses journées enfermé": after a verb, the adjective may describe its subject.
    if (before && verbReadings(before.w).length && fitsSubject(ctx, before.start, next.w))
      return null;
    // "La loi contraint", "une main tenant un flambeau": a verb, not an adjective. An adjective
    // that is also a present participle ends its clause: "la réunion suivant."
    const readings = verbReadings(next.w);
    if (readings.some((r) => typeof r.slot === "number")) return null;
    const ends = /^[\s\u00a0]*(?:[.!?;:)]|$)/u.test(ctx.text.slice(next.end, next.end + 9));
    if (readings.some((r) => r.slot === "G") && !(ends && adjectiveReadings(next.w).length))
      return null;
    // "a dans les faits duré", "section étranger / non étranger": a participle of a compound
    // tense, a list of labels.
    const clause = tokensBefore(ctx.text, m.index, 6);
    const avoir = clause.some((t) => verbReadings(t.w).some((r) => r.lemma === "avoir"));
    if (avoir && !adjectiveReadings(next.w).length) return null;
    if (/^[\s\u00a0]{0,8}\//u.test(ctx.text.slice(next.end, next.end + 9))) return null;
    return adjectiveFinding(ctx, next, target, m.index);
  }
  return null;
}

// Adjective entries that are prepositions before a determiner: "pendant des années".
const PREPOSITION_LIKE = new Set(
  "pendant durant suivant concernant touchant moyennant excepté passé vu".split(" "),
);
const LINKING_LEMMAS = new Set(["être", "sembler", "paraître", "devenir", "rester", "demeurer"]);

const MODALS = new Set(["pouvoir", "devoir", "sembler", "paraître", "aller", "vouloir"]);
const INDIRECT_OBJECTS = new Set(["me", "m'", "te", "t'", "lui", "leur", "nous", "vous"]);

/** The index just past a linking verb at `i` that agrees with `person` ("est", "semblaient") or
 * past avoir + "été" ("ont été", "avait déjà été"); -1 when there is none. */
function linkingEnd(tokens: Token[], i: number, person: number): number {
  // "sa remarque m'a paru", "la salle lui semblait": an indirect object pronoun before the verb.
  if (tokens[i] && INDIRECT_OBJECTS.has(tokens[i].w)) i++;
  const verb = tokens[i];
  // "est-il": an inversion.
  if (!verb || verb.hyphen) return -1;
  const readings = verbReadings(verb.w).filter(
    (r) => typeof r.slot === "number" && r.slot & person,
  );
  // "peut être observée", "semble avoir été annoncé", "doit être arrivés": a modal and the
  // infinitive être or "avoir été".
  if (readings.some((r) => MODALS.has(r.lemma))) {
    const k = skipAdverbs(tokens, i + 1);
    const next = tokens[k];
    if (next?.w === "être" && !next.hyphen) return k + 1;
    if (next?.w === "avoir" && tokens[k + 1]?.w === "été" && !tokens[k + 1].hyphen) return k + 2;
  }
  if (readings.some((r) => LINKING_LEMMAS.has(r.lemma))) return i + 1;
  if (!readings.some((r) => r.lemma === "avoir")) return -1;
  const k = skipAdverbs(tokens, i + 1);
  // "elle a l'air contente": avoir l'air takes an attribute too.
  if (tokens[k]?.w === "l'" && tokens[k + 1]?.w === "air") return k + 2;
  const participle = tokens[k];
  if (!participle || participle.hyphen) return -1;
  // "a paru", "a semblé"; "ont pu être", "aurait dû être".
  if (participle.w === "été" || participle.w === "paru" || participle.w === "semblé") return k + 1;
  const modal = verbReadings(participle.w).some((r) => r.slot === "Q" && MODALS.has(r.lemma));
  return modal && tokens[k + 1]?.w === "être" && !tokens[k + 1].hyphen ? k + 2 : -1;
}

/** An adjective or participle after être that fits none of the subject's inflections: the
 * nearest one that fits (the typed gender kept when it can be). */
function predicateFinding(
  ctx: DetectContext,
  word: Token,
  allowed: Inflection[],
  from: number,
): RawFinding | null {
  if (word.hyphen) return null;
  // "fin prêts", "grand ouverts": an adjective used as an adverb before another one.
  // "été pendant des années": a preposition.
  const after = tokensAfter(ctx.text, word.end, 1)[0];
  if (
    after &&
    !PREPOSITIONS.has(after.w) &&
    (adjectiveReadings(after.w).length || participleBase(after.w))
  )
    return null;
  if (after && PREPOSITION_LIKE.has(word.w) && after.w in DETERMINERS) return null;
  // "elle a l'air content": the attribute may agree with "air" instead.
  const prior = tokensBefore(ctx.text, word.start, 6);
  const air = prior.findIndex((t) => !ADVERBS.has(t.w));
  if (prior[air]?.w === "air" && prior[air + 1]?.w === "l'") allowed = [...allowed, "ms"];
  const slots = slotsOf(word.w, "être");
  if (!slots.length) {
    // "tu étais jeunes": an adjective of either gender keeps its singular in -e; "quelques
    // fois": not before a noun.
    if (allowed.some((slot) => slot.endsWith("p")) || !/..es$/.test(word.w)) return null;
    if (after && (isInflectedNoun(after.w) || nounGender(after.w))) return null;
    const singular = word.w.slice(0, -1);
    if (ADVERBS.has(word.w) || !isInflectedNoun(singular) || verbReadings(word.w).length)
      return null;
    const typed = ctx.text.slice(word.start, word.end);
    if (typed !== word.w || ctx.dictionary.has(word.w) || namedExampleBefore(ctx.text, word.start))
      return null;
    return finding(RULE, MESSAGE, word.start, word.end, [singular], {
      context: { start: from, end: word.end },
    });
  }
  if (slots.some((slot) => allowed.includes(slot))) return null;
  const target =
    allowed.find((slot) => slots.some((s) => s[0] === slot[0])) ??
    allowed.find((slot) => slots.some((s) => s[1] === slot[1])) ??
    allowed[0];
  return adjectiveFinding(ctx, word, target, from, "être");
}

// Quantity nouns whose predicate may agree with their complement: "la moitié des invités sont
// partis".
const QUANTITIES = new Set(
  (
    "plupart moitié majorité minorité partie totalité ensemble reste nombre foule tiers quart " +
    "dizaine douzaine vingtaine centaine millier multitude série quantité infinité masse"
  ).split(" "),
);
const COMPLEMENT_DETERMINERS = new Set("certains certaines plusieurs quelques".split(" "));

/** A noun, as far as the lists know, or a name or acronym ("du GPS"). */
function nounToken(ctx: DetectContext, t: Token | undefined): boolean {
  if (!t || t.hyphen || t.w in DETERMINERS || NOT_NOUNS.has(t.w)) return false;
  const typed = ctx.text.slice(t.start, t.end);
  if (typed !== t.w) return /^(?:\p{Lu}\p{Ll}+|\p{Lu}{2,6})$/u.test(typed);
  if (!isVerbHomograph(t.w) && verbReadings(t.w).some((r) => typeof r.slot === "number"))
    return false;
  const singular = t.w.replace(/aux$/, "al").replace(/[sx]$/, "");
  return Boolean(
    nounGender(t.w) ||
    nounGender(singular) ||
    isInflectedNoun(singular) ||
    adjectiveReadings(t.w).length,
  );
}

/** Index past the adjectives and participles after a noun: "des données personnelles". */
function skipPostnominal(tokens: Token[], i: number): number {
  for (let n = 0; n < 2; n++) {
    const t = tokens[i];
    if (!t || t.hyphen || t.w.length < 3) break;
    const readings = verbReadings(t.w);
    const adjective = readings.length
      ? readings.every((r) => r.slot === "Q")
      : adjectiveReadings(t.w).length > 0;
    if (!adjective) break;
    i++;
  }
  return i;
}

/** Index past a "de" complement: "de traitement", "des données", "du GPS". */
function skipDeComplement(ctx: DetectContext, tokens: Token[], i: number): number {
  if (!["de", "d'", "du", "des"].includes(tokens[i]?.w ?? "")) return i;
  let k = i + 1;
  const det = tokens[k]?.w ?? "";
  if (det in DETERMINERS || COMPLEMENT_DETERMINERS.has(det)) k++;
  return nounToken(ctx, tokens[k]) ? skipPostnominal(tokens, k + 1) : i;
}

/** A noun's gender from its determiner, its lists or its own gendered forms ("amies"). */
function conjunctGender(det: string, noun: string): Gender | null {
  const known = phraseInflection(det, noun);
  if (known) return known[0] as Gender;
  const detGender = DETERMINERS[det][0];
  if (detGender) return detGender;
  const genders = new Set(adjectiveReadings(noun).map((r) => r.slot[0] as Gender));
  return genders.size === 1 ? [...genders][0] : null;
}

/** "la durée de traitement des données est annoncé", "des tempêtes et des ouragans sont
 * annoncée": a subject past its complements, or two joined by "et", then être. */
function longSubject(ctx: DetectContext, m: RegExpExecArray, det: string): RawFinding | null {
  const tokens = tokensAfter(ctx.text, m.index, 16);
  const noun = tokens[1];
  if (tokens[0]?.w !== det || !nounToken(ctx, noun)) return null;
  if (QUANTITIES.has(noun.w) || QUANTITIES.has(noun.w.replace(/s$/, ""))) return null;
  if (ctx.text.slice(noun.start, noun.end) !== noun.w) return null;
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  if (before && !OPENERS.has(before.w)) return null;
  // ", des bois et des prés": a list may go on after a comma.
  if (!before && /,[\s ]*$/u.test(ctx.text.slice(Math.max(0, m.index - 9), m.index))) return null;
  let target = phraseInflection(det, noun.w);
  let i = skipPostnominal(tokens, 2);
  let person = DETERMINERS[det][1] === "p" ? ILS : IL;
  const second = tokens[i + 2];
  if (tokens[i]?.w === "et" && (tokens[i + 1]?.w ?? "") in DETERMINERS && nounToken(ctx, second)) {
    // Two nouns take a plural, masculine unless both are feminine.
    if (ctx.text.slice(second.start, second.end) !== second.w) return null;
    const genders = [conjunctGender(det, noun.w), conjunctGender(tokens[i + 1].w, second.w)];
    if (genders.includes("m")) target = "mp";
    else if (genders[0] === "f" && genders[1] === "f") target = "fp";
    else return null;
    person = ILS;
    i = skipPostnominal(tokens, i + 3);
  } else {
    const start = i;
    for (let n = 0; n < 2; n++) {
      const next = skipDeComplement(ctx, tokens, i);
      if (next === i) break;
      i = next;
    }
    // A plain subject before être is afterNoun's; before a reflexive verb, this one's.
    if (i === start && !REFLEXIVE.has(tokens[i]?.w ?? "")) return null;
  }
  // "mes professeurs": a noun of either gender still tells the number.
  const plural = DETERMINERS[det][1] === "p";
  if (!target && plural !== /[sx]$/.test(noun.w)) return null;
  const allowed: Inflection[] = target ? [target] : plural ? ["mp", "fp"] : ["ms", "fs"];
  const linkAt = linkingEnd(tokens, i, person);
  if (linkAt < 0) {
    if (!["se", "s'"].includes(tokens[i]?.w ?? "")) return null;
    return reflexiveFinding(ctx, tokens, i, person, allowed, m.index);
  }
  const word = tokens[skipAdverbs(tokens, linkAt)];
  return word ? predicateFinding(ctx, word, allowed, m.index) : null;
}

/** Subjects of être that show their gender or number: "elle est grand", "tu étais jeunes",
 * "celles-là sont folle". */
const SUBJECTS: Record<string, [Inflection[], number]> = {
  je: [["ms", "fs"], JE],
  "j'": [["ms", "fs"], JE],
  tu: [["ms", "fs"], TU],
  il: [["ms"], IL],
  elle: [["fs"], IL],
  nous: [["mp", "fp"], NOUS],
  ils: [["mp"], ILS],
  elles: [["fp"], ILS],
  celui: [["ms"], IL],
  celle: [["fs"], IL],
  ceux: [["mp"], ILS],
  celles: [["fp"], ILS],
  // Quantifiers standing for a noun: "certains étaient venus", "beaucoup sont partis".
  certains: [["mp"], ILS],
  certaines: [["fp"], ILS],
  beaucoup: [["mp", "fp"], ILS],
  plusieurs: [["mp", "fp"], ILS],
};

const DEMONSTRATIVE = /^ce(?:lui|lle|ux|lles)$/;

/** "ils sont françaises", "elle est grand", "nous avons été dénoncé": a pronoun subject, être
 * and an adjective or participle. */
function afterPronoun(ctx: DetectContext, m: RegExpExecArray, pronoun: string): RawFinding | null {
  const [allowed, person] = SUBJECTS[pronoun];
  let start = m.index + m[0].length;
  if (ctx.text[m.index - 1] === "-") {
    // "Est-elle arrivé ?", "Sont-ils venu ?": an inverted subject after être.
    if (DEMONSTRATIVE.test(pronoun) || ctx.text[start] === "-") return null;
    const [verb, clitic] = tokensBefore(ctx.text, m.index, 2);
    if (!verb?.hyphen) return null;
    const tokens = tokensAfter(ctx.text, start, 6);
    // "Avait-elle l'air fatigué ?": the attribute comes after "l'air".
    const air = tokens[0]?.w === "l'" && tokens[1]?.w === "air";
    const inverted = [{ ...verb, hyphen: false }, ...(air ? tokens.slice(0, 2) : [])];
    if (linkingEnd(inverted, 0, person) !== inverted.length) return null;
    // "Se sont-elles parlé ?": a reflexive verb agrees with its object.
    if (clitic && CLITIC_PRONOUNS.has(clitic.w)) return null;
    const word = tokens[skipAdverbs(tokens, air ? 2 : 0)];
    return word ? predicateFinding(ctx, word, allowed, verb.start) : null;
  }
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  if (before && !OPENERS.has(before.w)) return null;
  // "celle-ci", "ceux-là".
  if (DEMONSTRATIVE.test(pronoun)) {
    const near = /^-(?:ci|là)(?![\p{L}\p{M}])/u.exec(ctx.text.slice(start));
    if (!near) return null;
    start += near[0].length;
  } else if (ctx.text[start] === "-") return null;
  const tokens = tokensAfter(ctx.text, start, 8);
  const j = tokens[0]?.w === "ne" || tokens[0]?.w === "n'" ? 1 : 0;
  // "Elle sont": a subject and verb that disagree tell nothing.
  const end = linkingEnd(tokens, j, person);
  if (end < 0) {
    const state = stateEnd(tokens, j, person);
    const word = state > 0 ? tokens[skipAdverbs(tokens, state)] : undefined;
    if (word) return predicateFinding(ctx, word, allowed, m.index);
    return reflexiveFinding(ctx, tokens, j, person, allowed, m.index);
  }
  const word = tokens[skipAdverbs(tokens, end)];
  return word ? predicateFinding(ctx, word, allowed, m.index) : null;
}

// Verbs of coming, going and staying with no object, after which an adjective describes the
// subject: "elle arrive essoufflée", "ils partent seuls".
const STATE_VERBS = new Set(
  (
    "arriver partir repartir sortir ressortir revenir rentrer venir retourner mourir naître " +
    "tomber rester demeurer vivre dormir"
  ).split(" "),
);
const STATE_MODALS = new Set(["pouvoir", "devoir", "vouloir", "penser", "aller", "espérer"]);

/** The index past a verb of STATE_VERBS that agrees with `person` at `i`, or past a modal and
 * such an infinitive ("pense arriver"); -1 when there is none. */
function stateEnd(tokens: Token[], i: number, person: number): number {
  const verb = tokens[i];
  if (!verb || verb.hyphen || isVerbHomograph(verb.w)) return -1;
  const readings = verbReadings(verb.w).filter(
    (r) => typeof r.slot === "number" && r.slot & person,
  );
  if (readings.some((r) => STATE_VERBS.has(r.lemma))) return i + 1;
  if (!readings.some((r) => STATE_MODALS.has(r.lemma))) return -1;
  const next = tokens[i + 1];
  const infinitive = next && !next.hyphen && verbReadings(next.w).some((r) => r.slot === "I");
  return infinitive && STATE_VERBS.has(next.w) ? i + 2 : -1;
}

const FIRST_NAME =
  /(?<![\p{L}\p{M}\p{N}_'’-])\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?(?![\p{L}\p{M}\p{N}_'’-])/gu;

/** "Martine est marié", "Antoine n'est pas mariée": a first name of one gender opening its clause,
 * être and an adjective or participle. */
function afterName(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const gender = firstNameGender(m[0]);
  if (!gender) return null;
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  if (before && !OPENERS.has(before.w)) return null;
  let tokens = tokensAfter(ctx.text, m.index + m[0].length, 9);
  // "Martine Dupont": a surname.
  if (tokens[0] && /^\p{Lu}/u.test(ctx.text[tokens[0].start])) tokens = tokens.slice(1);
  const j = tokens[0]?.w === "ne" || tokens[0]?.w === "n'" ? 1 : 0;
  const allowed: Inflection[] = [gender === "m" ? "ms" : "fs"];
  const end = linkingEnd(tokens, j, IL);
  if (end < 0) return reflexiveFinding(ctx, tokens, j, IL, allowed, m.index);
  const word = tokens[skipAdverbs(tokens, end)];
  return word ? predicateFinding(ctx, word, allowed, m.index) : null;
}

const REFLEXIVE = new Set(["se", "s'", "me", "m'", "te", "t'", "nous", "vous"]);
// Verbs whose reflexive pronoun is an indirect object, so their participle stays invariable:
// "ils se sont parlé", "elles se sont plu".
const INDIRECT_REFLEXIVES = new Set(
  (
    "parler téléphoner succéder plaire complaire déplaire sourire rire nuire mentir ressembler " +
    "suffire convenir survivre écrire dire demander promettre permettre donner envoyer offrir " +
    "acheter arroger imaginer figurer jurer répondre adresser rendre"
  ).split(" "),
);

/** "elle s'est trompé", "les débats se sont déroulé": a reflexive verb in a compound tense
 * agrees with its subject, unless the pronoun is an indirect object or an object follows. */
function reflexiveFinding(
  ctx: DetectContext,
  tokens: Token[],
  i: number,
  person: number,
  allowed: Inflection[],
  from: number,
): RawFinding | null {
  if (!REFLEXIVE.has(tokens[i]?.w ?? "")) return null;
  let k = i + 1;
  if (tokens[k]?.w === "en" || tokens[k]?.w === "y") k++;
  const verb = tokens[k];
  if (!verb || verb.hyphen || !verbReadings(verb.w).some((r) => r.lemma === "être")) return null;
  if (!(linkingEnd(tokens, k, person) > 0)) return null;
  const word = tokens[skipAdverbs(tokens, k + 1)];
  if (!word) return null;
  const lemmas = verbReadings(word.w).flatMap((r) => (r.slot === "Q" ? [r.lemma] : []));
  if (!lemmas.length || lemmas.some((lemma) => INDIRECT_REFLEXIVES.has(lemma))) return null;
  // "elles se sont lavé les mains", "ils se sont vu partir": an object or an infinitive follows.
  const next = tokensAfter(ctx.text, word.end, 1)[0];
  if (next && (next.w in DETERMINERS || verbReadings(next.w).some((r) => r.slot === "I")))
    return null;
  return predicateFinding(ctx, word, allowed, from);
}

const AVOIR =
  /(?<![\p{L}\p{M}\p{N}_-])(?:ai|as|a|avons|avez|ont|avais|avait|avions|aviez|avaient|aurai|auras|aura|aurons|aurez|auront|aurais|aurait|aurions|auriez|auraient)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const INVERTED_AVOIR =
  /(?<![\p{L}\p{M}\p{N}_-])(?:ai|as|a|avons|avez|ont|avais|avait|avions|aviez|avaient|aurai|auras|aura|aurons|aurez|auront|aurais|aurait|aurions|auriez|auraient)(?:-t)?-(?:je|tu|il|elle|on|nous|vous|ils|elles)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const CLITIC_PRONOUNS = new Set(
  "me m' te t' se s' le la les l' lui leur nous vous y en".split(" "),
);
const OBJECT_CLITICS = new Set("le la les l' me m' te t' se s' nous vous en".split(" "));
const COORDINATORS = new Set(["et", "ou", "mais", "car", "puis"]);
// Words that put a direct object before the verb: "quelles pommes vous avez mangées".
const FRONTED = new Set(
  "que qu' quel quelle quels quelles combien lequel laquelle lesquels lesquelles".split(" "),
);

// Direct object pronouns before avoir and the inflection they give the participle: "s" and "p"
// keep the typed gender.
const DIRECT_CLITICS: Record<string, Inflection | "s" | "p"> = {
  le: "ms",
  la: "fs",
  "l'": "s",
  les: "p",
  me: "s",
  "m'": "s",
  te: "s",
  "t'": "s",
};
const INDIRECT_CLITICS = new Set(["lui", "leur"]);

/** "nous l'avons mangés", "il les a pris", "nous lui avons donnée un cadeau", "les élèves ont
 * terminés leurs devoirs": an object pronoun before avoir, or an object after the participle. */
function withObject(ctx: DetectContext, before: Token[], word: Token): RawFinding | null {
  let k = 0;
  const clitics: Token[] = [];
  for (; before[k] && (CLITIC_PRONOUNS.has(before[k].w) || ["ne", "n'"].includes(before[k].w)); k++)
    if (CLITIC_PRONOUNS.has(before[k].w)) clitics.push(before[k]);
  let subject = before[k];
  // "Nous l'avons": the last pronoun read is the subject.
  const last = clitics.at(-1);
  if (last && ["nous", "vous"].includes(last.w) && (!subject || OPENERS.has(subject.w))) {
    subject = clitics.pop()!;
  }
  if (!subject) return null;
  // A pronoun, a name or a noun after its determiner ("les élèves", where "élèves" is also a verb).
  // With no object pronoun the participle before an object stays invariable whatever the
  // subject ("les élèves de première ont terminés leurs devoirs").
  const named = /^\p{Lu}\p{Ll}/u.test(ctx.text.slice(subject.start, subject.end));
  const determined = before[k + 1] !== undefined && before[k + 1].w in DETERMINERS;
  const known = subject.w in SUBJECT_INFLECTIONS || named || determined;
  if (!known && clitics.length) return null;
  if (before.slice(k).some((t) => FRONTED.has(t.w))) return null;
  const next = tokensAfter(ctx.text, word.end, 1)[0];
  // "je les ai vus partir", "je l'ai fait venir", "il les a aidés à": an infinitive follows.
  if (
    next &&
    (verbReadings(next.w).some((r) => r.slot === "I") || ["à", "de", "d'"].includes(next.w))
  )
    return null;
  const forms = participleForms(word.w);
  if (!forms) return null;
  const slots = (Object.keys(forms) as Inflection[]).filter((slot) => forms[slot] === word.w);
  let target: Inflection;
  let from: number;
  if (!clitics.length) {
    // An object after the participle: it stays invariable.
    if (!next || !(next.w in DETERMINERS)) return null;
    [target, from] = ["ms", subject.start];
  } else {
    if (clitics.some((t) => ["en", "y", "nous", "vous", "se", "s'"].includes(t.w))) return null;
    const direct = clitics.find((t) => t.w in DIRECT_CLITICS);
    if (!direct) {
      if (!clitics.every((t) => INDIRECT_CLITICS.has(t.w))) return null;
      [target, from] = ["ms", clitics[0].start];
    } else {
      const shape = DIRECT_CLITICS[direct.w];
      // "il m'a vue", "tu m'as vu": me and te tell the number only.
      if (shape === "s" && slots.some((slot) => slot.endsWith("s"))) return null;
      target = (shape.length === 2 ? shape : `${slots[0][0]}${shape}`) as Inflection;
      from = direct.start;
    }
  }
  if (slots.includes(target)) return null;
  const typed = ctx.text.slice(word.start, word.end);
  if (typed !== word.w || ctx.dictionary.has(word.w)) return null;
  return finding(RULE, MESSAGE, word.start, word.end, [forms[target]], {
    context: { start: from, end: word.end },
  });
}

/** "As-tu eus peur ?", "Aviez-vous mangés ?": after an inverted avoir with no object before
 * it, the participle stays masculine singular. */
function invertedAvoir(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 8);
  // "Les as-tu lu ?" -> "lus", "L'as-tu lus ?" -> "lu": a direct object pronoun right before.
  const clitic =
    before[0] && before[0].end === m.index - (ctx.text[m.index - 1] === " " ? 1 : 0)
      ? DIRECT_CLITICS[before[0].w]
      : undefined;
  const rest = clitic ? before.slice(1) : before;
  if (rest.some((t) => FRONTED.has(t.w) || OBJECT_CLITICS.has(t.w))) return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 6);
  const word = after[skipAdverbs(after, 0)];
  if (!word || word.hyphen) return null;
  const forms = participleForms(word.w);
  if (!forms) return null;
  const slots = (Object.keys(forms) as Inflection[]).filter((slot) => forms[slot] === word.w);
  if (!slots.length) return null;
  let target: Inflection = "ms";
  if (clitic) {
    // "me" and "te" tell the number only, and a feminine typed form may be right.
    if (clitic === "s" && slots.some((slot) => slot.endsWith("s"))) return null;
    target = (clitic.length === 2 ? clitic : `${slots[0][0]}${clitic}`) as Inflection;
  }
  if (slots.includes(target)) return null;
  const typed = ctx.text.slice(word.start, word.end);
  if (typed !== word.w || ctx.dictionary.has(word.w)) return null;
  return finding(RULE, MESSAGE, word.start, word.end, [forms[target]], {
    context: { start: m.index, end: word.end },
  });
}

/** A participle's four forms from its verb's masculine singular ("pris", "prise", ...). */
function participleForms(word: string): Record<Inflection, string> | null {
  for (const r of verbReadings(word)) {
    if (r.slot !== "Q") continue;
    const ms = pastParticiple(r.lemma);
    if (!ms || /e$/.test(ms)) continue;
    const forms: Record<Inflection, string> = {
      ms,
      mp: /[sx]$/.test(ms) ? ms : `${ms}s`,
      fs: `${ms}e`,
      fp: `${ms}es`,
    };
    if (Object.values(forms).includes(word)) return forms;
  }
  return null;
}

/** The participle after avoir: invariable with no object before it ("nous avons mangé"), agreeing
 * with a noun that "que" brings before it ("les hommes que j'ai aidés"). */
function afterAvoir(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  if (ctx.text[m.index + m[0].length] === "-") return null;
  const before = tokensBefore(ctx.text, m.index, 8);
  const i = before[0]?.w === "ne" || before[0]?.w === "n'" ? 1 : 0;
  const subject = before[i];
  const after = tokensAfter(ctx.text, m.index + m[0].length, 6);
  const word = after[skipAdverbs(after, 0)];
  if (!word || word.hyphen || !subject || ctx.text[subject.start - 1] === "-") return null;
  const readings = verbReadings(word.w);
  // "donnée", "terminés": a participle that is also a noun or an adjective entry.
  if (!(subject.w in SUBJECT_INFLECTIONS)) {
    if (!readings.length || readings.some((r) => r.slot !== "Q")) return null;
    return withObject(ctx, before, word);
  }
  // "mis", "dit": after avoir a form that is also a simple past is the participle.
  if (!readings.some((r) => r.slot === "Q")) return null;
  // "une voiture qui passait nous a éclaboussés": "nous" and "vous" may be objects.
  const opener = before[i + 1];
  if (
    (subject.w === "nous" || subject.w === "vous") &&
    opener &&
    !OPENERS.has(opener.w) &&
    opener.w !== "et"
  )
    return null;
  if (opener && (opener.w === "que" || opener.w === "qu'")) {
    const noun = before[i + 2];
    // "une petite montre que": an adjective between the determiner and the noun.
    const adjective = adjectiveReadings(before[i + 3]?.w ?? "").length ? 1 : 0;
    const det = before[i + 3 + adjective];
    if (!noun || !det || !(det.w in DETERMINERS)) return null;
    // "une fois que vous avez goûté", "l'impression que tu as compris": a conjunction or a
    // clause that completes the noun, no antecedent.
    if (NOT_NOUNS.has(noun.w) || COMPLETED_NOUNS.has(noun.w)) return null;
    // "les filles que j'ai vues partir", "la maison que j'ai eu la chance de voir": an infinitive
    // or an object after it makes "que" no object of the participle.
    const next = tokensAfter(ctx.text, word.end, 1)[0];
    if (next && (verbReadings(next.w).some((r) => r.slot === "I") || next.w in DETERMINERS))
      return null;
    // "qu'elle a réussi à cacher", "que j'ai voulu t'envoyer": an infinitive follows; "que j'ai
    // fait cela": an object follows.
    if (next && (["à", "de", "d'"].includes(next.w) || CLITIC_PRONOUNS.has(next.w))) return null;
    if (next && ["cela", "ça", "ceci"].includes(next.w)) return null;
    // "c'est pour tes beaux yeux que j'ai fait": a cleft sentence, no antecedent.
    const opening = tokensBefore(ctx.text, det.start, 8).map((t) => t.w);
    if (
      opening.some(
        (w, k) => /^(?:est|était|sera)$/.test(w) && /^(?:c'|ce|n')$/.test(opening[k + 1] ?? ""),
      )
    )
      return null;
    // "mes expériences et la formation que": coordinated antecedents.
    if (["et", "ou"].includes(before[i + 4 + adjective]?.w ?? "")) return null;
    // "la forme de l'arbre que j'ai adoré", "le bruit des vagues que": a complement's noun, or
    // the noun it completes, may be the antecedent.
    const link = before[i + 4 + adjective];
    if (
      link &&
      (["de", "d'"].includes(link.w) || (/^d(?:u|es)$/.test(det.w) && nounToken(ctx, link)))
    )
      return null;
    const target = phraseInflection(det.w, noun.w);
    return target ? adjectiveFinding(ctx, word, target, det.start, "avoir") : null;
  }
  // "les femmes que j'ai aimées" above; with no object before, an adjective entry ("j'ai
  // chaud") is left alone, and so is a noun with its adjective ("ils ont partie liée").
  if (readings.some((r) => r.slot !== "Q")) return null;
  if (adjectiveReadings(word.w).length || !participleBase(word.w, "avoir")) return null;
  const next = tokensAfter(ctx.text, word.end, 1)[0];
  if (isVerbHomograph(word.w) && next && slotsOf(next.w, "être").length) return null;
  // The clause ends at a coordinator: "je suis allée en Bretagne et j'ai mangée".
  const end = before.findIndex((t, k) => k > i && COORDINATORS.has(t.w));
  const clause = before.slice(i + 1, end < 0 ? undefined : end);
  if (clause.some((t) => FRONTED.has(t.w) || OBJECT_CLITICS.has(t.w))) return null;
  if (slotsOf(word.w, "avoir").includes("ms")) return null;
  return adjectiveFinding(ctx, word, "ms", subject.start, "avoir");
}

const CANDIDATE = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?:[lj]['’](?=\\p{L})|(?:celui|celle|ceux|celles)(?=-)|(?:${[
    ...Object.keys(DETERMINERS),
    ...Object.keys(SUBJECTS),
  ]
    .filter((w) => !w.endsWith("'"))
    .join(
      "|",
    )})(?![\\p{L}\\p{M}\\p{N}_'’-]))|(?<=\\p{L}-)(?:je|tu|il|elle|nous|ils|elles)(?![\\p{L}\\p{M}\\p{N}_'’-])`,
  "giu",
);

// A color qualified by a shade or a thing ("bleu clair", "vert d'eau" aside) is invariable:
// "des yeux verts clairs" -> "vert clair". Each base and the inflected forms it may be typed in.
const COLOR_FORMS: Record<string, string> = {};
for (const [base, ...forms] of [
  ["bleu", "bleue", "bleus", "bleues"],
  ["vert", "verte", "verts", "vertes"],
  ["rouge", "rouges"],
  ["jaune", "jaunes"],
  ["gris", "grise", "grises"],
  ["noir", "noire", "noirs", "noires"],
  ["blanc", "blanche", "blancs", "blanches"],
  ["rose", "roses"],
  ["violet", "violette", "violets", "violettes"],
  ["brun", "brune", "bruns", "brunes"],
  ["beige", "beiges"],
  ["mauve", "mauves"],
])
  for (const form of [base, ...forms]) COLOR_FORMS[form] = base;
const SHADE_FORMS: Record<string, string> = {};
for (const [base, ...forms] of [
  ["clair", "claire", "clairs", "claires"],
  ["foncé", "foncée", "foncés", "foncées"],
  ["pâle", "pâles"],
  ["vif", "vive", "vifs", "vives"],
  ["sombre", "sombres"],
  ["canard", "canards"],
  ["océan", "océans"],
  ["améthyste", "améthystes"],
  ["émeraude", "émeraudes"],
  ["turquoise", "turquoises"],
  ["électrique", "électriques"],
  ["fluo", "fluos"],
  ["marine"],
  ["nuit"],
  ["ciel"],
  ["pétrole"],
])
  for (const form of [base, ...forms]) SHADE_FORMS[form] = base;
const COLOR_SHADE = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?:${Object.keys(COLOR_FORMS).join("|")})[ \\t]{1,8}(?:${Object.keys(SHADE_FORMS).join("|")})(?![\\p{L}\\p{M}\\p{N}_'’-])`,
  "gu",
);

/** "des yeux verts clairs", "une jupe bleue foncée": a compound color after its noun. */
function colorShade(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const [color, shade] = m[0].split(/[ \t]+/);
  const fixed = `${COLOR_FORMS[color]} ${SHADE_FORMS[shade]}`;
  if (fixed === `${color} ${shade}`) return null;
  // After a noun only: "les verts clairs" may name the colors themselves.
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  const singular = before?.w.replace(/[sx]$/, "") ?? "";
  const noun = (w: string) => Boolean(nounGender(w) || isInflectedNoun(w));
  if (!before || before.w in DETERMINERS || !(noun(singular) || noun(before.w))) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  return finding(RULE, MESSAGE, m.index, m.index + m[0].length, [fixed]);
}

const PAIR_STOPS = new Set(
  "quelques plusieurs certains certaines divers diverses différents différentes".split(" "),
);
const PAIR = /(?<![\p{L}\p{M}\p{N}_'’-])\p{Ll}+(?=[ \t]{1,8}(?:et|ou)[ \t]{1,8}\p{Ll})/gu;

/** "un effet direct et indirects", "une entrée indépendante et séparé": two adjectives joined by
 * "et" or "ou" after their noun (or after être) share its gender and number. */
function adjectivePair(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const [first, conjunction, second, after] = tokensAfter(ctx.text, m.index, 4);
  if (!first || !second || first.w !== m[0] || first.hyphen || second.hyphen) return null;
  if (ctx.text.slice(second.start, second.end) !== second.w) return null;
  const skip = (w: string) => NOT_ADJECTIVES.has(w) || COMPOUND_SECOND.has(w) || w.length < 3;
  if (skip(first.w) || skip(second.w)) return null;
  const slots1 = pairSlots(first.w);
  const slots2 = pairSlots(second.w);
  if (!slots1.length || !slots2.length || slots1.some((s) => slots2.includes(s))) return null;
  // "et organisé un feu": a participle with its object; "de bonne et belle facture": before
  // its noun; "très beau et très confortables": the second may take its own adverb.
  if (after && (after.w in DETERMINERS || CLITIC_PRONOUNS.has(after.w) || nounGender(after.w)))
    return null;
  // "colorants non toxiques": a noun with its own adjective. "et dure jusqu'en mars": a verb.
  // "et pris de panique", "et adaptés aux projets": a participle with its complement may
  // describe another noun.
  const readings2 = verbReadings(second.w);
  if (readings2.some((r) => typeof r.slot === "number") || PAIR_STOPS.has(second.w)) return null;
  if (after && (after.w === "non" || pairSlots(after.w).length)) return null;
  // "l'effervescence romaine et ruiné, il retourne": a participle after a plain adjective may
  // describe the clause's subject.
  const participle = (w: string) => verbReadings(w).some((r) => r.slot === "Q");
  if (participle(second.w) && (after || !participle(first.w))) return null;
  // What the pair describes: a determined noun ("l'effet"), a noun opening the clause
  // ("Appartement grand et pratiques") or the subject of être ("était très beau et").
  const before = tokensBefore(ctx.text, m.index, 4);
  let k = 0;
  while (before[k] && ADVERBS.has(before[k].w)) k++;
  const head = before[k];
  let target: Inflection | null = null;
  if (head && LINKING.has(head.w)) target = null;
  else if (k === 0 && head && nounGender(head.w.replace(/[sx]$/, ""))) {
    const det = before[1];
    if (det && det.w in DETERMINERS) target = phraseInflection(det.w, head.w);
    else if (det) return null;
  } else return null;
  const forms = target
    ? [[agreeOr(first.w, target), agreeOr(second.w, target)]]
    : [
        [first.w, agreeOr(second.w, slots1[0])],
        [agreeOr(first.w, slots2[0]), second.w],
      ];
  const typed = ctx.text.slice(first.start, second.end);
  const join = ctx.text.slice(first.end, second.start);
  const alternatives = [
    ...new Set(forms.filter(([a, b]) => a && b).map(([a, b]) => `${a}${join}${b}`)),
  ].filter((alt) => alt !== typed);
  if (!alternatives.length || ctx.dictionary.has(first.w) || ctx.dictionary.has(second.w))
    return null;
  if (!["et", "ou"].includes(conjunction.w)) return null;
  return finding(RULE, MESSAGE, first.start, second.end, alternatives, {
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  });
}

/** The inflections of an adjective, an epicene one in -e telling its number only ("simple",
 * "pratiques"). */
function pairSlots(word: string): Inflection[] {
  const slots = slotsOf(word);
  if (
    slots.length ||
    verbReadings(word).some((r) => typeof r.slot === "number" && !/e$/.test(word))
  )
    return slots;
  if (/[^e]e$/.test(word) && isInflectedNoun(word)) return ["ms", "fs"];
  if (/[^e]es$/.test(word) && isInflectedNoun(word.slice(0, -1))) return ["mp", "fp"];
  return [];
}

/** A word's form for an inflection, or the word when it has it already; "" when it has none. */
function agreeOr(word: string, target: Inflection): string {
  const slots = pairSlots(word);
  if (slots.includes(target)) return word;
  if (!slotsOf(word).length) return target.endsWith("p") ? `${word}s` : word.replace(/s$/, "");
  return agreeing(word, target) ?? "";
}

// "et" before a form of être whose subject is left out: "elle s'admire et est fière".
const ELLIPTIC = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])et[ \\t]+(?=(?:${[...LINKING].join("|")})(?![\\p{L}\\p{M}\\p{N}_'’-]))`,
  "giu",
);
const THIRD_PERSONS = new Set(["il", "elle", "ils", "elles"]);

/** "Elle s'admire et est impressionné", "La bouteille arriva et fut englouti": the attribute after
 * "et" + être agrees with the subject that opens the sentence. */
function ellipticSubject(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const clause = tokensBefore(ctx.text, m.index, 12);
  const first = clause.at(-1);
  if (!first || clause.length < 2) return null;
  // The subject opens the sentence, and no subordinate clause or other "et" comes before.
  if (!/(?:^|[.!?]\s*|\n\s*)$/u.test(ctx.text.slice(Math.max(0, first.start - 4), first.start)))
    return null;
  if (clause.some((t) => OPENERS.has(t.w) || ["qui", "et", "ou"].includes(t.w))) return null;
  let allowed: Inflection[] | null = null;
  if (THIRD_PERSONS.has(first.w)) allowed = SUBJECT_INFLECTIONS[first.w];
  else if (first.w in DETERMINERS && /^\p{Ll}/u.test(ctx.text[first.start + 1] ?? "")) {
    const noun = clause.at(-2)!;
    if (!(isInflectedNoun(noun.w) || adjectiveReadings(noun.w).length) || NOT_NOUNS.has(noun.w))
      return null;
    const target = phraseInflection(first.w, noun.w);
    allowed = target ? [target] : null;
  }
  if (!allowed) return null;
  const tokens = tokensAfter(ctx.text, m.index, 6);
  const linkAt = linkingEnd(tokens, 1, allowed[0].endsWith("p") ? ILS : IL);
  if (linkAt < 0) return null;
  const word = tokens[skipAdverbs(tokens, linkAt)];
  return word ? predicateFinding(ctx, word, allowed, first.start) : null;
}

const TEL_FORMS: Record<string, string> = { ms: "tel", fs: "telle", mp: "tels", fp: "telles" };
const TEL = /(?<![\p{L}\p{M}\p{N}_'’-])tel(?:le)?s?(?![\p{L}\p{M}\p{N}_'’-])/giu;
const TEL_LINKS = new Set("est sont était étaient fut furent sera seront".split(" "));
const SUBJECT_WORDS = new Set("je j' tu il elle on nous vous ils elles ce c' cela ça".split(" "));

/** The gender and number of a determiner and its noun, or null when either is unknown. */
function nounPhraseSlot(determiner: Token | undefined, noun: Token | undefined): string | null {
  if (!determiner || !noun || !(determiner.w in DETERMINERS)) return null;
  const [gender, number] = DETERMINERS[determiner.w];
  const singular =
    number === "p" && !isNounLemma(noun.w) ? pluralSingulars(noun.w).find(isNounLemma) : noun.w;
  const nounSlot = singular && isNounLemma(singular) ? nounGender(singular) : null;
  if (gender && nounSlot && gender !== nounSlot) return null;
  const g = gender ?? nounSlot;
  return g ? `${g}${number}` : null;
}

/** "des filles tel que Marie" -> "telles", "Tel est la question" -> "Telle", "tel une
 * femme" -> "telle": "tel" takes the gender and number of the noun it compares or announces. */
function telAgreement(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const end = m.index + typed.length;
  const after = tokensAfter(ctx.text, end, 3);
  const before = tokensBefore(ctx.text, m.index, 3);
  let slot: string | null = null;
  let context = { start: m.index, end };
  if (after[0] && (after[0].w === "que" || after[0].w === "qu'")) {
    // "des filles tel que Marie": the noun right before. "les noms des villes tels que" may
    // describe the first noun: a "des" after another noun is left alone.
    const complement =
      (before[1]?.w === "des" && !!before[2] && !verbReadings(before[2].w).length) ||
      ["de", "d'", "du", "des", "à", "au", "aux"].includes(before[2]?.w ?? "");
    // "jouer de la guitare tel que tu le fais", "telle qu'elle est": before a clause, "tel" may
    // compare the action or a noun further back.
    const clause = SUBJECT_WORDS.has(after[1]?.w ?? "");
    if (!complement && !clause) slot = nounPhraseSlot(before[1], before[0]);
    if (slot) context = { start: before[1].start, end: after[0].end };
  } else if (!before.length) {
    // "Tel est la question", "tel une femme": the noun after, at a clause start.
    const k = after[0] && TEL_LINKS.has(after[0].w) ? 1 : 0;
    slot = nounPhraseSlot(after[k], after[k + 1]);
    if (slot) context = { start: m.index, end: after[k + 1].end };
  }
  if (!slot || namedExampleBefore(ctx.text, m.index)) return null;
  const form = TEL_FORMS[slot];
  if (form === typed.toLowerCase()) return null;
  return finding(RULE, MESSAGE, m.index, end, [carryCase(typed, form)], { context });
}

// "lequel" and its forms with "à" and "de", by the gender and number of the antecedent.
const LEQUEL: Record<string, Record<string, string>> = {
  "": { ms: "lequel", fs: "laquelle", mp: "lesquels", fp: "lesquelles" },
  à: { ms: "auquel", fs: "à laquelle", mp: "auxquels", fp: "auxquelles" },
  de: { ms: "duquel", fs: "de laquelle", mp: "desquels", fp: "desquelles" },
};
const LEQUEL_FAMILY: Record<string, string> = {
  lequel: "",
  laquelle: "",
  lesquels: "",
  lesquelles: "",
  auquel: "à",
  auxquels: "à",
  auxquelles: "à",
  duquel: "de",
  desquels: "de",
  desquelles: "de",
};
const RELATIVE_LEQUEL =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:lequel|laquelle|lesquels|lesquelles|auquel|auxquels|auxquelles|duquel|desquels|desquelles)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const RELATIVE_PREPOSITIONS = new Set(
  "avec pour sur dans par sans chez contre entre parmi sous vers selon malgré devant derrière à".split(
    " ",
  ),
);

/** "l'homme avec laquelle tu parles" -> "lequel", "la femme auquel" -> "à laquelle": the relative
 * pronoun takes the gender and number of the noun right before it. */
function relativeAgreement(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const lower = typed.toLowerCase();
  const before = tokensBefore(ctx.text, m.index, 4);
  const family = LEQUEL_FAMILY[lower];
  const k = family === "" && RELATIVE_PREPOSITIONS.has(before[0]?.w ?? "") ? 1 : 0;
  // "la femme à lequel": the preposition stays, the pronoun agrees.
  const [noun, determiner, outer] = before.slice(k);
  // "le fils de la voisine avec laquelle": the antecedent may be either noun.
  if (!determiner || ["du", "des"].includes(determiner.w) || ["de", "d'"].includes(outer?.w ?? ""))
    return null;
  const slot = nounPhraseSlot(determiner, noun);
  const next = tokensAfter(ctx.text, m.index + typed.length, 1)[0];
  if (!slot || !next || namedExampleBefore(ctx.text, m.index)) return null;
  const form = LEQUEL[family][slot];
  if (form === lower) return null;
  return finding(RULE, MESSAGE, m.index, m.index + typed.length, [carryCase(typed, form)], {
    context: { start: determiner.start, end: m.index + typed.length },
  });
}

function adjectives(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, RELATIVE_LEQUEL)) {
    const f = relativeAgreement(ctx, m);
    if (f) findings.push(f);
  }
  for (const m of ownedFrenchWords(ctx, TEL)) {
    const f = telAgreement(ctx, m);
    if (f) findings.push(f);
  }
  for (const m of ownedFrenchWords(ctx, COLOR_SHADE)) {
    const f = colorShade(ctx, m);
    if (f) findings.push(f);
  }
  for (const m of ownedFrenchWords(ctx, PAIR)) {
    const f = adjectivePair(ctx, m);
    if (f) findings.push(f);
  }
  for (const m of ownedFrenchWords(ctx, CANDIDATE)) {
    if (namedExampleBefore(ctx.text, m.index)) continue;
    const word = m[0].toLowerCase().replaceAll("’", "'");
    const f =
      word in SUBJECTS
        ? afterPronoun(ctx, m, word)
        : (afterNoun(ctx, m, word) ?? longSubject(ctx, m, word));
    if (f) findings.push(f);
  }
  for (const m of ownedFrenchWords(ctx, ELLIPTIC)) {
    const f = ellipticSubject(ctx, m);
    if (f) findings.push(f);
  }
  for (const m of ownedFrenchWords(ctx, FIRST_NAME)) {
    if (namedExampleBefore(ctx.text, m.index)) continue;
    const f = afterName(ctx, m);
    if (f) findings.push(f);
  }
  for (const m of ownedFrenchWords(ctx, AVOIR)) {
    const f = afterAvoir(ctx, m);
    if (f) findings.push(f);
  }
  for (const m of ownedFrenchWords(ctx, INVERTED_AVOIR)) {
    const f = invertedAvoir(ctx, m);
    if (f) findings.push(f);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: adjectives }];
