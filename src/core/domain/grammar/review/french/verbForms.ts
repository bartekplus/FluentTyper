import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  conjugate,
  IL,
  ILS,
  isInflectedNoun,
  isNounLemma,
  isVerbHomograph,
  JE,
  nounGender,
  NOUS,
  pastParticiple,
  TU,
  verbReadings,
  VOUS,
  type VerbReading,
} from "./frenchLexicon";
import {
  capitalizedName,
  CLITICS,
  ownedFrenchWords,
  SUBJECT_PRONOUNS,
  tokensAfter,
  tokensBefore,
  wordFinding,
  type Token,
} from "./frenchTokens";
import { isLang } from "../phraseTemplates";

// The -é / -er / -ez endings of first-group verbs sound alike. Their slot decides: a past
// participle after avoir or être ("il a mangé"), an infinitive after a preposition or a verb that
// governs one ("pour manger", "je veux manger"), "-ez" with a "vous" subject ("vous mangez").

const RULE = "frenchVerbForms";

/** Adverbs that may stand between an auxiliary or a governing verb and the next verb. */
const ADVERBS = new Set(
  (
    "pas plus jamais rien bien mal déjà encore toujours souvent beaucoup trop vraiment tout " +
    "enfin aussi même peu presque longtemps également ainsi juste seulement sûrement " +
    "certainement probablement finalement simplement absolument point guère vite mieux " +
    "notamment parfois rarement soudain aussitôt bientôt"
  ).split(" "),
);
const NEGATION = new Set(["ne", "n'"]);
const REFLEXIVES = new Set(["me", "m'", "te", "t'", "se", "s'", "nous", "vous", "lui", "leur"]);
const OBJECTS = new Set(["le", "la", "les", "l'"]);

/** Verbs governing a bare infinitive. */
const GOVERNING = new Set([
  "pouvoir",
  "devoir",
  "aller",
  "falloir",
  "oser",
  "daigner",
  "compter",
  "valoir",
]);
/** Governing verbs that also take an attribute participle after an object pronoun ("je le veux
 * terminé", "je l'ai laissé fermé", "il se sait traqué"): there they abstain. */
const GOVERNING_WITH_ATTRIBUTE = new Set([
  "vouloir",
  "savoir",
  "aimer",
  "adorer",
  "préférer",
  "détester",
  "espérer",
  "souhaiter",
  "désirer",
  "faire",
  "laisser",
  "entendre",
  "sentir",
  "voir",
  "regarder",
  "écouter",
]);
/** "se faire aider", "se laisser tenter": a reflexive pronoun still governs an infinitive. */
const REFLEXIVE_GOVERNORS = new Set(["faire", "laisser"]);

const PERSONS: Record<string, number> = {
  je: JE,
  "j'": JE,
  tu: TU,
  il: IL,
  elle: IL,
  on: IL,
  nous: NOUS,
  vous: VOUS,
  ils: ILS,
  elles: ILS,
};

const lemmaReadings = (word: string, lemma: string) =>
  verbReadings(word).filter((r) => r.lemma === lemma);
const isFinite = (r: VerbReading) => typeof r.slot === "number";
const isAvoir = (word: string) => lemmaReadings(word, "avoir").some(isFinite);
const isEtre = (word: string) => lemmaReadings(word, "être").some(isFinite);
const finiteMask = (word: string, lemma: string) =>
  lemmaReadings(word, lemma).reduce((mask, r) => mask | (isFinite(r) ? (r.slot as number) : 0), 0);

/** The first-group infinitive a word spells ("manger"), from its -er, -é or -ez form. */
function firstGroupLemma(word: string, slot: "I" | "Q" | typeof VOUS): string | null {
  for (const r of verbReadings(word)) {
    if (r.slot !== slot || !r.lemma.endsWith("er") || r.lemma === "aller") continue;
    if (slot === "Q" && word !== `${r.lemma.slice(0, -2)}é`) continue;
    if (slot === "I" && word !== r.lemma) continue;
    if (slot === VOUS && word !== `${r.lemma.slice(0, -2)}ez`) continue;
    return r.lemma;
  }
  return null;
}

/** Skips words of the given sets from index `i`; returns the next index. */
function skip(tokens: Token[], i: number, words: ReadonlySet<string>[]): number {
  while (i < tokens.length && words.some((set) => set.has(tokens[i].w))) i++;
  return i;
}

/**
 * The subject before the verb chain ending at index `i`: negation and object pronouns are
 * skipped, and "nous"/"vous" at the start of the chain is the subject ("nous vous parlons").
 */
function subjectAt(tokens: Token[], i: number): Token | undefined {
  const j = skip(tokens, i, [NEGATION, CLITICS]);
  const head = tokens[j];
  if (head && SUBJECT_PRONOUNS.has(head.w)) return head;
  const first = tokens[j - 1];
  if (j > i && first && (first.w === "nous" || first.w === "vous")) return first;
  return head;
}

/** Participle endings for an être subject, by its gender and number when the pronoun shows it. */
function etreEndings(subject: string | undefined): string[] {
  switch (subject) {
    case "il":
    case "on":
      return ["é"];
    case "elle":
      return ["ée"];
    case "ils":
      return ["és"];
    case "elles":
      return ["ées"];
    case "je":
    case "j'":
    case "tu":
      return ["é", "ée"];
    case "nous":
      return ["és", "ées"];
    default:
      return ["é", "ée", "és", "ées"];
  }
}

