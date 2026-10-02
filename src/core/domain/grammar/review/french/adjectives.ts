import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  genderable,
  IL,
  ILS,
  inflect,
  isInflectedNoun,
  type Inflection,
  isVerbHomograph,
  JE,
  nounGender,
  NOUS,
  pastParticiple,
  TU,
  verbReadings,
} from "./frenchLexicon";
import { ownedFrenchWords, type Token, tokensAfter, tokensBefore, withCase } from "./frenchTokens";

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
    "particulièrement extrêmement totalement complètement entièrement désormais"
  ).split(" "),
);
const PREPOSITIONS = new Set(
  "pour sur dans avec sans sous chez vers entre selon malgré pendant depuis contre".split(" "),
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
// Nouns that open adverbial or quantity phrases ("un peu", "la plupart", "l'air").
const NOT_NOUNS = new Set(
  "peu plupart air autre tout rien reste moins plus point fait cas soit".split(" "),
);

/** The masculine singular of a past participle no noun or adjective entry spells: "trié" for
 * "triées", "pris" for "prise". */
function participleBase(word: string): string | null {
  if (isVerbHomograph(word) || word === "dû") return null;
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
function agreeing(word: string, target: Inflection): string | null {
  const readings = adjectiveReadings(word);
  if (readings.length) {
    if (readings.some((r) => r.slot === target || !genderable(r.lemma))) return null;
    if (readings.some((r) => NOT_ADJECTIVES.has(r.lemma) || /(?:eur|rice|euse)$/.test(r.lemma)))
      return null;
    // "avares", "torse": an epicene adjective or a noun spelled like a gendered form.
    const singular = word.replace(/s$/, "");
    if (readings.every((r) => r.lemma !== singular) && isInflectedNoun(singular)) return null;
    return inflect(readings[0], target)[0] ?? null;
  }
  const base = participleBase(word);
  if (!base) return null;
  const forms: Record<Inflection, string> = {
    ms: base,
    mp: /[sx]$/.test(base) ? base : `${base}s`,
    fs: `${base}e`,
    fp: `${base}es`,
  };
  const slots = (Object.keys(forms) as Inflection[]).filter((slot) => forms[slot] === word);
  return slots.length && !slots.includes(target) ? forms[target] : null;
}

function finding(ctx: DetectContext, word: Token, target: Inflection, from: number) {
  const typed = ctx.text.slice(word.start, word.end);
  if (typed !== word.w || word.hyphen || ctx.dictionary.has(word.w)) return null;
  // "bien sûr": the adverb.
  if (word.w === "sûr" && tokensBefore(ctx.text, word.start, 1)[0]?.w === "bien") return null;
  const after = tokensAfter(ctx.text, word.end, 1)[0];
  if (after && COMPOUND_SECOND.has(after.w)) return null;
  // "rouge et blanc", "noir, blanc": coordinated adjectives may share out a plural noun;
  // "petites fleurs": an adjective before its own noun.
  if (/^[\s\u00a0]*,/u.test(ctx.text.slice(word.end))) return null;
  if (after && (["et", "ou"].includes(after.w) || nounGender(after.w))) return null;
  const form = agreeing(word.w, target);
  if (!form) return null;
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start: word.start, end: word.end },
    alternatives: [withCase(typed, form)],
    context: { start: from, end: word.end },
  } satisfies RawFinding;
}

/** A noun phrase's gender and number from its determiner and noun; null when unknown or when
 * they disagree (another check's finding). */
function phraseInflection(det: string, noun: string): Inflection | null {
  const [detGender, number] = DETERMINERS[det];
  const plural = /[sx]$/.test(noun);
  if (number === "p" && !plural) return null;
  const singular = number === "p" ? noun.replace(/aux$/, "al").replace(/[sx]$/, "") : noun;
  // "un somme" (nap) or "une somme": a noun of either gender tells nothing.
  if (!genderable(singular) || !genderable(noun)) return null;
  // "les cours", "les temps": an entry in s is its own plural, and its gender is its own.
  if (plural && isInflectedNoun(noun) && !nounGender(noun)) return null;
  const gender = (plural && nounGender(noun)) || nounGender(singular);
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
function slotsOf(word: string): Inflection[] {
  const readings = adjectiveReadings(word);
  if (readings.length) return readings.map((r) => r.slot);
  const base = participleBase(word);
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
    if (w && (ADVERBS.has(w) || (/..ment$/.test(w) && !isInflectedNoun(w)))) i++;
    // "peut-être", "par conséquent", "bien entendu", "pour autant".
    else if (w === "peut" && tokens[i].hyphen && tokens[i + 1]?.w === "être") i += 2;
    else if (w && ADVERB_PAIRS.has(`${w} ${tokens[i + 1]?.w}`)) i += 2;
    else if (tokens[i]?.w === "un" && tokens[i + 1]?.w === "peu") i += 2;
    else if (tokens[i]?.w === "un" && tokens[i + 1]?.w === "petit" && tokens[i + 2]?.w === "peu")
      i += 3;
    else return i;
  }
}