/** "il a manger", "elle est arriver", "avez-vous signez": a participle after avoir or être. */
const DEGREE = new Set("très bien trop si assez vraiment plutôt tellement".split(" "));
// Words that may follow "c'est" + a participle in its clause: "c'est arrivé hier".
const AFTER_CEST_PARTICIPLE = new Set(
  "hier comment aujourd'hui ici là quand où pourquoi récemment ce cette".split(" "),
);

// Adverbial phrases between an auxiliary and its participle, nearest word first.
const ADVERBIAL_PHRASES = [
  ["même", "quand"],
  ["toutes", "pour", "fois", "une"],
  ["suite", "de", "tout"],
  ["moins", "au"],
  ["coup", "du"],
  ["fait", "à", "tout"],
  ["peu", "à", "peu"],
];

function participleAfterAuxiliary(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0].toLowerCase();
  const lemma = word.endsWith("ez") ? firstGroupLemma(word, VOUS) : firstGroupLemma(word, "I");
  if (!lemma) return null;
  const tokens = tokensBefore(ctx.text, m.index);
  // "il a quand même aider", "il a une fois pour toutes abandonner": an adverbial phrase.
  const phrase = ADVERBIAL_PHRASES.find((p) => p.every((w, k) => tokens[k]?.w === w));
  let i = skip(tokens, phrase?.length ?? 0, [ADVERBS, DEGREE]);
  // "il pense être arriver": the infinitive "être" as the auxiliary of a third person.
  if (tokens[i]?.w === "être" && word.endsWith("er") && !isVerbHomograph(word)) {
    const stem = firstGroupLemma(word, "I")?.slice(0, -2);
    if (stem && !tokens[i + 1]?.hyphen)
      return wordFinding(ctx, m.index, m[0], [`${stem}é`], RULE, "review_msg_fr_past_participle", {
        start: tokens[i].start,
        end: m.index + m[0].length,
      });
  }
  // Inversion: "avez-vous (déjà) signé", "a-t-il".
  let inverted: string | undefined;
  if (
    tokens[i] &&
    (SUBJECT_PRONOUNS.has(tokens[i].w) || tokens[i].w === "ce") &&
    tokens[i + 1]?.hyphen
  ) {
    inverted = tokens[i].w;
    i++;
  }
  const aux = tokens[i];
  if (!aux) return null;
  const avoir = isAvoir(aux.w);
  const etre = !avoir && isEtre(aux.w);
  if (!avoir && !etre) return null;
  const before = skip(tokens, i + 1, [NEGATION, CLITICS]);
  let subject = inverted ?? subjectAt(tokens, i + 1)?.w;
  // "il y a dîner ce soir": "il y a" introduces a noun.
  if (tokens.slice(i + 1, before).some((t) => t.w === "y")) return null;
  if (avoir) {
    // "a" and "as" are also a slip for "à" ("une machine a laver") and a noun ("un as").
    if (
      (aux.w === "a" || aux.w === "as") &&
      !inverted &&
      !["il", "elle", "on", "qui", "ça", "cela", "tu"].includes(subject ?? "")
    )
      return null;
  } else if (subject === "c'" || subject === "ce") {
    // "c'est compliquer", "comment est-ce arriver ?": with no infinitive as its topic
    // ("partir, c'est mourir") and nothing after it, the infinitive is the participle.
    if (isVerbHomograph(word) || !word.endsWith("er")) return null;
    const ce = inverted ? tokens[i - 1] : tokens[before];
    if (!ce || /,[\s ]*$/u.test(ctx.text.slice(Math.max(0, ce.start - 9), ce.start))) return null;
    const topic = inverted ? tokens.slice(i + 1) : tokens.slice(before + 1);
    if (topic.some((t) => verbReadings(t.w).some((r) => r.slot === "I"))) return null;
    // "c'est rêver" is a phrase of its own: only a degree adverb, a time or manner word after
    // it, or a question tells the participle ("c'est bien compliquer", "c'est arriver hier").
    const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
    if (next && !AFTER_CEST_PARTICIPLE.has(next.w)) return null;
    const degree = tokens.slice(0, i).some((t) => DEGREE.has(t.w));
    const question = /^[^.!…\n]{0,40}\?/u.test(ctx.text.slice(m.index));
    if (!next && !degree && !question) return null;
    subject = "il";
  } else {
    // "c'est manger", "partir, c'est mourir": an infinitive is the complement there. A noun
    // complement ("il est boucher") is no participle either.
    if (!subject || !SUBJECT_PRONOUNS.has(subject) || isVerbHomograph(word)) return null;
    // A pronoun that is not this auxiliary's subject tells nothing about the agreement.
    if (!(finiteMask(aux.w, "être") & PERSONS[subject])) subject = undefined;
  }
  const stem = lemma.slice(0, -2);
  const endings = avoir ? ["é"] : etreEndings(subject);
  return wordFinding(
    ctx,
    m.index,
    m[0],
    endings.map((ending) => stem + ending),
    RULE,
    "review_msg_fr_past_participle",
    { start: aux.start, end: m.index + m[0].length },
  );
}

const PREPOSITIONS = new Set(["de", "d'", "pour", "sans", "à"]);
const DETERMINERS = new Set(
  "le la les l' un une des du ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leurs".split(
    " ",
  ),
);
// "rien de changé", "quoi de prévu", "près de nous", "deux de cassés": the participle or the
// pronoun after "de" is not governed by it.
const NOT_GOVERNING_DE = new Set(
  (
    "rien quoi chose personne plus moins autre un une aucun aucune près loin autour auprès côté " +
    "lors hors face part chacun chacune beaucoup plupart certains plusieurs"
  ).split(" "),
);
// "pour toujours", "à jamais": the adverb completes the preposition.
const PREPOSITION_ADVERBS = new Set(["toujours", "jamais", "longtemps", "bientôt", "plus", "même"]);
// Participles more often a misspelt noun than a verb there: "de coté" for "de côté".
const MISSPELT_NOUNS = new Set(["coté"]);

// Adjectives and nouns before "à" + an infinitive: "facile à lire", "du mal à dormir".
const A_GOVERNORS = new Set(
  (
    "facile faciles difficile difficiles prêt prête prêts prêtes apte aptes simple simples " +
    "agréable agréables pénible pénibles impossible impossibles dur dure durs dures lent lente " +
    "mal peine difficultés difficulté tendance intérêt"
  ).split(" "),
);

/** Whether a preposition before an infinitive governs it, from the words around it. */
function prepositionGoverns(tokens: Token[], i: number, ctx: DetectContext, m: RegExpExecArray) {
  const governor = tokens[i];
  const previous = tokens[i + 1];
  // "de leur destinée": "leur" is a determiner as often as a pronoun.
  if (tokens.slice(0, i).some((t) => t.w === "leur")) return false;
  if (i > 0 && PREPOSITION_ADVERBS.has(tokens[i - 1].w)) return false;
  if ((governor.w === "de" || governor.w === "d'") && previous && NOT_GOVERNING_DE.has(previous.w))
    return false;
  if (governor.w === "à") {
    // "il à mangé" is the auxiliary misspelt: only a verb before "à" governs ("commence à").
    if (!previous || SUBJECT_PRONOUNS.has(previous.w)) return false;
    // "facile à mangé", "du mal à passé", "obligé à signalé", "il continue à adopté": an
    // adjective or noun that takes "à" + infinitive, a participle, or a verb after its subject.
    if (A_GOVERNORS.has(previous.w)) return true;
    // "de tendu à arqué": a range between two participles.
    const range = ["de", "d'"].includes(tokens[i + 2]?.w ?? "");
    if (
      !range &&
      !isVerbHomograph(previous.w) &&
      verbReadings(previous.w).some((r) => r.slot === "Q")
    )
      return true;
    if (
      SUBJECT_PRONOUNS.has(tokens[i + 2]?.w ?? "") &&
      verbReadings(previous.w).some(
        (r) => typeof r.slot === "number" && r.lemma !== "avoir" && r.lemma !== "être",
      )
    )
      return true;
    if (isVerbHomograph(previous.w)) return false;
    const readings = verbReadings(previous.w);
    if (!readings.some((r) => r.lemma !== "avoir" && r.lemma !== "être" && r.slot !== "Q"))
      return false;
  }
  // "I pour entrelacé", "râpé pour râpé": a clause-final participle after "pour" or "sans" names.
  if (
    (governor.w === "pour" || governor.w === "sans") &&
    /^[\s\u00a0]*(?:[.!?…]|$)/u.test(ctx.text.slice(m.index + m[0].length))
  )
    return false;
  return true;
}

/** "pour manger", "je veux changer", "il se fait aimer": an infinitive spelled as a participle. */
function infinitiveAfterGovernor(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0].toLowerCase();
  const lemma = firstGroupLemma(word, "Q");
  if (!lemma || MISSPELT_NOUNS.has(word)) return null;
  const tokens = tokensBefore(ctx.text, m.index);
  const i = skip(tokens, 0, [CLITICS, ADVERBS, NEGATION]);
  const governor = tokens[i];
  if (!governor) return null;
  if (PREPOSITIONS.has(governor.w)) {
    // A participle that is also a noun or adjective entry ("sans passé", "carte d'abonné"), or
    // a noun in -ée missing its e ("lieu d'arrivé"), unless an object follows ("avant de
    // passé la commande").
    const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
    const object = next && DETERMINERS.has(next.w);
    if (!object && (isVerbHomograph(word) || isVerbHomograph(`${word}e`))) return null;
    if (!prepositionGoverns(tokens, i, ctx, m)) return null;
  } else if (!verbGoverns(tokens, i)) return null;
  return wordFinding(ctx, m.index, m[0], [lemma], RULE, "review_msg_fr_infinitive", {
    start: governor.start,
    end: m.index + m[0].length,
  });
}