/** "une forêt tropical", "la réunion est annulé". */
function afterNoun(ctx: DetectContext, m: RegExpExecArray, det: string): RawFinding | null {
  const tokens = tokensAfter(ctx.text, m.index, 7);
  const noun = tokens[1];
  if (!noun || tokens[0].w !== det || noun.hyphen) return null;
  if (ctx.text.slice(noun.start, noun.end) !== noun.w || noun.w.length < 3) return null;
  if (NOT_NOUNS.has(noun.w) || noun.w.endsWith("ment")) return null;
  if (!isVerbHomograph(noun.w) && verbReadings(noun.w).some((r) => typeof r.slot === "number"))
    return null;
  const [detGender, detNumber] = DETERMINERS[det];
  // "un grand chien", "la porte": the noun slot holds an adjective or a verb. Before être it is
  // the noun ("le plan est"), with the determiner's gender.
  const adjectival = adjectiveReadings(noun.w).length > 0;
  const linkAt = linkingEnd(tokens, 2, detNumber === "p" ? ILS : IL);
  if (adjectival && (linkAt < 0 || !detGender || detNumber === "p")) return null;
  const target = adjectival ? (`${detGender}s` as Inflection) : phraseInflection(det, noun.w);
  if (!target) return null;
  // "toute la matinée": the word before the predeterminer.
  const previous = tokensBefore(ctx.text, m.index, 2);
  const predeterminer = ["tout", "toute", "tous", "toutes"].includes(previous[0]?.w ?? "");
  const before = predeterminer ? previous[1] : previous[0];
  const anchor = predeterminer ? previous[0].start : m.index;
  // "et un pull noirs", "de la porte du garage ouverte": the adjective may go with another noun.
  // Before a verb that agrees with the noun phrase alone, a comma only ends an opening phrase.
  const coordinated =
    (linkAt < 0 && /[,;]\s*$/.test(ctx.text.slice(Math.max(0, anchor - 3), anchor))) ||
    ["et", "ou", "ni"].includes(before?.w ?? "");
  if (coordinated) return null;
  if (linkAt > 0) {
    // The noun phrase opens its clause and is the subject of être.
    if (before && !OPENERS.has(before.w)) return null;
    const word = tokens[skipAdverbs(tokens, linkAt)];
    return word ? predicateFinding(ctx, word, [target], m.index) : null;
  }
  // "des" may be "de" + "les" ("le bruit des moteurs puissant"): only a subject of être.
  if (det === "des") return null;
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
    // "La loi contraint", "une main tenant un flambeau": a verb, not an adjective.
    if (verbReadings(next.w).some((r) => typeof r.slot === "number" || r.slot === "G")) return null;
    // "a dans les faits duré", "section étranger / non étranger": a participle of a compound
    // tense, a list of labels.
    const clause = tokensBefore(ctx.text, m.index, 6);
    const avoir = clause.some((t) => verbReadings(t.w).some((r) => r.lemma === "avoir"));
    if (avoir && !adjectiveReadings(next.w).length) return null;
    if (/^[\s\u00a0]*\//u.test(ctx.text.slice(next.end))) return null;
    return finding(ctx, next, target, m.index);
  }
  return null;
}

// Adjective entries that are prepositions before a determiner: "pendant des années".
const PREPOSITION_LIKE = new Set(
  "pendant durant suivant concernant touchant moyennant excepté passé vu".split(" "),
);
const LINKING_LEMMAS = new Set(["être", "sembler", "paraître", "devenir", "rester", "demeurer"]);

/** The index just past a linking verb at `i` that agrees with `person` ("est", "semblaient") or
 * past avoir + "été" ("ont été", "avait déjà été"); -1 when there is none. */
function linkingEnd(tokens: Token[], i: number, person: number): number {
  const verb = tokens[i];
  // "est-il": an inversion.
  if (!verb || verb.hyphen) return -1;
  const readings = verbReadings(verb.w).filter(
    (r) => typeof r.slot === "number" && r.slot & person,
  );
  if (readings.some((r) => LINKING_LEMMAS.has(r.lemma))) return i + 1;
  if (!readings.some((r) => r.lemma === "avoir")) return -1;
  const k = skipAdverbs(tokens, i + 1);
  return tokens[k]?.w === "été" && !tokens[k].hyphen ? k + 1 : -1;
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
  if (after && (adjectiveReadings(after.w).length || participleBase(after.w))) return null;
  if (after && PREPOSITION_LIKE.has(word.w) && after.w in DETERMINERS) return null;
  const slots = slotsOf(word.w);
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
    return {
      ruleId: RULE,
      messageKey: MESSAGE,
      range: { start: word.start, end: word.end },
      alternatives: [singular],
      context: { start: from, end: word.end },
    };
  }
  if (slots.some((slot) => allowed.includes(slot))) return null;
  const target =
    allowed.find((slot) => slots.some((s) => s[0] === slot[0])) ??
    allowed.find((slot) => slots.some((s) => s[1] === slot[1])) ??
    allowed[0];
  return finding(ctx, word, target, from);
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
};