/** Whether the verb at index `i` governs the infinitive after it, with its own subject. */
function verbGoverns(tokens: Token[], i: number): boolean {
  const governor = tokens[i];
  // "en fait", "tout à fait" (or "tout a fait"): no verb.
  const previous = tokens[i + 1]?.w;
  const adverb =
    previous === "en" || ((previous === "à" || previous === "a") && tokens[i + 2]?.w === "tout");
  if (governor.w === "fait" && adverb) return false;
  // "Veuillez trouver": the polite imperative of vouloir governs an infinitive.
  if (governor.w === "veuillez") return true;
  // "ils ont bien entendu gêné": "bien entendu" (of course) is an adverb.
  if (governor.w === "entendu" && previous === "bien") return false;
  const readings = verbReadings(governor.w);
  const lemmas = new Set(readings.map((r) => r.lemma));
  const plain = [...lemmas].some((l) => GOVERNING.has(l));
  const attribute = [...lemmas].some((l) => GOVERNING_WITH_ATTRIBUTE.has(l));
  if (!plain && !attribute) return false;
  // Its own subject: a pronoun, or an auxiliary for a participle ("j'ai pu", "s'être fait").
  const j = skip(tokens, i + 1, [NEGATION, CLITICS, ADVERBS]);
  const subject = subjectAt(tokens, i + 1);
  const head = subject && SUBJECT_PRONOUNS.has(subject.w) ? subject : tokens[j];
  // Pronouns before the governor or its auxiliary ("je l'ai laissé", "je te souhaite").
  const auxiliary = head && (isAvoir(head.w) || isEtre(head.w)) ? 1 : 0;
  const chain = tokens
    .slice(i + 1, skip(tokens, j + auxiliary, [NEGATION, CLITICS]))
    .filter((t) => t !== subject);
  if (attribute && !plain) {
    if (chain.some((t) => OBJECTS.has(t.w))) return false;
    const reflexive = chain.some((t) => REFLEXIVES.has(t.w));
    if (reflexive && ![...lemmas].some((l) => REFLEXIVE_GOVERNORS.has(l))) return false;
  }
  if (readings.some(isFinite) && head) {
    if (SUBJECT_PRONOUNS.has(head.w) || ["ça", "cela", "qui"].includes(head.w)) return true;
  }
  // "le prof va vous gronder": "peut", "doit", "va" are no nouns, any subject will do.
  if (readings.some((r) => isFinite(r) && GOVERNING.has(r.lemma)) && !isVerbHomograph(governor.w))
    return true;
  if (readings.some((r) => r.slot === "Q") && head) {
    if (isAvoir(head.w) || isEtre(head.w) || head.w === "être" || head.w === "avoir") return true;
  }
  // "pour aller chercher", "il veut aller chercher"; never the noun ("le devoir", "le savoir").
  if (readings.some((r) => r.slot === "I") && head && !isVerbHomograph(governor.w)) {
    if (PREPOSITIONS.has(head.w) || readings.some(isFinite)) return true;
    if (verbReadings(head.w).some((r) => isFinite(r) && GOVERNING.has(r.lemma))) return true;
  }
  return governor.w === "faut";
}

// "pour vous parlez", "va vous grondez": "vous" there is the object of an infinitive.
function infinitiveAfterObjectVous(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0].toLowerCase();
  const lemma = firstGroupLemma(word, VOUS);
  if (!lemma) return null;
  const tokens = tokensBefore(ctx.text, m.index);
  // "vous pouvez nous appelez": any object pronouns before the verb.
  const clitics = skip(tokens, 0, [CLITICS]);
  const viaVous = clitics > 0;
  // "pour mieux vous débrouillez": adverbs only between a preposition and "vous".
  const afterAdverbs = viaVous ? skip(tokens, clitics, [ADVERBS]) : 0;
  let i = clitics;
  if (["de", "d'", "pour", "sans", "par"].includes(tokens[afterAdverbs]?.w ?? "")) i = afterAdverbs;
  const governor = tokens[i];
  if (!governor) return null;
  if (["de", "d'", "pour", "sans", "par"].includes(governor.w)) {
    if (tokens[i + 1] && NOT_GOVERNING_DE.has(tokens[i + 1].w)) return null;
    // "un dossier rédigé par vous": "par" governs only right after a verb ("commencer par").
    if (governor.w === "par" && !verbReadings(tokens[i + 1]?.w ?? "").length) return null;
  } else if (!verbGoverns(tokens, i)) return null;
  // "Allez venez !": a sentence-initial governor may be an imperative of its own.
  else if (!viaVous && !tokens[i + 1] && governor.w !== "veuillez") return null;
  return wordFinding(ctx, m.index, m[0], [lemma], RULE, "review_msg_fr_infinitive", {
    start: governor.start,
    end: m.index + m[0].length,
  });
}

// Conjunctions that open a clause with its own subject. "que", "et", "ou", "où", "donc" and a
// comma also come before an infinitive ("ne fait que vous plaindre", "vous saluer et vous
// remercier", "nulle part où vous cacher", "je peux donc vous montrer"): left out.
const CLAUSE_OPENERS = new Set(
  "si quand lorsque lorsqu' puisque puisqu' comme mais car".split(" "),
);
// Words that keep a sentence-initial "vous" + infinitive a clause of its own: "Vous aimer aller
// au cinéma", "Vous jouer pas".
const CONTINUES_FINITE = new Set(["pas", "jamais", "plus", "rien", "point"]);

/** "si vous continuer", "vous aimer aller au cinéma": a "vous" subject takes the -ez form. */
function finiteAfterSubjectVous(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0].toLowerCase();
  const infinitive = verbReadings(word).find((r) => r.slot === "I" && r.lemma === word);
  if (!infinitive || isVerbHomograph(word)) return null;
  const tokens = tokensBefore(ctx.text, m.index);
  const i = skip(tokens, 0, [NEGATION, CLITICS]);
  // The chain from "vous" to the verb: its first word is the subject.
  const chain = tokens.slice(0, i);
  const vous = chain.at(-1);
  if (vous?.w !== "vous") return null;
  const before = tokens[i];
  const after = tokensAfter(ctx.text, m.index + m[0].length, 8);
  if (before) {
    if (!CLAUSE_OPENERS.has(before.w)) return null;
  } else {
    // A sentence start, not a list item or a comma-joined infinitive.
    if (!/(?:^|[.!?…]\s*|\n\s*)$/.test(ctx.text.slice(Math.max(0, vous.start - 4), vous.start)))
      return null;
    const next = after[0];
    if (
      !next ||
      !(
        CONTINUES_FINITE.has(next.w) ||
        verbReadings(next.w).some((r) => r.slot === "I" && r.lemma === next.w)
      )
    )
      return null;
  }
  // "Vous dire cela ne changera rien": the infinitive is a subject with its own verb.
  if (
    after.some(
      (t) =>
        !isVerbHomograph(t.w) &&
        verbReadings(t.w).some((r) => isFinite(r) && (r.slot as number) & (IL | ILS)),
    )
  )
    return null;
  const present = conjugate({ ...infinitive, tense: 1 }, VOUS);
  if (present.length !== 1) return null;
  return wordFinding(ctx, m.index, m[0], present, RULE, "review_msg_fr_vous_verb", {
    start: vous.start,
    end: m.index + m[0].length,
  });
}

const ETRE =
  /(?<![\p{L}\p{M}\p{N}_-])(?:suis|es|est|sommes|êtes|sont|étais|était|étions|étiez|étaient|serai|seras|sera|serons|serez|seront|serais|serait|serions|seriez|seraient|fus|fut|furent|été)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const PLURAL_ETRE = new Set(
  "sommes êtes sont étions étiez étaient serons serez seront serions seriez seraient furent".split(
    " ",
  ),
);
const PLURAL_AVOIR = new Set(
  "avons avez ont avions aviez avaient aurons aurez auront auraient".split(" "),
);
const FEMININE_SUBJECTS = new Set(["elle", "elles"]);
const MASCULINE_SUBJECTS = new Set(["il", "ils"]);

/** "il est partit", "elles étaient misent", "il a été dis": a finite form after être for its
 * participle, agreed with the subject the pronoun or the auxiliary shows. */
function finiteAfterEtre(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  if (ctx.text[m.index + m[0].length] === "-" || ctx.text[m.index - 1] === "-") return null;
  const aux = m[0].toLowerCase();
  const before = tokensBefore(ctx.text, m.index, 4);
  const subject = subjectAt(before, 0);
  // "est" is also the East: only after a subject, or "été" after avoir.
  if (aux === "été" ? !isAvoir(before[0]?.w ?? "") : !subject || subject.w === "y") return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 4);
  const word = after[skip(after, 0, [ADVERBS])];
  if (!word || word.hyphen || capitalizedName(ctx.text, word.start, word.w)) return null;
  if (ctx.text.slice(word.start, word.end) !== word.w || isVerbHomograph(word.w)) return null;
  if (adjectiveReadings(word.w).length || ctx.dictionary.has(word.w)) return null;
  const readings = verbReadings(word.w);
  if (!readings.length || !readings.every(isFinite)) return null;
  const participles = [...new Set(readings.map((r) => pastParticiple(r.lemma)))];
  const participle = participles[0];
  if (participles.length !== 1 || !participle || participle === word.w) return null;
  // Only a form that sounds like the participle is one misspelt ("partit", "dis", "misent");
  // "est atteignent", "a été disparaîtra" are other slips.
  const soundsLike =
    word.w.startsWith(participle) ||
    (/[std]$/.test(word.w) && participle.startsWith(word.w.slice(0, -1)));
  if (!soundsLike) return null;
  const plural = aux === "été" ? PLURAL_AVOIR.has(before[0].w) : PLURAL_ETRE.has(aux);
  const pronoun = subject?.w ?? "";
  const genders = FEMININE_SUBJECTS.has(pronoun)
    ? [true]
    : MASCULINE_SUBJECTS.has(pronoun) || aux === "été"
      ? [false]
      : [false, true];
  const forms = genders.map((feminine) => {
    const stem = feminine ? `${participle}e` : participle;
    return plural && !stem.endsWith("s") ? `${stem}s` : stem;
  });
  return wordFinding(ctx, word.start, word.w, forms, RULE, "review_msg_fr_past_participle", {
    start: m.index,
    end: word.end,
  });
}