/** "ils sont françaises", "elle est grand", "nous avons été dénoncé": a pronoun subject, être
 * and an adjective or participle. */
function afterPronoun(ctx: DetectContext, m: RegExpExecArray, pronoun: string): RawFinding | null {
  const [allowed, person] = SUBJECTS[pronoun];
  let start = m.index + m[0].length;
  if (ctx.text[m.index - 1] === "-") {
    // "Est-elle arrivé ?", "Sont-ils venu ?": an inverted subject after être.
    if (pronoun.startsWith("ce") || ctx.text[start] === "-") return null;
    const [verb, clitic] = tokensBefore(ctx.text, m.index, 2);
    if (!verb?.hyphen || linkingEnd([{ ...verb, hyphen: false }], 0, person) !== 1) return null;
    // "Se sont-elles parlé ?": a reflexive verb agrees with its object.
    if (clitic && CLITIC_PRONOUNS.has(clitic.w)) return null;
    const tokens = tokensAfter(ctx.text, start, 4);
    const word = tokens[skipAdverbs(tokens, 0)];
    return word ? predicateFinding(ctx, word, allowed, verb.start) : null;
  }
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  if (before && !OPENERS.has(before.w)) return null;
  // "celle-ci", "ceux-là".
  if (pronoun.startsWith("ce")) {
    const near = /^-(?:ci|là)(?![\p{L}\p{M}])/u.exec(ctx.text.slice(start));
    if (!near) return null;
    start += near[0].length;
  } else if (ctx.text[start] === "-") return null;
  const tokens = tokensAfter(ctx.text, start, 8);
  const j = tokens[0]?.w === "ne" || tokens[0]?.w === "n'" ? 1 : 0;
  // "Elle sont": a subject and verb that disagree tell nothing.
  const end = linkingEnd(tokens, j, person);
  if (end < 0) return null;
  const word = tokens[skipAdverbs(tokens, end)];
  return word ? predicateFinding(ctx, word, allowed, m.index) : null;
}

const AVOIR =
  /(?<![\p{L}\p{M}\p{N}_-])(?:ai|as|a|avons|avez|ont|avais|avait|avions|aviez|avaient|aurai|auras|aura|aurons|aurez|auront|aurais|aurait|aurions|auriez|auraient)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const CLITIC_PRONOUNS = new Set(
  "me m' te t' se s' le la les l' lui leur nous vous y en".split(" "),
);
const OBJECT_CLITICS = new Set("le la les l' me m' te t' se s' nous vous en".split(" "));
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
  const named = /^\p{Lu}\p{Ll}/u.test(ctx.text.slice(subject.start, subject.end));
  const determined = before[k + 1] !== undefined && before[k + 1].w in DETERMINERS;
  if (!(subject.w in SUBJECT_INFLECTIONS) && !named && !determined) return null;
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
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start: word.start, end: word.end },
    alternatives: [forms[target]],
    context: { start: from, end: word.end },
  };
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
  if (adjectiveReadings(word.w).length) return null;
  const base = participleBase(word.w);
  if (!base || readings.some((r) => r.slot !== "Q")) return null;
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
    const det = before[i + 3];
    if (!noun || !det || !(det.w in DETERMINERS)) return null;
    // "les filles que j'ai vues partir", "la maison que j'ai eu la chance de voir": an infinitive
    // or an object after it makes "que" no object of the participle.
    const next = tokensAfter(ctx.text, word.end, 1)[0];
    if (next && (verbReadings(next.w).some((r) => r.slot === "I") || next.w in DETERMINERS))
      return null;
    // "qu'elle a réussi à cacher", "que j'ai voulu t'envoyer": an infinitive follows.
    if (next && (["à", "de", "d'"].includes(next.w) || CLITIC_PRONOUNS.has(next.w))) return null;
    // "mes expériences et la formation que": coordinated antecedents.
    if (["et", "ou"].includes(before[i + 4]?.w ?? "")) return null;
    const target = phraseInflection(det.w, noun.w);
    return target ? finding(ctx, word, target, det.start) : null;
  }
  if (before.slice(i + 1).some((t) => FRONTED.has(t.w) || OBJECT_CLITICS.has(t.w))) return null;
  if (slotsOf(word.w).includes("ms")) return null;
  return finding(ctx, word, "ms", subject.start);
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

function adjectives(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, CANDIDATE)) {
    if (namedExampleBefore(ctx.text, m.index)) continue;
    const word = m[0].toLowerCase().replace("’", "'");
    const f = word in SUBJECTS ? afterPronoun(ctx, m, word) : afterNoun(ctx, m, word);
    if (f) findings.push(f);
  }
  for (const m of ownedFrenchWords(ctx, AVOIR)) {
    const f = afterAvoir(ctx, m);
    if (f) findings.push(f);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: adjectives }];