const AVOIR =
  /(?<![\p{L}\p{M}\p{N}_-])(?:avoir|ai|as|a|avons|avez|ont|avais|avait|avions|aviez|avaient|aurai|auras|aura|aurons|aurez|auront|aurais|aurait|aurions|auriez|auraient)(?![\p{L}\p{M}\p{N}_'’])/giu;
// Words before the infinitive "avoir" that make it an auxiliary: "après avoir", "pour avoir".
const AVOIR_INFINITIVE_GOVERNORS = new Set(["après", "pour", "sans", "de", "d'"]);

/** "j'ai comprit", "il a reçut", "on a mange": a finite form after avoir for its participle. */
function finiteAfterAvoir(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const inverted = ctx.text[m.index + m[0].length] === "-";
  const before = tokensBefore(ctx.text, m.index);
  const subject = subjectAt(before, 0);
  // "a" and "as" are also a preposition and a noun: only after their subject or inverted.
  const subjects = ["je", "j'", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "qui"];
  if (m[0].toLowerCase() === "avoir") {
    // "après avoir était publié", "il pense avoir comprit": an infinitive auxiliary.
    // "ce qu'il pensait avoir était perdu": after a relative, the verb after "avoir" is the main one.
    const g = skip(before, 0, [NEGATION, CLITICS]);
    const governor = before[g];
    const relative = before.slice(g, g + 4).some((t) => ["que", "qu'", "dont"].includes(t.w));
    const governs =
      governor &&
      (AVOIR_INFINITIVE_GOVERNORS.has(governor.w) ||
        (!relative && !isVerbHomograph(governor.w) && verbReadings(governor.w).some(isFinite)));
    if (!governs) return null;
  } else if (!inverted && !(subject && [...subjects, "ça", "cela"].includes(subject.w)))
    return null;
  // "il y a", "il n'y en a": "y" makes "a" introduce a noun.
  if (before.slice(0, 3).some((t) => t.w === "y")) return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 6).filter(
    (t, i) => !(inverted && i < 2 && (SUBJECT_PRONOUNS.has(t.w) || t.w === "t")),
  );
  const word = after[skip(after, 0, [ADVERBS])];
  if (!word || word.hyphen || capitalizedName(ctx.text, word.start, word.w)) return null;
  if (ctx.text.slice(word.start, word.end) !== word.w || isVerbHomograph(word.w)) return null;
  const readings = verbReadings(word.w);
  if (!readings.length || !readings.every(isFinite)) return null;
  // "ils ont peut être raison": "peut-être" missing its hyphen.
  if (word.w === "peut" && tokensAfter(ctx.text, word.end, 1)[0]?.w === "être") return null;
  const participles = [...new Set(readings.map((r) => pastParticiple(r.lemma)))];
  if (participles.length !== 1 || !participles[0] || participles[0] === word.w) return null;
  // "-er" present forms are participleAfterAuxiliary's ("il a manger"); this one takes the rest.
  return wordFinding(
    ctx,
    word.start,
    word.w,
    [participles[0]],
    RULE,
    "review_msg_fr_past_participle",
    { start: m.index, end: word.end },
  );
}

/** Determiners with the gender ("" either) and number they show. */
const NOUN_DETERMINERS: Record<string, [string, "s" | "p"]> = {
  le: ["m", "s"],
  la: ["f", "s"],
  "l'": ["", "s"],
  un: ["m", "s"],
  une: ["f", "s"],
  du: ["m", "s"],
  au: ["m", "s"],
  ce: ["m", "s"],
  cet: ["m", "s"],
  cette: ["f", "s"],
  mon: ["", "s"],
  ton: ["", "s"],
  son: ["", "s"],
  ma: ["f", "s"],
  ta: ["f", "s"],
  sa: ["f", "s"],
  notre: ["", "s"],
  votre: ["", "s"],
  leur: ["", "s"],
  les: ["", "p"],
  des: ["", "p"],
  aux: ["", "p"],
  ces: ["", "p"],
  mes: ["", "p"],
  tes: ["", "p"],
  ses: ["", "p"],
  nos: ["", "p"],
  vos: ["", "p"],
  leurs: ["", "p"],
};
// Verbs that take an object and then its infinitive: "je vois les enfants jouer", "il emmène
// le chien promener".
const OBJECT_INFINITIVE = new Set([
  ...GOVERNING_WITH_ATTRIBUTE,
  "emmener",
  "envoyer",
  "mener",
  "amener",
  "apercevoir",
  "observer",
  "contempler",
  "écouter",
]);

// Verbs that take an infinitive, even across an adverbial phrase ("peut de cette manière trier",
// "j'ai senti mon téléphone vibrer").
const INFINITIVE_GOVERNORS = new Set([
  ...GOVERNING,
  ...OBJECT_INFINITIVE,
  ..."vouloir venir partir sortir courir monter descendre rentrer retourner sembler paraître croire penser falloir".split(
    " ",
  ),
]);
// Nouns that take an infinitive complement, its "de" sometimes dropped: "une envie rentrer".
const INFINITIVE_NOUNS = new Set(
  (
    "envie besoin temps moyen occasion opportunité droit peur intention façon manière raison " +
    "chance possibilité capacité plaisir honte mal hâte idée habitude permission obligation"
  ).split(" "),
);
const OBJECT_PRONOUNS = new Set("le la les l' lui leur me m' te t' se s' nous vous".split(" "));
// Adjectives that come before their noun: "un nouveau ficher" misspells the noun.
export const PRENOMINAL = new Set(
  (
    "nouveau nouvel nouvelle nouveaux nouvelles beau bel belle beaux belles vieux vieil vieille " +
    "petit petite petits petites grand grande grands grandes bon bonne bons bonnes gros grosse " +
    "jeune jeunes autre autres même mêmes premier première dernier dernière prochain prochaine " +
    "seul seule mauvais mauvaise joli jolie"
  ).split(" "),
);
const PREPOSITIONS_BEFORE = new Set(
  "dans en sur sous avant après pendant depuis avec sans pour par chez vers entre".split(" "),
);

/** "une écharpe nouer dans le dos", "la voix étouffer de sanglots": an infinitive right after a
 * noun is its participle, unless a verb before governs an infinitive ("j'entends la pluie
 * tomber", "il peut de cette manière trier") or the infinitive takes an object of its own. */
function participleAfterNoun(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0].toLowerCase();
  if (m[0] !== word || isVerbHomograph(word) || firstGroupLemma(word, "I") !== word) return null;
  if (verbReadings(word).some((r) => r.slot !== "I")) return null;
  const tokens = tokensBefore(ctx.text, m.index, 14);
  // "un jean noir coller à la peau", "un style diamétralement opposer": an adjective or a -ment
  // adverb between the noun and the word.
  const between =
    tokens[0] &&
    ((/..ment$/.test(tokens[0].w) && !isInflectedNoun(tokens[0].w)) ||
      (adjectiveReadings(tokens[0].w).length > 0 && !verbReadings(tokens[0].w).length)) &&
    tokens[2]?.w in NOUN_DETERMINERS;
  const before = between ? tokens.slice(1) : tokens;
  const [noun, det] = before;
  if (!noun || !det || noun.hyphen || !(det.w in NOUN_DETERMINERS)) return null;
  if (ctx.text.slice(noun.start, noun.end) !== noun.w || noun.w.length < 3) return null;
  // "la fait passer": an object pronoun and a verb.
  if (
    verbReadings(noun.w).some((r) => r.slot !== "Q") &&
    (OBJECTS.has(det.w) || !isVerbHomograph(noun.w))
  )
    return null;
  if (INFINITIVE_NOUNS.has(noun.w)) return null;
  const singular = noun.w.replace(/aux$/, "al").replace(/[sx]$/, "");
  const gender = nounGender(noun.w) ?? nounGender(singular);
  if (!gender && !isInflectedNoun(noun.w)) return null;
  // "un nouveau ficher": an adjective before its noun.
  if ((!gender && adjectiveReadings(noun.w).length) || PRENOMINAL.has(noun.w)) return null;
  // "voit Jack, l'ami de son père entrer": the governing verb may sit before an apposition.
  const first = before.at(-1)!;
  const comma = /,[\s ]*$/u.test(ctx.text.slice(Math.max(0, first.start - 4), first.start));
  const governed = (t: Token) => verbReadings(t.w).some((r) => INFINITIVE_GOVERNORS.has(r.lemma));
  if (before.slice(2).some(governed)) return null;
  if (comma && tokensBefore(ctx.text, ctx.text.lastIndexOf(",", first.start), 8).some(governed))
    return null;
  // A pronoun subject right before the determiner makes it an object pronoun.
  if (before[2] && (SUBJECT_PRONOUNS.has(before[2].w) || NEGATION.has(before[2].w))) return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 6);
  // "concevoir des projets organiser les activités": an infinitive with its own object ("au",
  // "aux" open a complement: "collé aux jambes").
  const object = after[0] && after[0].w in NOUN_DETERMINERS && !/^aux?$/.test(after[0].w);
  if (object || (after[0] && OBJECT_PRONOUNS.has(after[0].w))) return null;
  const clause = before.slice(2);
  const verbBefore = clause.some((t) => verbReadings(t.w).some((r) => r.slot !== "I"));
  // "Dans cette pièce fumer est interdit", "Avant l'exposition appliquer": an infinitive after
  // an opening phrase is a subject or an instruction.
  if (!verbBefore && clause.some((t) => PREPOSITIONS_BEFORE.has(t.w))) return null;
  // "Verser l'eau mélanger au bouillon": a recipe's run of infinitive instructions.
  const instruction = (t: Token) => verbReadings(t.w).some((r) => r.slot === "I");
  if (!verbBefore && clause.some(instruction)) return null;
  // "Ma mère aimer le chocolat": a noun phrase opening its clause is the subject of an
  // infinitive written for its verb, unless the clause's own verb comes later ("la voix
  // étouffer de sanglots coupa l'air").
  if (!before[2] || CLAUSE_OPENERS.has(before[2].w)) {
    if (!after.some((t) => !isVerbHomograph(t.w) && verbReadings(t.w).some(isFinite))) return null;
  }
  const [detGender, number] = NOUN_DETERMINERS[det.w];
  const genders = detGender || gender ? [detGender || gender!] : ["m", "f"];
  const stem = word.slice(0, -2);
  const alternatives = genders.map(
    (g) => `${stem}é${g === "f" ? "e" : ""}${number === "p" ? "s" : ""}`,
  );
  const finding = wordFinding(
    ctx,
    m.index,
    m[0],
    alternatives,
    RULE,
    "review_msg_fr_noun_participle",
  );
  return finding ? { ...finding, context: { start: det.start, end: m.index + m[0].length } } : null;
}

// Articles that are never object pronouns; "le", "la", "les", "l'" only after a preposition or
// opening a clause.
const ARTICLES = new Set(["un", "une", "des", "du", "au", "aux"]);
const DEFINITE = new Set(["le", "la", "les", "l'"]);
const ARTICLE_AFTER = new Set([...PREPOSITIONS, ...PREPOSITIONS_BEFORE, "d'"]);
// Words that open a clause of its own, whose verb may follow a noun phrase.
const SUBORDINATORS = new Set(
  "que qu' qui où dont si quand lorsque lorsqu' puisque puisqu' comme et ou mais car donc ni".split(
    " ",
  ),
);
// Prepositions that are also verb forms ("entrer", "contrer").
const NOT_PARTICIPLES = new Set(["entre", "contre", "outre"]);
const isClauseVerb = (word: string) =>
  isEtre(word) ||
  isAvoir(word) ||
  (verbReadings(word).some(isFinite) && !isInflectedNoun(word) && !isVerbHomograph(word));

/** "un blesse", "les associes ne", "un terrain accidente", "le groupe reclasse arrive": a
 * first-group participle missing its accent, where a finite verb cannot stand: right after an
 * article, or after a noun phrase when the clause already has its verb before or after it. */
function accentlessParticiple(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0];
  const readings = verbReadings(word);
  if (!readings.length || !readings.every(isFinite) || isInflectedNoun(word)) return null;
  if (adjectiveReadings(word).length || NOT_PARTICIPLES.has(word)) return null;
  const lemma = firstGroupLemma(word.replace(/es?$/, "é"), "Q");
  if (!lemma || !readings.some((r) => r.lemma === lemma)) return null;
  const tokens = tokensBefore(ctx.text, m.index, 10);
  const [first, second] = tokens;
  if (!first || first.hyphen) return null;
  let det: Token;
  let noun: Token | undefined;
  if (first.w in NOUN_DETERMINERS) {
    det = first;
    const article = ARTICLES.has(det.w) || (!second && DEFINITE.has(det.w));
    if (!article && !(DEFINITE.has(det.w) && ARTICLE_AFTER.has(second.w))) return null;
    // Right after an article the participle is a noun ("un blessé"); a misspelt noun ("un
    // trafique") is no participle.
    if (!isNounLemma(`${lemma.slice(0, -2)}é`)) return null;
  } else {
    if (!second || !(second.w in NOUN_DETERMINERS)) return null;
    [noun, det] = [first, second];
    if (ctx.text.slice(noun.start, noun.end) !== noun.w || noun.w.length < 3) return null;
    if (!isInflectedNoun(noun.w) || (verbReadings(noun.w).length && !isVerbHomograph(noun.w)))
      return null;
    const clause = tokens.slice(2);
    if (clause.some((t) => SUBORDINATORS.has(t.w))) return null;
    // "je vois le chien mange": a verb of perception wants the infinitive; left alone.
    const governed = (t: Token) => verbReadings(t.w).some((r) => INFINITIVE_GOVERNORS.has(r.lemma));
    if (clause.some(governed)) return null;
    const next = tokensAfter(ctx.text, m.index + word.length, 1)[0];
    // "a" may be "à" or the Latin "a minima": not taken for avoir.
    const verbAfter = !clause.length && !!next && next.w !== "a" && isClauseVerb(next.w);
    // A verb that is also a noun counts after a subject pronoun: "il roule sur".
    const verbBefore = clause.some(
      (t, i) =>
        isClauseVerb(t.w) ||
        (verbReadings(t.w).some(isFinite) && SUBJECT_PRONOUNS.has(clause[i + 1]?.w ?? "")),
    );
    if (!verbAfter && !verbBefore) return null;
    // "une magnifique emprunte": an adjective before a misspelt noun, not a noun before its
    // participle; the noun must show its gender.
    if (!nounGender(noun.w) && !nounGender(noun.w.replace(/[sx]$/, ""))) return null;
  }
  const [detGender, number] = NOUN_DETERMINERS[det.w];
  if ((number === "p") !== word.endsWith("es")) return null;
  const gender = detGender || (noun && nounGender(noun.w));
  const genders = gender ? [gender] : ["m", "f"];
  const stem = lemma.slice(0, -2);
  const alternatives = genders.map(
    (g) => `${stem}é${g === "f" ? "e" : ""}${number === "p" ? "s" : ""}`,
  );
  const finding = wordFinding(
    ctx,
    m.index,
    word,
    alternatives,
    RULE,
    "review_msg_fr_noun_participle",
  );
  return finding ? { ...finding, context: { start: det.start, end: m.index + word.length } } : null;
}
const ACCENTLESS = /(?<![\p{L}\p{M}\p{N}_'’-])\p{Ll}{2,}es?(?![\p{L}\p{M}\p{N}_'’-])/gu;

const CANDIDATE = /(?<![\p{L}\p{M}\p{N}_-])\p{L}+(?:er|é|ez|re|ir|oir)(?![\p{L}\p{M}\p{N}_-])/giu;

function verbForms(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, CANDIDATE)) {
    if (capitalizedName(ctx.text, m.index, m[0])) continue;
    const lower = m[0].toLowerCase();
    const finding = lower.endsWith("é")
      ? infinitiveAfterGovernor(ctx, m)
      : lower.endsWith("ez")
        ? (participleAfterAuxiliary(ctx, m) ?? infinitiveAfterObjectVous(ctx, m))
        : lower.endsWith("er")
          ? (participleAfterAuxiliary(ctx, m) ??
            finiteAfterSubjectVous(ctx, m) ??
            participleAfterNoun(ctx, m))
          : finiteAfterSubjectVous(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, ETRE)) {
    const finding = finiteAfterEtre(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, AVOIR)) {
    const finding = finiteAfterAvoir(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, ACCENTLESS)) {
    const finding = accentlessParticiple(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: verbForms }];
