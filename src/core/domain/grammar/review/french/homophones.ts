import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  finitePersons,
  IL,
  ILS,
  inflect,
  isDictionaryCompound,
  isFrenchWord,
  isInflectedNoun,
  isNounLemma,
  isVerbHomograph,
  isVerbLemma,
  JE,
  nounGender,
  TU,
  verbReadings,
  type VerbReading,
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
import { finding } from "../finding";
import { carryCase } from "../../implementations/helpers/GenericRuleShared";
import { isLang } from "../phraseTemplates";
import { firstNameGender } from "./firstNames";

// Small words that sound alike (a/à, ou/où, ce/se, sa/ça, sûr/sur, son/sont, du/dû, on/ont, ma/m'a)
// told apart by the words around them. Fixed frames that need no context are phrase rows
// (phrases.ts); these frames read a subject, a verb form or a clause boundary.

const RULE = "frenchHomophones";
const MESSAGE = "review_msg_fr_homophone";

const ADVERBS = new Set(
  "pas plus jamais bien déjà encore toujours souvent beaucoup vraiment aussi même enfin tout".split(
    " ",
  ),
);
const CONJUNCTIONS = new Set(
  "et mais ou donc or car que qu' quand si puis alors comme lorsque lorsqu' puisque puisqu' où ainsi".split(
    " ",
  ),
);
const DETERMINERS = new Set(
  (
    "le la les l' un une des du au aux ce cet cette ces mon ma mes ton ta tes son sa ses notre nos " +
    "votre vos leur leurs"
  ).split(" "),
);
// Words that open a relative or completive clause: "ce qu'il a fait a surpris" keeps its "a".
const CLAUSE_SUBJECTS = new Set(["que", "qu'", "qui", "dont", "où", "ce", "quoi"]);

const isFinite = (r: VerbReading) => typeof r.slot === "number";
const readingsOf = (word: string) => verbReadings(word);
const isAuxiliary = (word: string) =>
  readingsOf(word).some((r) => isFinite(r) && (r.lemma === "avoir" || r.lemma === "être"));
/** A verb form only: no noun or adjective spelled the same. */
const plainVerb = (word: string, test: (r: VerbReading) => boolean) =>
  !isVerbHomograph(word) && readingsOf(word).some(test);
const isParticiple = (word: string) => plainVerb(word, (r) => r.slot === "Q");
const isInfinitive = (word: string) => plainVerb(word, (r) => r.slot === "I");

/** Nothing before the token in its clause but a conjunction: it starts a clause. */
function clauseStart(tokens: Token[], i: number): boolean {
  return !tokens[i] || CONJUNCTIONS.has(tokens[i].w);
}

/** A sentence starts right before `index` (start, end mark, line break, opening quote). */
function sentenceStart(text: string, index: number): boolean {
  return /(?:^|[.!?…]|\n|[«"“(—–-])[\s  ]*$/u.test(text.slice(Math.max(0, index - 6), index));
}

/** The words before "à" from index `i` are a subject opening the sentence: a name ("Pierre",
 * "Maman") or a determiner and a noun ("La maison"). */
function subjectOpens(text: string, before: Token[], i: number): boolean {
  const words = before.slice(i);
  const first = words.at(-1);
  if (!first || !sentenceStart(text, first.start)) {
    // "Hier, Pierre à raison": a name inside the sentence.
    return (
      words.length === 1 && /^\p{Lu}/u.test(text[words[0].start]) && !readingsOf(words[0].w).length
    );
  }
  // "Marie", "Pierre": a first name, even one spelled like a verb form.
  const typed = text.slice(first.start, first.end);
  if (words.length === 1 && firstNameGender(typed)) return true;
  if (words.length === 1)
    return (
      /^\p{Lu}/u.test(text[first.start]) &&
      // "Face à une demande": a French word opening the sentence is no name.
      !isFrenchWord(first.w) &&
      !ADVERBS.has(first.w) &&
      !CONJUNCTIONS.has(first.w) &&
      !STRESSED.has(first.w)
    );
  const [noun, det] = words;
  return (
    words.length === 2 &&
    DETERMINERS.has(det.w) &&
    isInflectedNoun(noun.w) &&
    (!readingsOf(noun.w).length || isVerbHomograph(noun.w))
  );
}

/** "il à mangé", "Paul à travaillé", "ça à l'air": the verb "a" written as the preposition. */
function graveToA(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 4);
  const i = before.findIndex((t) => !CLITICS.has(t.w) || t.w === "nous" || t.w === "vous");
  const subject = before[i];
  const clitics = before.slice(0, Math.max(i, 0));
  let j = 0;
  while (after[j] && ADVERBS.has(after[j].w)) j++;
  const next = after[j];
  const fix = (alt: string) =>
    wordFinding(ctx, m.index, m[0], [alt], RULE, MESSAGE, {
      start: subject?.start ?? m.index,
      end: (next ?? after[0])?.end ?? m.index + m[0].length,
    });
  if (after[0]?.w === "été") return fix("a");
  if (!subject) return null;
  // "va-t-il à", "suffit t'il à": an inverted subject.
  const inverted =
    ctx.text[subject.start - 1] === "-" || ["t", "t'"].includes(before[i + 1]?.w ?? "");
  if (!inverted && (subject.w === "il" || subject.w === "on")) return fix("a");
  if (!inverted && subject.w === "tu" && clauseStart(before, i + 1)) return fix("as");
  if (
    !inverted &&
    ["elle", "ça", "cela"].includes(subject.w) &&
    clauseStart(before, i + 1) &&
    next &&
    (DETERMINERS.has(next.w) || isParticiple(next.w))
  )
    return fix("a");
  // A name or a noun phrase opening the sentence, then what only avoir takes: "Pierre à
  // raison", "La maison à toujours une fuite", "Maman à le bras cassé", "Marie à un ami".
  if (!clitics.length && next && subjectOpens(ctx.text, before, i)) {
    const name = before.length === 1 && /^\p{Lu}/u.test(ctx.text[subject.start]);
    const adverbs = j > 0;
    const bare = AVOIR_BARE_NOUNS.has(next.w) && !["de", "d'"].includes(after[j + 1]?.w ?? "");
    const article =
      (next.w === "le" || next.w === "les") &&
      !!after[j + 1] &&
      isInflectedNoun(after[j + 1].w) &&
      !readingsOf(after[j + 1].w).length;
    const determiner =
      DETERMINERS.has(next.w) && (adverbs || (name && (next.w === "un" || next.w === "une")));
    if (
      !["tort", "froid", "chaud", "part", "main", "pied", "cheval"].includes(next.w) &&
      (bare || article || determiner || (adverbs && isParticiple(next.w)))
    )
      return fix("a");
  }
  // A name or "qui", then a participle. A noun + "à" + participle is as often an infinitive
  // misspelt ("une eau à captée"), and "à tout" a locution ("réponse à tout").
  if (!after[0] || !isParticiple(after[0].w) || clitics.length) return null;
  const name =
    /^\p{Lu}/u.test(ctx.text.slice(subject.start, subject.end)) &&
    !sentenceStart(ctx.text, subject.start);
  return name || subject.w === "qui" ? fix("a") : null;
}

const RELATIVES = new Set(["laquelle", "lequel", "lesquels", "lesquelles"]);
// "a priori", "a cappella": Latin and Italian locutions keep their plain "a".
const LATIN = new Set(
  "priori posteriori minima maxima cappella capella contrario fortiori giorno".split(" "),
);
const STRESSED = new Set(
  "moi toi lui elle eux elles nous vous soi quoi qui ça cela ceci tout tous toutes chaque chacun plusieurs".split(
    " ",
  ),
);

/** The word after a preposition: a determiner, a stressed pronoun, a name, a number or an
 * infinitive. */
function startsNounPhrase(text: string, token: Token): boolean {
  return (
    DETERMINERS.has(token.w) ||
    STRESSED.has(token.w) ||
    NUMBERS.test(token.w) ||
    /^[\p{Lu}\d]/u.test(text.slice(token.start, token.end)) ||
    readingsOf(token.w).some((r) => r.slot === "I" && r.lemma === token.w)
  );
}
// Bare nouns avoir takes in a locution: "a faim", "a lieu", "a accès", "a carte blanche".
const AVOIR_BARE_NOUNS = new Set(
  (
    "faim soif peur froid chaud sommeil raison tort besoin envie honte mal lieu cours droit " +
    "horreur confiance hâte beau affaire recours trait part coutume tendance congé charge " +
    "qualité vocation obligation interdiction ordre accès priorité pitié conscience " +
    "connaissance intérêt foi soin marre cœur coeur idée avantage mission autorité carte " +
    "peine force valeur gain rendez-vous pied main pignon madame monsieur mademoiselle"
  ).split(" "),
);

/** "boîte a outils", "râpe a fromage": `next` is a bare noun (no determiner) after the noun
 * `previous`, which avoir would take only in a locution. */
function bareNounAfterNoun(
  text: string,
  previous: Token,
  next: Token,
  second: Token | undefined,
): boolean {
  if (text.slice(previous.start, previous.end) !== previous.w) return false;
  if (text.slice(next.start, next.end) !== next.w || AVOIR_BARE_NOUNS.has(next.w)) return false;
  // "a son histoire", "a bien transmis", "a rien": a determiner, an adverb or a pronoun.
  const w = next.w;
  if (DETERMINERS.has(w) || STRESSED.has(w) || QUANTIFIERS.has(w) || ADVERBS.has(w)) return false;
  if (w.endsWith("ment") || w === "rien" || w === "personne" || NUMBERS.test(w)) return false;
  // "a durée": a participle misspelt.
  const stem = /^(.+?)(?:ée?s?)$/.exec(w)?.[1];
  if (stem && isVerbLemma(`${stem}er`)) return false;
  if (!nounGender(previous.w) && !isInflectedNoun(previous.w)) return false;
  if (readingsOf(previous.w).some(isFinite) && !isVerbHomograph(previous.w)) return false;
  // "a mangé", "a vendre", "a bon goût": a participle, an infinitive or an adjective.
  if (readingsOf(next.w).some((r) => !isFinite(r)) || adjectiveReadings(next.w).length)
    return false;
  const singular = next.w.replace(/[sx]$/, "");
  const plural = singular !== w && isInflectedNoun(singular);
  if (!nounGender(w) && !nounGender(singular) && !plural) return false;
  // "a valeur de loi", "a ordre de tirer": a noun with "de" may be one more locution; "a
  // désormais une forme", "a depuis ordonné": an adverb before the verb's own object.
  if (!second) return true;
  if (["de", "d'", "du", "des"].includes(second.w) || DETERMINERS.has(second.w)) return false;
  return !readingsOf(second.w).some((r) => r.slot === "Q");
}

const QUANTIFIERS = new Set(["rien", "beaucoup", "peu", "trop", "tant", "assez", "chose"]);

// Words after which "a" starts a locution of the preposition: "a côté", "a travers", "a
// l'exception de". Avoir has no reading with them.
const AFTER_PREPOSITION = new Set(
  "côté coté travers droite gauche cheval vélo présent propos condition".split(" "),
);
const ELIDED_AFTER = new Set(["exception", "accoutumée", "instar", "abri", "égard", "envers"]);
// Days and times that close "a bientôt", "a demain", "a samedi" at the end of a clause.
const FAREWELLS = new Set(
  "bientôt demain lundi mardi mercredi jeudi vendredi samedi dimanche tantôt".split(" "),
);
// Words before "a" that only the preposition follows: "grâce a", "jusqu'a", "quant a".
const BEFORE_PREPOSITION = new Set(
  "jusqu' quant comparé comparativement contrairement conformément relativement proportionnellement".split(
    " ",
  ),
);

/** "a côté", "a moins que", "a peu près", "a l'exception de", "a bientôt.", "grâce a",
 * "par rapport a", "d'ici a": locutions where only the preposition fits. */
function prepositionLocution(ctx: DetectContext, before: Token[], after: Token[], end: number) {
  const [next, second] = after;
  if (AFTER_PREPOSITION.has(next.w)) return true;
  if (next.w === "l'" && second && ELIDED_AFTER.has(second.w)) return true;
  if (next.w === "moins" && (second?.w === "que" || second?.w === "qu'")) return true;
  if (next.w === "cause" && (second?.w === "de" || second?.w === "d'" || second?.w === "du"))
    return true;
  if (next.w === "peu" && second?.w === "près") return true;
  if (
    FAREWELLS.has(next.w) &&
    /^\s{0,8}(?:[.!?…,;]|$)/u.test(ctx.text.slice(next.end, next.end + 10))
  )
    return /^\p{Ll}/u.test(ctx.text.slice(next.start, next.end)) && end <= next.start;
  const [b0, b1] = before;
  // "Mary Quant a lancé": a name.
  if (!b0) return false;
  if (/^\p{Lu}/u.test(ctx.text.slice(b0.start, b0.end)) && !sentenceStart(ctx.text, b0.start))
    return false;
  if (BEFORE_PREPOSITION.has(b0.w)) return true;
  if ((b0.w === "grâce" || b0.w === "grace") && (!b1 || !(b1.w in DETERMINER_GENDER))) return true;
  if (b0.w === "rapport" && b1?.w === "par") return true;
  if (b0.w === "ici" && b1?.w === "d'") return true;
  return false;
}
const DETERMINER_GENDER: Record<string, true> = {
  la: true,
  sa: true,
  ma: true,
  ta: true,
  une: true,
  cette: true,
  leur: true,
  votre: true,
  notre: true,
};

const RANGE_END =
  /^[ \t\u00a0]{1,8}\d+(?:[.,]\d+)?[ \t\u00a0]*(?:[.,;:!?)]|$|(?:h|heures?|ans?|mois|jours?|semaines?|minutes?|secondes?|euros?|€|%|km|kg|m|cm|mètres?|kilomètres?|degrés?|°)(?![\p{L}\p{N}]))/u;

/** "est supérieure", "sont identiques": an adjective after être, which "a" cannot follow. */
function attributeBefore(before: Token[]): boolean {
  const [adjective, verb] = before;
  return (
    !!verb &&
    readingsOf(verb.w).some((r) => isFinite(r) && r.lemma === "être") &&
    !nounGender(adjective.w) &&
    (adjectiveReadings(adjective.w).length > 0 || /[ai]ble$/.test(adjective.w)) &&
    !readingsOf(adjective.w).some(isFinite)
  );
}

/** "je pense a toi", "j'ai répondu a ta lettre", "A la fin": the preposition missing its accent. */
function aToGrave(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  if (ctx.text[m.index + 1] === "-" || ctx.text[m.index - 1] === "-") return null;
  const before = tokensBefore(ctx.text, m.index);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 2);
  const next = after[0];
  // "de 7 a 8.", "de 9 h a 17 h", "de 6 mois a 1 an": a range between numbers, closed by the
  // clause or a unit ("de 1989 a 13 disciplines" is avoir).
  if (
    m[0] === "a" &&
    /(?<![\p{L}\p{N}])de[ \t\u00a0]+\d+[ \t\u00a0]*\p{L}*[ \t\u00a0]{1,8}$/u.test(
      ctx.text.slice(Math.max(0, m.index - 24), m.index),
    ) &&
    RANGE_END.test(ctx.text.slice(m.index + 1, m.index + 24))
  )
    return wordFinding(ctx, m.index, m[0], ["à"], RULE, MESSAGE);
  if (
    /^[ \t\u00a0]{1,8}\d/.test(ctx.text.slice(m.index + 1, m.index + 10)) &&
    attributeBefore(before)
  )
    return wordFinding(ctx, m.index, m[0], ["à"], RULE, MESSAGE);
  if (!next || next.hyphen) return null;
  const fix = (context: Token | undefined) =>
    wordFinding(ctx, m.index, m[0], ["à"], RULE, MESSAGE, {
      start: context?.start ?? m.index,
      end: next.end,
    });
  // A capital "A" without its accent is tolerated typography: left alone.
  if (m[0] === "A" || LATIN.has(next.w) || next.w === "t" || next.w === "t'") return null;
  if (RELATIVES.has(next.w)) return fix(undefined);
  // "elle a l'air ravie": avoir l'air.
  if (next.w === "l'" && after[1]?.w === "air") return null;
  const previous = before[0];
  // "une machine a laver", "rien a faire": avoir never takes a bare infinitive.
  // After a subject, "a" + an infinitive in -er is as often a participle misspelt ("Sami a
  // télécharger"): there only an infinitive that sounds unlike its participle tells.
  if (isInfinitive(next.w) && next.w.length > 3) {
    const governed =
      previous &&
      (QUANTIFIERS.has(previous.w) ||
        readingsOf(previous.w).some(
          (r) =>
            r.slot === "I" || (isFinite(r) && r.lemma !== "avoir" && !isVerbHomograph(previous.w)),
        ));
    if (governed || !next.w.endsWith("er")) return fix(previous);
  }
  if (prepositionLocution(ctx, before, after, m.index + m[0].length)) return fix(previous);
  if (!previous) return null;
  // "de 6 a 10": between numbers.
  // "rien a faire", "beaucoup a apprendre".
  if (QUANTIFIERS.has(previous.w) && isInfinitive(next.w)) return fix(previous);
  // Past the clause's own subject clause ("ce qu'il pense a de l'importance") it may be the verb;
  // a "que" right after a verb opens an object clause instead ("je pense qu'il viendra a").
  const window = tokensBefore(ctx.text, m.index, 30);
  const completive = (k: number) =>
    (window[k].w === "que" || window[k].w === "qu'") &&
    !!window[k + 1] &&
    plainVerb(window[k + 1].w, isFinite);
  // "ce roman a vingt ans": "ce" before a noun is a determiner, not "ce qui", "ce doit".
  const determiner = (k: number) =>
    window[k].w === "ce" &&
    !!window[k - 1] &&
    !CLAUSE_SUBJECTS.has(window[k - 1].w) &&
    !readingsOf(window[k - 1].w).some(isFinite);
  if (window.some((t, k) => CLAUSE_SUBJECTS.has(t.w) && !completive(k) && !determiner(k)))
    return null;
  if (SUBJECT_PRONOUNS.has(previous.w) || CLITICS.has(previous.w)) return null;
  // "elle est contente a l'idée": an attribute adjective after être.
  if (attributeBefore(before) && startsNounPhrase(ctx.text, next)) return fix(previous);
  // "une boîte a outils", "la râpe a fromage": a noun, then a bare noun avoir takes in no
  // locution ("le chat a faim", "la séance a lieu").
  if (bareNounAfterNoun(ctx.text, previous, next, after[1])) return fix(previous);
  // A name before it is the subject ("Maria a"), and only a noun phrase may follow the
  // preposition ("a et b", "a donc refusé" are the letter and the verb).
  // "Pensez a lui": a verb opening the sentence is no name.
  const opening = (t: Token) => sentenceStart(ctx.text, t.start) && readingsOf(t.w).length > 0;
  if (/^\p{Lu}/u.test(ctx.text.slice(previous.start, previous.end)) && !opening(previous))
    return null;
  if (!startsNounPhrase(ctx.text, next)) return null;
  // "je laisse cela a votre jugement", "porte les sacs a l'étage", "je suis a Montréal": the
  // clause already has its verb, so "a" is no second one.
  const clause = tokensBefore(ctx.text, m.index, 12);
  const joined = clause.findIndex((t) => CONJUNCTIONS.has(t.w));
  const own = joined < 0 ? clause : clause.slice(0, joined);
  // A form also spelled by a noun is the verb right after a subject pronoun ("je laisse") or
  // opening the sentence as an imperative ("Porte les sacs", "Attache la corde").
  const finiteVerb = (t: Token) =>
    readingsOf(t.w).some((r) => isFinite(r) && r.lemma !== "avoir" && r.lemma !== "être");
  // "j'ai peu d'argent a la fin", "il est a la gare", "il y a quelqu'un a la porte": être or
  // avoir right after its subject pronoun (past object pronouns and "ne") is the clause's verb.
  const pronounSubject = (i: number) => {
    let k = i + 1;
    while (own[k] && (CLITICS.has(own[k].w) || own[k].w === "ne" || own[k].w === "n'")) k++;
    const subject = own[k];
    return !!subject &&
      SUBJECT_PRONOUNS.has(subject.w) &&
      subject.w !== "nous" &&
      subject.w !== "vous"
      ? k === i + 1 || own.slice(i + 1, k).every((t) => t.w !== subject.w)
      : false;
  };
  const verb = own.find((t, i) => {
    if (isAuxiliary(t.w) && /^\p{Ll}/u.test(ctx.text[t.start]) && pronounSubject(i))
      return i > 0 || readingsOf(t.w).some((r) => r.lemma === "être");
    if (i === 0) return false;
    const capital = /^\p{Lu}/u.test(ctx.text.slice(t.start, t.end));
    if (capital && !opening(t)) return false;
    if (plainVerb(t.w, (r) => isFinite(r) && r.lemma !== "avoir")) return true;
    if (!finiteVerb(t)) return false;
    const subject = own[i + 1];
    if (subject && SUBJECT_PRONOUNS.has(subject.w) && subject.w !== "nous" && subject.w !== "vous")
      return true;
    // An imperative takes its object right after it: "Porte les sacs", not "Chambre à coucher".
    const object = own[i - 1];
    return (
      i === own.length - 1 &&
      capital &&
      sentenceStart(ctx.text, t.start) &&
      (DETERMINERS.has(object.w) || ["ceci", "cela", "ça", "moi", "lui"].includes(object.w))
    );
  });
  // "quel âge a Tom": an inverted subject after "quel".
  const asked = own.some((t) => /^quel(?:le)?s?$/.test(t.w));
  // "il y a quelqu'un a la porte": "il y a" is the clause's verb.
  const ilYA = !!verb && verb.w === "a" && own[own.indexOf(verb) + 1]?.w === "y";
  if (verb && !asked && (ilYA || !own.some((t) => t.w === "y"))) return fix(verb);
  // A finite verb with its subject: "il pense a sa mère".
  if (
    plainVerb(previous.w, (r) => isFinite(r) && r.lemma !== "avoir" && r.lemma !== "être") &&
    !isParticiple(next.w)
  )
    return fix(previous);
  // A participle after its auxiliary: "j'ai répondu a ta lettre", "elle est partie a la poste".
  if (readingsOf(previous.w).some((r) => r.slot === "Q")) {
    let k = 1;
    // "ils ont été admis a l'école": a passive's "été" before the participle.
    while (before[k] && (ADVERBS.has(before[k].w) || before[k].w === "été")) k++;
    const auxiliary = before[k];
    if (auxiliary && /^\p{Ll}/u.test(ctx.text[auxiliary.start]) && isAuxiliary(auxiliary.w))
      return fix(previous);
  }
  // An infinitive governed by a finite verb: "il faut parler a ta mère". After a preposition
  // the infinitive may close a subject ("le droit de voter a le droit").
  if (readingsOf(previous.w).some((r) => r.slot === "I" && r.lemma === previous.w)) {
    let k = 1;
    while (before[k] && (CLITICS.has(before[k].w) || ADVERBS.has(before[k].w))) k++;
    const head = before[k];
    if (head && plainVerb(head.w, isFinite)) return fix(previous);
  }
  return null;
}

const PLACE_TIME_NOUNS = new Set(
  (
    "jour jours fois moment moments instant endroit endroits lieu lieux pays ville villes époque " +
    "année années mois semaine soir matin période cas heure maison région monde situation " +
    "hypothèse point état temps nuit soirée journée an siècle âge quartier village pièce chambre " +
    "site page ferme"
  ).split(" "),
);
const ASKING_VERBS = new Set(["savoir", "demander", "indiquer", "montrer", "ignorer", "expliquer"]);
// Places a relative "où" names, with or without a determiner.
const PLACES = new Set(
  "endroit lieu pays ville villes maison région quartier village ferme pièce chambre".split(" "),
);
// Verbs a "where?" follows at the end of a question: "tu vas où ?", "il est où ?".
const WHERE_VERBS = new Set(["être", "aller", "habiter"]);
const DEFINITE = new Set("le la l' les ce cet cette ces".split(" "));
const NUMBERS =
  /^(?:\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|cent|mille)$/;

/** "le jour ou il", "je sais ou aller", "Ou sont-ils ?": "where", not "or". */
function ouToOu(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 3);
  const rest = ctx.text.slice(m.index + m[0].length);
  const fix = () =>
    wordFinding(ctx, m.index, m[0], ["où"], RULE, MESSAGE, {
      start: before[0]?.start ?? m.index,
      end: after[0]?.end ?? m.index + m[0].length,
    });
  const next = after[0];
  const startsClause = (t: Token | undefined) =>
    !!t && (SUBJECT_PRONOUNS.has(t.w) || t.w === "c'" || (t.w === "l'" && after[1]?.w === "on"));
  // "Et ou est le métro ?", "Alors, ou se trouve le chalet ?": a question's first word past "et",
  // "mais" or "alors".
  const opener = before.every((t) => ["et", "mais", "alors"].includes(t.w));
  const afterComma = /(?:^|[.!?…]\s{0,8})(?:Et|Mais|Alors)\s{0,8},\s{0,8}$/u.test(
    ctx.text.slice(Math.max(0, m.index - 16), m.index),
  );
  const startOfQuestion =
    m[0] === "Ou" ? sentenceStart(ctx.text, m.index) : (before.length > 0 && opener) || afterComma;
  if (m[0] === "Ou" || startOfQuestion) {
    // "Ou sont mes clés ?": a question opened by "Ou" and a verb.
    const sentence = rest.split(/[.!…\n]/)[0];
    if (!startOfQuestion || !sentence.includes("?") || !next) return null;
    // "Ou serait-ce l'inverse ?": an inversion right after it is "or", unless an infinitive
    // follows ("Ou pourrons-nous aller ?").
    const infinitive = after[2] && readingsOf(after[2].w).some((r) => r.slot === "I");
    if (next.hyphen) return infinitive ? fix() : null;
    if (next.w === "se" || next.w === "s'") return fix();
    return plainVerb(next.w, isFinite) || next.w === "est" ? fix() : null;
  }
  const previous = before[0];
  if (!previous) return null;
  // "Tu vas ou demain ?", "Il est ou Marc ?", "par ou ?": where, in a question after être, aller
  // or a preposition.
  const question = /^[^.!?…\n]{0,30}\?/u.test(rest);
  const where =
    readingsOf(previous.w).some((r) => isFinite(r) && WHERE_VERBS.has(r.lemma)) ||
    previous.w === "par";
  // "Tu viens ou pas ?", "tu es là ou tu pars ?": "or".
  const or =
    next &&
    (["pas", "non", "bien", "alors", "quoi", "plutôt", "si"].includes(next.w) ||
      startsClause(next) ||
      readingsOf(next.w).some(isFinite));
  if (question && where && !or) return fix();
  // "la maison ou Marie est née", "pays ou le temps est doux": a name or a noun phrase and its
  // verb open the clause too.
  const opensClause =
    startsClause(next) ||
    (!!next &&
      ((/^\p{Lu}\p{Ll}/u.test(ctx.text.slice(next.start, next.end)) &&
        !!after[1] &&
        readingsOf(after[1].w).some(isFinite)) ||
        (DEFINITE.has(next.w) && !!after[2] && readingsOf(after[2].w).some(isFinite))));
  if (PLACE_TIME_NOUNS.has(previous.w) && opensClause) {
    // "le jour ou la nuit" is "or"; a determiner before the noun keeps it a noun.
    // "un mois ou je m'abonne": only a definite noun is a time or place being named.
    // "la seule fois ou il", "des temps ou il": past an adjective, or the plural "des".
    let d = 1;
    const article = (t?: Token) => !!t && (DETERMINERS.has(t.w) || t.w === "un" || t.w === "une");
    if (before[d] && !article(before[d]) && adjectiveReadings(before[d].w).length) d++;
    if (before[d] && (DEFINITE.has(before[d].w) || before[d].w === "des")) return fix();
    // "une ville ou il fait bon vivre", "Pays ou il fait beau": a place, named or not.
    // "une maison ou tu préfères un appartement ?" offers a choice: not in a question.
    const place = PLACES.has(previous.w) && !/^[^.!…\n]*\?/u.test(rest);
    if (place && (!before[d] || ["un", "une"].includes(before[d].w))) return fix();
  }
  // "va ou tu veux", "restez ou vous êtes.": "where" before a clause that ends on vouloir or
  // être.
  if (next && SUBJECT_PRONOUNS.has(next.w) && after[1] && !after[1].hyphen) {
    const lemmas = readingsOf(after[1].w)
      .filter(isFinite)
      .map((r) => r.lemma);
    const closes = /^\s{0,8}(?:[.!?…;,]|$)/u.test(ctx.text.slice(after[1].end, after[1].end + 10));
    if (closes && (lemmas.includes("vouloir") || lemmas.includes("être"))) return fix();
  }
  let k = 0;
  while (before[k] && ["pas", "jamais", "ne", "n'"].includes(before[k].w)) k++;
  // "je ne sais pas ou aller", "dis-moi ou tu vas".
  // "dire" only with its object ("dis-moi ou"): "on dit ou on écrit" is "or".
  const imperative = before[k]?.w === "moi" && ctx.text[before[k].start - 1] === "-";
  const asking = imperative ? before[k + 1] : before[k];
  if (
    asking &&
    readingsOf(asking.w).some(
      (r) => ASKING_VERBS.has(r.lemma) || (imperative && r.lemma === "dire"),
    ) &&
    next &&
    (startsClause(next) ||
      readingsOf(next.w).some((r) => r.slot === "I") ||
      next.w === "se" ||
      next.w === "s'")
  )
    return fix();
  // "je ne vois pas ou aller": "voir" before an infinitive.
  if (
    asking &&
    readingsOf(asking.w).some((r) => r.lemma === "voir") &&
    next &&
    readingsOf(next.w).some((r) => r.slot === "I" && r.lemma === next.w)
  )
    return fix();
  // "Tu vas ou ?", "Ils partent ou demain ?".
  if (/^[\s  ]*\?/u.test(rest) && readingsOf(previous.w).some(isFinite)) return fix();
  return null;
}

/** "deux où trois", "tu viens où pas ?": "or". */
function ouGraveToOu(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 2);
  const previousNumber =
    NUMBERS.test(before[0]?.w ?? "") ||
    /\d[ \t\u00a0]{0,8}$/.test(ctx.text.slice(Math.max(0, m.index - 9), m.index));
  const nextNumber =
    NUMBERS.test(after[0]?.w ?? "") ||
    /^[ \t\u00a0]{0,8}\d/.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 9));
  const negation =
    (after[0]?.w === "pas" || after[0]?.w === "non") &&
    /^[\s  ]*[?!.]/u.test(ctx.text.slice(after[0].end));
  if (!(previousNumber && nextNumber) && !negation) return null;
  return wordFinding(ctx, m.index, m[0], ["ou"], RULE, MESSAGE);
}

/** "se renseigner sûr les prix": the preposition. */
function surGraveToSur(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  if (!next || !DETERMINERS.has(next.w) || next.w === "du" || next.w === "des") return null;
  const previous = before[0];
  if (
    !previous ||
    ["coup", "bien", "pas", "si", "très", "trop", "assez", "aussi", "plus", "tout"].includes(
      previous.w,
    )
  )
    return null;
  if (
    isAuxiliary(previous.w) ||
    readingsOf(previous.w).some((r) =>
      ["sembler", "paraître", "rester", "devenir", "sentir"].includes(r.lemma),
    )
  )
    return null;
  if (!plainVerb(previous.w, () => true)) return null;
  return wordFinding(ctx, m.index, m[0], ["sur"], RULE, MESSAGE, {
    start: previous.start,
    end: next.end,
  });
}

// Verbs whose attribute "sûr" may be: "être sûr", "se sentir sûr", "paraître sûr".
const LINKING = new Set(["être", "sentir", "sembler", "paraître", "devenir", "rester", "demeurer"]);
const DEGREE_ADVERBS = new Set(
  "peu si très trop assez absolument tout fait complètement totalement parfaitement plutôt".split(
    " ",
  ),
);

/** "c'est sur on viendra", "c'est sur vous allez gagner": a clause after "c'est sûr"; "c'est sur
 * elle que" is the preposition in a cleft. */
function clauseAfterSur(after: Token[]): boolean {
  const [pronoun, verb] = after;
  if (!pronoun || !SUBJECT_PRONOUNS.has(pronoun.w)) return false;
  if (["je", "tu", "il", "on", "ils"].includes(pronoun.w)) return true;
  return !!verb && plainVerb(verb.w, isFinite);
}

/** "la sur consommation": the prefix of a word written apart ("surconsommation"). */
const prefixed = (word: string) =>
  isInflectedNoun(`sur${word}`) ||
  readingsOf(`sur${word}`).length > 0 ||
  isDictionaryCompound(`sur-${word}`);

/** "il est sur d'arriver", "bien sur.": certain. */
function surToSur(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 2);
  const rest = ctx.text.slice(m.index + m[0].length);
  const fix = () => wordFinding(ctx, m.index, m[0], [m[0].replace("u", "û")], RULE, MESSAGE);
  // "Bien sur." / "bien sur !": nothing for the preposition to govern.
  if (before[0]?.w === "bien" && /^\s{0,8}(?:[.!?…]|$)/u.test(rest.slice(0, 10))) return fix();
  // "il est bien sur très grand": "bien sûr" before an adverb, a pronoun or "que", where the
  // preposition would need a noun phrase.
  const next = after[0];
  if (before[0]?.w === "bien" && m[0].length === 3) {
    if (next && ["très", "pas", "que", "qu'", "il", "je", "on", "ils"].includes(next.w))
      return fix();
  }
  // "nous sommes surs", "en êtes-vous surs ?", "nous nous sentions toujours surs": the
  // preposition has no plural; only "des pommes sures" (sour) follows a noun.
  const words = tokensBefore(ctx.text, m.index, 5);
  const k = words.findIndex((t) => !ADVERBS.has(t.w) && !DEGREE_ADVERBS.has(t.w));
  const head = words[k];
  if (/^(?:surs|sures)$/i.test(m[0])) {
    if (!head) return null;
    const linking = readingsOf(head.w).some((r) => LINKING.has(r.lemma));
    // "êtes-vous surs": the inverted subject after its verb.
    const inverted =
      SUBJECT_PRONOUNS.has(head.w) && ctx.text[head.start - 1] === "-" && words[k + 1];
    if (linking || (inverted && readingsOf(words[k + 1].w).some((r) => LINKING.has(r.lemma))))
      return fix();
    if (
      !nounGender(head.w) &&
      !nounGender(head.w.replace(/[sx]$/, "")) &&
      !isInflectedNoun(head.w.replace(/[sx]$/, ""))
    )
      return fix();
    return null;
  }
  // "c'est peu sur.", "en est-il sur ?", "il n'est pas sur car": nothing after the preposition.
  const ends = /^[ \t]{0,4}(?:[.!?…:;,]|$|(?:car|mais|et certaine?s?)(?![\p{L}\p{M}]))/u.test(
    rest.slice(0, 8),
  );
  if (ends && head && m[0].length === 3) {
    const inverted =
      SUBJECT_PRONOUNS.has(head.w) && ctx.text[head.start - 1] === "-" && words[k + 1];
    const verb = inverted ? words[k + 1] : head;
    if (readingsOf(verb.w).some((r) => LINKING.has(r.lemma) && typeof r.slot === "number"))
      return fix();
  }
  // "C'est sur, on viendra", "c'est sur qu'il viendra": a clause or "que" after "c'est sûr".
  if (
    before[0]?.w === "est" &&
    before[1]?.w === "c'" &&
    (!next || clauseAfterSur(after) || next.w === "que" || next.w === "qu'" || ends)
  )
    return fix();
  // "Vous pouvez bien sur avoir": "bien sûr" before an infinitive the preposition never takes.
  const infinitive = (t: Token) => readingsOf(t.w).some((r) => r.slot === "I" && r.lemma === t.w);
  if (before[0]?.w === "bien" && next && infinitive(next)) return fix();
  // "un sur abri", "le plus sur moyen": the adjective between a determiner and its noun.
  const det = before[0] && ["plus", "moins"].includes(before[0].w) ? before[1] : before[0];
  if (det && ["un", "une", "le", "la", "les", "des", "ce", "cet", "cette", "ces"].includes(det.w)) {
    const noun = next && (nounGender(next.w) || isInflectedNoun(next.w.replace(/[sx]$/, "")));
    if (noun && !next.hyphen && !infinitive(next) && !prefixed(next.w)) return fix();
  }
  // "il est sur d'arriver": être + sur + de + infinitive.
  if (
    before[0] &&
    isAuxiliary(before[0].w) &&
    readingsOf(before[0].w).some((r) => r.lemma === "être") &&
    (after[0]?.w === "de" || after[0]?.w === "d'") &&
    after[1] &&
    isInfinitive(after[1].w)
  )
    return fix();
  return null;
}

// Words before an infinitive that governs it: "de se placer", "pour se lancer", "doit se lever".
const INFINITIVE_GOVERNORS = new Set("de d' pour sans à par".split(" "));

/** "il ce lève", "qui ce cache", "de ce placer", "en ce parlant": the reflexive pronoun. */
function ceToSe(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 3);
  const [next, after, third] = tokensAfter(ctx.text, m.index + m[0].length, 3);
  if (!next) return null;
  const fix = (from: Token | undefined) =>
    wordFinding(ctx, m.index, m[0], ["se"], RULE, MESSAGE, {
      start: from?.start ?? m.index,
      end: next.end,
    });
  // "Ce sont répondu", "Ce sont-ils répondu ?": "sont" with a participle is reflexive.
  if (next.w === "sont" && (!before.length || CONJUNCTIONS.has(before[0].w))) {
    const participle = next.hyphen && after && ["ils", "elles"].includes(after.w) ? third : after;
    return participle && participleOnly(participle.w) && !isVerbHomograph(participle.w)
      ? fix(undefined)
      : null;
  }
  if (next.hyphen) return null;
  // "Ce promener est relaxant": an infinitive opening the sentence is reflexive.
  if (
    !before.length &&
    sentenceStart(ctx.text, m.index) &&
    readingsOf(next.w).some((r) => r.slot === "I" && r.lemma === next.w) &&
    !NOUN_INFINITIVES.has(next.w) &&
    next.w !== "faire" &&
    after &&
    !DETERMINERS.has(after.w)
  )
    return fix(undefined);
  // "Ce phénomène ce transforme": a noun subject opening its clause, then its verb.
  const [b0, b1, b2] = before;
  if (
    b0 &&
    b1 &&
    DETERMINERS.has(b1.w) &&
    (!b2 || CONJUNCTIONS.has(b2.w)) &&
    (nounGender(b0.w) || isInflectedNoun(b0.w)) &&
    !readingsOf(b0.w).some(isFinite) &&
    (plainVerb(next.w, (r) => isFinite(r) && r.lemma !== "être") ||
      (readingsOf(next.w).some((r) => isFinite(r) && r.lemma === "être") &&
        !!after &&
        participleOnly(after.w) &&
        !isVerbHomograph(after.w)))
  )
    return fix(b0);
  let i = 0;
  if (before[0]?.w === "ne" || before[0]?.w === "n'") i = 1;
  const subject = before[i];
  if (subject && ["il", "elle", "on", "ils", "elles"].includes(subject.w)) {
    if (ctx.text[subject.start - 1] === "-") return null;
    return plainVerb(next.w, isFinite) ? fix(subject) : null;
  }
  const previous = before[0];
  // An infinitive after a preposition or a verb: "pour ce lancer", "il devrait ce placer". "Pour
  // ce faire," (to do so) keeps its "ce".
  const infinitive =
    readingsOf(next.w).some((r) => r.slot === "I" && r.lemma === next.w) &&
    !NOUN_INFINITIVES.has(next.w) &&
    !["lever", "coucher", "toucher", "parler", "devenir", "souvenir"].includes(next.w);
  if (infinitive && previous) {
    // "Pour ce faire, il faut un algorithme": the idiom, unless "faire" takes an infinitive or an
    // attribute ("pour se faire pardonner", "pour se faire belle").
    const reflexiveFaire =
      !!after &&
      !DETERMINERS.has(after.w) &&
      (readingsOf(after.w).some((r) => r.slot === "I" || r.slot === "Q") ||
        adjectiveReadings(after.w).length > 0);
    const idiom = next.w === "faire" && previous.w === "pour" && !reflexiveFaire;
    const governor =
      INFINITIVE_GOVERNORS.has(previous.w) ||
      (plainVerb(previous.w, isFinite) && !isAuxiliary(previous.w));
    return governor && !idiom ? fix(previous) : null;
  }
  // "en ce parlant": a present participle.
  if (previous?.w === "en" && readingsOf(next.w).some((r) => r.slot === "G")) return fix(previous);
  // "qui ce cache", "cela ce passe": after a subject pronoun a verb follows, never a noun.
  if (previous && ["qui", "cela", "ça"].includes(previous.w)) {
    const third = readingsOf(next.w).some((r) => isFinite(r) && (r.slot as number) & IL);
    // "qui ce type pouvait être", "c'est qui ce type ?": a noun the verb or the question follows.
    const noun =
      isVerbHomograph(next.w) &&
      (!after ||
        readingsOf(after.w).some(isFinite) ||
        /^[\s\u00a0]*[?!.…]/u.test(ctx.text.slice(next.end, next.end + 3)));
    if (third && !noun && !DETERMINERS.has(after?.w ?? "")) return fix(previous);
  }
  return null;
}

/** "Il c'en rend compte", "elle c'est trompée", "ne c'était": the reflexive "s'". */
function cToS(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 1);
  const subject = before[0];
  const elided = m[0].slice(0, 2);
  const word = m[0].slice(2).toLowerCase();
  // "Il part c'être retourné": "être" never follows "ce".
  if (word === "être")
    return wordFinding(
      ctx,
      m.index,
      elided,
      [`${elided[0] === "C" ? "S" : "s"}${elided[1]}`],
      RULE,
      MESSAGE,
      {
        start: m.index,
        end: m.index + m[0].length,
      },
    );
  // "c'est maisons sont à vendre": "ces" before a plural noun and its verb.
  if (word === "est") {
    const [noun, verb] = tokensAfter(ctx.text, m.index + m[0].length, 2);
    if (
      noun &&
      verb &&
      /[sx]$/.test(noun.w) &&
      ctx.text.slice(noun.start, noun.end) === noun.w &&
      !adjectiveReadings(noun.w).length &&
      !readingsOf(noun.w).length &&
      (nounGender(noun.w.slice(0, -1)) || isInflectedNoun(noun.w.slice(0, -1))) &&
      plainVerb(verb.w, (r) => isFinite(r) && ((r.slot as number) & ILS) > 0)
    )
      return wordFinding(ctx, m.index, m[0], [carryCase(m[0], "ces")], RULE, MESSAGE, {
        start: m.index,
        end: verb.end,
      });
  }
  if (!subject || ctx.text[subject.start - 1] === "-") return null;
  if (!["il", "elle", "on", "ils", "elles", "ne", "n'"].includes(subject.w)) return null;
  return wordFinding(
    ctx,
    m.index,
    elided,
    [`${elided[0] === "C" ? "S" : "s"}${elided[1]}`],
    RULE,
    MESSAGE,
    {
      start: subject.start,
      end: m.index + m[0].length,
    },
  );
}
const C_ELIDED = /(?<![\p{L}\p{M}\p{N}_'’-])[cC]['’](?=\p{L})\p{L}+/gu;

const ETRE_THIRD = new Set(["sont", "sera", "serait", "seront", "seraient", "fut", "furent"]);

/** "Se sont des histoires", "car se sera difficile": "ce" with no subject before. */
function seToCe(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  const [next, complement] = tokensAfter(ctx.text, m.index + m[0].length, 2);
  // "Pour se faire, il faudra…": the idiom "pour ce faire" (to do so) before a comma.
  if (
    before[0]?.w === "pour" &&
    next?.w === "faire" &&
    /^[\s\u00a0]*,/u.test(ctx.text.slice(next.end, next.end + 4))
  )
    return wordFinding(ctx, m.index, m[0], ["ce"], RULE, MESSAGE, {
      start: before[0].start,
      end: next.end,
    });
  if (!next || !ETRE_THIRD.has(next.w) || next.hyphen) return null;
  // A sentence start (or "car"): after a comma or "mais" the subject may be left out
  // ("les musiciens se séparent, mais se sont réunis").
  if (before.length ? before[0].w !== "car" : !sentenceStart(ctx.text, m.index)) return null;
  // "ce sont des", "ce sera une": a noun phrase follows; "se serait un jour exclamé" is not.
  if (!complement || !DETERMINERS.has(complement.w)) return null;
  const rest = tokensAfter(ctx.text, complement.end, 3);
  if (rest.some((t) => readingsOf(t.w).some((r) => r.slot === "Q") && !isVerbHomograph(t.w)))
    return null;
  return wordFinding(ctx, m.index, m[0], ["ce"], RULE, MESSAGE, {
    start: m.index,
    end: next.end,
  });
}

/** "S'est bien de venir", "Dépêche-toi, s'est urgent": "c'est" with no subject before. */
function sEstToCEst(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  // "ce que s'est dit Leo" inverts the subject: only a sentence start or a comma has none.
  const comma = /,[\s\u00a0]{0,8}$/u.test(ctx.text.slice(Math.max(0, m.index - 9), m.index));
  if (before.length || !(sentenceStart(ctx.text, m.index) || comma)) return null;
  if (/^[-–]/.test(ctx.text.slice(m.index + m[0].length))) return null;
  // "S'est dit aussi de…": a reflexive verb whose subject the fragment leaves out.
  // "S'était une première fois illustré": a participle a few words on.
  const after = tokensAfter(ctx.text, m.index + m[0].length, 4);
  const participle = (t: Token) =>
    readingsOf(t.w).some((r) => r.slot === "Q") &&
    (!isVerbHomograph(t.w) || /é(?:e|s|es)?$/.test(t.w));
  const relative = after.findIndex((t) => ["qui", "que", "qu'"].includes(t.w));
  if (after.slice(0, relative < 0 ? undefined : relative).some(participle)) return null;
  const next = after[0];
  if (next && readingsOf(next.w).some((r) => r.slot === "Q")) return null;
  const elided = m[0].slice(0, 2);
  return wordFinding(ctx, m.index, elided, [`c${elided[1]}`], RULE, MESSAGE, {
    start: m.index,
    end: m.index + m[0].length,
  });
}

// "sa" is a possessive: it never stands before these, or at a clause end.
const NOT_AFTER_POSSESSIVE = new Set(
  "pour que qu' à avec comme et ou mais alors donc quand si là ici aussi encore non oui pas".split(
    " ",
  ),
);

/** "il a dit sa pour rire", "comme sa.": the pronoun "ça". */
function saToCa(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const rest = ctx.text.slice(m.index + m[0].length);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  // "à sa faire des amis": the possessive never stands before an infinitive; "se" does.
  if (next && !next.hyphen && isInfinitive(next.w) && next.w !== "devoir" && !nounGender(next.w))
    return wordFinding(ctx, m.index, m[0], ["se"], RULE, MESSAGE);
  const final = /^[\s  ]*(?:[.!?…,;:)]|$)/u.test(rest);
  if (!final && !(next && !next.hyphen && NOT_AFTER_POSSESSIVE.has(next.w))) return null;
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  if (!before && !final) return null;
  // "sa : 8h-12h": an abbreviated Saturday in opening hours.
  if (!before && /^[\s ]*:/u.test(rest)) return null;
  return wordFinding(ctx, m.index, m[0], ["ça"], RULE, MESSAGE);
}

/** "il ma dit", "je la vu", "tu ta trompé": the pronoun and the auxiliary run together. */
function elidedAuxiliary(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 1);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  const subject = before[0];
  if (!subject || !next || ctx.text[subject.start - 1] === "-") return null;
  const word = m[0].toLowerCase();
  const person =
    subject.w === "je"
      ? JE
      : subject.w === "tu"
        ? TU
        : ["il", "elle", "on", "qui", "ça", "cela"].includes(subject.w)
          ? IL
          : 0;
  if (!person) return null;
  const readings = readingsOf(next.w);
  if (!readings.some((r) => r.slot === "Q")) return null;
  // "il la dit", "elle la fait": a finite verb after the object pronoun.
  if (word === "la" && readings.some((r) => isFinite(r) && (r.slot as number) & person))
    return null;
  const auxiliary = person === JE ? "ai" : person === TU ? "as" : "a";
  if (word === "ma" && person === JE) return null;
  const fixed = `${word[0]}'${auxiliary}`;
  return wordFinding(ctx, m.index, m[0], [fixed], RULE, MESSAGE, {
    start: subject.start,
    end: next.end,
  });
}

const PREPOSITIONS = new Set(
  "de à avec pour dans par sur sous chez sans selon depuis pendant malgré".split(" "),
);

const PLURAL_DETERMINERS = new Set("les des ces mes tes ses nos vos leurs".split(" "));

/** "les épaules son larges": "sont" after a plural noun subject, before what is no noun. */
/** Participles no finite form spells: "fui", "parlé", not "fait". */
const participleOnly = (word: string) =>
  readingsOf(word).length > 0 && readingsOf(word).every((r) => r.slot === "Q");

// After "ce", words that open a plural noun phrase: "ce sont les enfants".
const CE_SONT_NEXT = new Set("les mes tes ses nos vos leurs eux elles".split(" "));
// Plural pronoun subjects: "certains son partis".
const PLURAL_SUBJECTS = new Set("ils elles certains certaines plusieurs toutes".split(" "));

/** "les enfants son là", "ce son eux": the evidence that the "son" at `index` is "sont", or
 * null. The noun checks skip such a "son": it is no determiner. */
export function sontForSon(text: string, index: number): { start: number; end: number } | null {
  const before = tokensBefore(text, index, 4);
  const next = tokensAfter(text, index + 3, 1)[0];
  // "Ce son des enfants", "ce son eux": "ce sont" before a plural noun phrase.
  if (before[0]?.w === "ce" && !before[1] && next && CE_SONT_NEXT.has(next.w))
    return { start: before[0].start, end: next.end };
  // "les personnes invitées son là": an adjective or participle may follow the noun.
  const plural = (t?: Token) => !!t && /[sx]$/.test(t.w);
  // "des personnes qui son là": "qui" after a plural noun.
  const relative =
    before[0]?.w === "qui" &&
    plural(before[1]) &&
    !!before[2] &&
    PLURAL_DETERMINERS.has(before[2].w);
  let h = 0;
  if (plural(before[0]) && plural(before[1]) && participleOnly(before[0].w)) h = 1;
  const det = relative ? before[2] : before[h + 1];
  const pronoun = h === 0 && PLURAL_SUBJECTS.has(before[0]?.w ?? "") && !det;
  if (!pronoun && !relative) {
    if (!det || !(PLURAL_DETERMINERS.has(det.w) || NUMBERS.test(det.w)) || !plural(before[h]))
      return null;
    if (before[h + 2] && !CONJUNCTIONS.has(before[h + 2].w)) return null;
  }
  if (!next || next.hyphen || /^\p{Lu}/u.test(text[next.start])) return null;
  const predicate =
    adjectiveReadings(next.w).length ||
    readingsOf(next.w).some((r) => r.slot === "Q") ||
    ADVERBS.has(next.w) ||
    next.w === "là" ||
    next.w === "ici";
  // "son" never stands before a plural: "les épaules son larges", "les enfants son partis" (not
  // the noun "partis"); a noun spelled alike in the singular ("son bras") may be its noun.
  const nounLike = nounGender(next.w) || (!predicate && nounGender(next.w.replace(/[sx]$/, "")));
  if (nounLike || (!predicate && !/[sx]$/.test(next.w))) return null;
  return { start: (det ?? before[0]).start, end: next.end };
}

function sonToSont(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const context = sontForSon(ctx.text, m.index);
  return context && wordFinding(ctx, m.index, m[0], ["sont"], RULE, MESSAGE, context);
}

/** "ceux qui on fait", "les habitants on parlé": "ont" before a participle. */
function onToOnt(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 6);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 3);
  const word = after[after[0] && ADVERBS.has(after[0].w) ? 1 : 0];
  // "ceux-ci on 18 ans": a number, an object no verb comes before.
  const number = /^[ \t]{1,4}\d/.test(ctx.text.slice(m.index + 2, m.index + 8));
  if (!word && !number) return null;
  // "on mangé", "on mis", "on été": a participle "on" cannot take as its verb; "on du lait",
  // "on les plus belles maisons": an object with no verb before it.
  const participle =
    !!word &&
    ((participleOnly(word.w) && !isVerbHomograph(word.w)) ||
      word.w === "été" ||
      (readingsOf(word.w).some((r) => r.slot === "Q") && !(finitePersons(word.w) & IL)));
  const next = after[1]?.w ?? "";
  const object =
    number ||
    (word === after[0] &&
      (["du", "des", "un", "une", "de", "d'", "leurs", "ses"].includes(word.w) ||
        (word.w === "les" &&
          (["plus", "moins", "mêmes"].includes(next) || !readingsOf(next).some(isFinite)))));
  const previous = before[0];
  if (!previous || previous.hyphen) return null;
  // "à qui on parle": after a preposition "qui on" is a clause of its own.
  const relative =
    previous.w === "qui" && !(before[1] && (PREPOSITIONS.has(before[1].w) || before[1].w === "à"));
  // "ceux qui on fait ça", "des gens qui on beaucoup d'esprit": after a plural noun or pronoun, "qui"
  // is the subject, so any participle or object is the verb's ("je sais qui on fait venir" asks).
  const antecedent =
    relative &&
    !!before[1] &&
    /[sx]$/.test(before[1].w) &&
    !readingsOf(before[1].w).some(isFinite) &&
    !!word;
  const loose =
    antecedent &&
    (readingsOf(word.w).some((r) => r.slot === "Q") ||
      ["du", "des", "de", "d'", "un", "une"].includes(word.w));
  if (!participle && !object && !loose) return null;
  if (!relative && !pluralSubjectEnds(ctx.text, before)) return null;
  return wordFinding(ctx, m.index, m[0], ["ont"], RULE, MESSAGE, {
    start: previous.start,
    end: word?.end ?? m.index + 2,
  });
}

const QUANTITY_WORDS = new Set("beaucoup peu trop tant assez plupart".split(" "));
const capitalized = (text: string, t: Token) => /^\p{Lu}\p{Ll}/u.test(text.slice(t.start, t.end));

/** Whether the words before (nearest first) end a plural subject opening its clause: "les
 * vaches", "beaucoup de chrétiens", "les enfants de Marine", "Tom et Marie", "ceux-ci". */
function pluralSubjectEnds(text: string, before: Token[]): boolean {
  const [b0, b1, b2] = before;
  if (!b0) return false;
  const opens = (i: number) => !before[i] || CONJUNCTIONS.has(before[i].w);
  // "ceux-ci on", "celles-là on".
  if (
    /^ce(?:ux|lles)-(?:ci|là)$/.test(b0.w) ||
    ((b0.w === "ci" || b0.w === "là") && /^ce(?:ux|lles)$/.test(b1?.w ?? ""))
  )
    return true;
  if (b1?.w === "et" && b2 && capitalized(text, b0) && capitalized(text, b2)) return opens(3);
  if (!/[sx]$/.test(b0.w) && !(b1?.w === "de" && capitalized(text, b0))) return false;
  // "les enfants de Marine on": past a name complement.
  let k = 0;
  if (b1?.w === "de" && capitalized(text, b0) && b2 && /[sx]$/.test(b2.w)) k = 2;
  const head = before[k];
  const det = before[k + 1];
  if (!head || !/[sx]$/.test(head.w) || !det) return false;
  if (PLURAL_DETERMINERS.has(det.w)) return opens(k + 2);
  // "beaucoup de chrétiens on".
  if ((det.w === "de" || det.w === "d'" || det.w === "des") && before[k + 2])
    return QUANTITY_WORDS.has(before[k + 2].w) && opens(k + 3);
  return false;
}

/** "Ils non plus de lait", "ces propos non pas de sens": "n'ont" before a negation. */
function nonToNont(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 6);
  const [negation, next] = tokensAfter(ctx.text, m.index + m[0].length, 2);
  if (!negation || !["pas", "plus", "jamais", "rien", "guère"].includes(negation.w) || !next)
    return null;
  // "eux non plus", "les filles non pas les garçons": a contrast, not a verb.
  const follows =
    next.w === "de" ||
    next.w === "d'" ||
    (participleOnly(next.w) && !isVerbHomograph(next.w)) ||
    next.w === "été" ||
    next.w === "pu" ||
    next.w === "eu";
  if (!follows) return null;
  const pronoun = ["ils", "elles"].includes(before[0]?.w ?? "") && !before[0].hyphen;
  if (!pronoun && !pluralSubjectEnds(ctx.text, before)) return null;
  return wordFinding(ctx, m.index, m[0], ["n'ont"], RULE, MESSAGE, {
    start: before[0].start,
    end: next.end,
  });
}

const DEGREE = new Set(["un", "très", "trop", "si", "assez", "petit", "bien"]);

/** "trop peut", "un peux", "il y a peut", "Peut d'amis": the adverb "peu". */
function peutToPeu(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 3);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  const rest = ctx.text.slice(m.index + m[0].length);
  // "peut-être", "peut être" (the adverb missing its hyphen).
  if (/^-/.test(rest) || next?.w === "être") return null;
  const final = /^[\s\u00a0]*(?:[.!?…,;:)]|$)/u.test(rest);
  // "quelqu'un peut", "l'un peut": the pronoun "un" is a subject.
  const pronounUn =
    before[0]?.w === "un" &&
    (/['’"]/.test(ctx.text[before[0].start - 1] ?? "") || /^quelqu/.test(before[1]?.w ?? ""));
  const degree =
    before[0] && DEGREE.has(before[0].w) && !pronounUn && !SUBJECT_PRONOUNS.has(before[1]?.w ?? "");
  const ilYA = before[0]?.w === "a" && before[1]?.w === "y" && final;
  const opening =
    !before.length && sentenceStart(ctx.text, m.index) && (next?.w === "de" || next?.w === "d'");
  if (!degree && !ilYA && !opening) return null;
  return wordFinding(ctx, m.index, m[0], ["peu"], RULE, MESSAGE);
}

/** "Ainsi, ont peut acheter": "on peut". */
function ontPeut(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const next = tokensAfter(ctx.text, m.index + m[0].length, 2);
  if (!["peut", "peux"].includes(next[0]?.w ?? "") || next[0].hyphen || next[1]?.w === "être")
    return null;
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  if (previous && SUBJECT_PRONOUNS.has(previous.w)) return null;
  return wordFinding(ctx, m.index, m[0], ["on"], RULE, MESSAGE, {
    start: m.index,
    end: next[0].end,
  });
}

/** "Il viendra quant ?", "quant viendras-tu ?": "when". */
function quantToQuand(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const rest = ctx.text.slice(m.index + m[0].length);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  const question = /^[\s\u00a0]*\?/u.test(rest);
  const inverted = next?.hyphen && readingsOf(next.w).some(isFinite);
  if (!question && !inverted) return null;
  return wordFinding(ctx, m.index, m[0], ["quand"], RULE, MESSAGE);
}

/** "Quand à moi", "Quand elle, elle est partie": "quant à". */
function quandToQuant(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const rest = ctx.text.slice(m.index + m[0].length);
  if (!/^[ \t]+(?:moi|toi|lui|elle|nous|vous|eux|elles)[ \t]*,/u.test(rest)) return null;
  if (!sentenceStart(ctx.text, m.index)) return null;
  const typed = ctx.text.slice(m.index, m.index + m[0].length);
  return wordFinding(ctx, m.index, typed, ["quant à"], RULE, MESSAGE);
}

/** "C'est la que", "il est la.": the adverb "là". */
function laToLa(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const rest = ctx.text.slice(m.index + m[0].length);
  const before = tokensBefore(ctx.text, m.index, 2);
  const cEst = before[0]?.w === "est" && before[1]?.w === "c'";
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  if (cEst && (next?.w === "que" || next?.w === "qu'"))
    return wordFinding(ctx, m.index, m[0], ["là"], RULE, MESSAGE);
  // "la-bas", "la où": the adverb; the article never comes before "où".
  if (/^-(?:bas|haut|dessus|dessous|dedans)(?![\p{L}\p{M}])/u.test(rest.slice(0, 10)))
    return wordFinding(ctx, m.index, m[0], ["là"], RULE, MESSAGE);
  if (next?.w === "où" && next.start === m.index + m[0].length + 1 && before[0])
    return wordFinding(ctx, m.index, m[0], ["là"], RULE, MESSAGE);
  // A clause ending on "la" after être or "tous": the article and the pronoun never end one.
  const final = /^\s{0,8}(?:[.!?…:)]|$)/u.test(rest.slice(0, 10));
  if (!final) return null;
  const words = tokensBefore(ctx.text, m.index, 8);
  let i = 0;
  // "est déjà la", "est tout le temps la".
  for (;;) {
    if (words[i] && ADVERBS.has(words[i].w)) i++;
    else if (words[i]?.w === "temps" && words[i + 1]?.w === "le" && words[i + 2]?.w === "tout")
      i += 3;
    else break;
  }
  const verb = words[i];
  if (!verb) return null;
  const etre = readingsOf(verb.w).some((r) => isFinite(r) && r.lemma === "être");
  if (etre || (i === 0 && ["tous", "toutes", "deux", "trois"].includes(verb.w)))
    return wordFinding(ctx, m.index, m[0], ["là"], RULE, MESSAGE);
  // "tu fous la ?", "que buvez-vous la ?": after a verb with its subject pronoun.
  const subject = words[i + 1];
  const inverted = INVERTED.has(verb.w) && Boolean(subject?.hyphen);
  const subjected =
    subject !== undefined && SUBJECT_PRONOUNS.has(subject.w) && readingsOf(verb.w).some(isFinite);
  if (i === 0 && (inverted || subjected))
    return wordFinding(ctx, m.index, m[0], ["là"], RULE, MESSAGE);
  return null;
}

const INVERTED = new Set(["tu", "vous", "il", "elle", "on", "ils", "elles", "nous"]);

/** "ce truc-la", "celui la.": the adverb after a demonstrative. */
function hyphenLa(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const start = m.index + m[0].length - 2;
  const words = tokensBefore(ctx.text, m.index, 4);
  const head = words[0];
  if (!head || head.end !== m.index) return null;
  const demonstrative = ["celui", "celle", "ceux", "celles"].includes(head.w);
  if (m[0][0] !== "-") {
    // "celle la plus belle": a superlative; only a clause end makes it "celle-là".
    if (!demonstrative || !/^\s{0,8}(?:[.!?…,;:)]|$)/u.test(ctx.text.slice(start + 2, start + 12)))
      return null;
  } else if (
    !demonstrative &&
    !words.slice(1).some((t) => ["ce", "cet", "cette", "ces"].includes(t.w))
  )
    return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const typed = ctx.text.slice(m.index, start + 2);
  return finding(RULE, MESSAGE, m.index, start + 2, [`-${carryCase(typed.slice(-2), "là")}`], {
    context: { start: head.start, end: start + 2 },
  });
}
const HYPHEN_LA = /(?<=\p{L})(?:-|[ \t])la(?![\p{L}\p{M}\p{N}_'’-])/gu;

/**
 * The possessive for the word after it: "son" before a masculine noun or a vowel, "sa" before
 * a feminine noun, "ses" before a plural. With no known gender or number, all that can be
 * correct are offered and none is preselected.
 */
function possessiveFor(word: string): string[] {
  const plural = /[sx]$/.test(word) && !isNounLemma(word) && isInflectedNoun(word);
  if (plural) return ["ses"];
  // "son amie": a vowel takes "son" whatever the gender ("h" may be aspirated: "sa hache").
  if (/^[aeiouyàâéèêëîïôûœæ]/.test(word)) return ["son"];
  const gender = nounGender(word);
  if (gender) return [gender === "f" ? "sa" : "son"];
  return /[sx]$/.test(word) ? ["son", "sa", "ses"] : ["son", "sa"];
}

/** "avec sont frère": the possessive "son", "sa" or "ses". */
function sontToSon(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  if (
    !previous ||
    !PREPOSITIONS.has(previous.w) ||
    !next ||
    ctx.text[m.index + m[0].length] === "-" ||
    ADVERBS.has(next.w)
  )
    return null;
  return wordFinding(ctx, m.index, m[0], possessiveFor(next.w), RULE, MESSAGE, {
    start: previous.start,
    end: next.end,
  });
}

// Infinitives that are also common nouns after "du": "il a du pouvoir", "du savoir".
const NOUN_INFINITIVES = new Set([
  "pouvoir",
  "savoir",
  "devoir",
  "vouloir",
  "dîner",
  "déjeuner",
  "goûter",
  "souper",
  "rire",
  "sourire",
  "plaisir",
]);
// Pronouns between devoir and its infinitive: "j'ai dû la lâcher".
const INFINITIVE_CLITICS = new Set(
  "le la les l' lui leur y en me m' te t' se s' nous vous".split(" "),
);
const isAdverb = (word: string) => ADVERBS.has(word) || /..ment$/.test(word);

/** "il a du partir", "j'ai finalement du la lâcher", "tu n'aurais pas du !": the participle of
 * devoir. */
function duToDu(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 4);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 4);
  let i = 0;
  for (;;) {
    if (before[i] && isAdverb(before[i].w)) i++;
    else if (before[i]?.w === "doute" && before[i + 1]?.w === "sans") i += 2;
    else break;
  }
  // "aurais-je du": an inverted subject after avoir.
  if (before[i] && SUBJECT_PRONOUNS.has(before[i].w) && before[i + 1]?.hyphen) i++;
  const avoir = before[i];
  if (!avoir || !readingsOf(avoir.w).some((r) => isFinite(r) && r.lemma === "avoir")) return null;
  const fix = (end: number) =>
    wordFinding(ctx, m.index, m[0], ["dû"], RULE, MESSAGE, { start: avoir.start, end });
  // "tu n'aurais pas du !": a negated devoir closing its clause.
  if (!after.length) {
    const negated = before.slice(0, i).some((t) => ["pas", "jamais", "plus"].includes(t.w));
    const closes = /^[\s\u00a0]*[.!?…]/u.test(ctx.text.slice(m.index + m[0].length));
    return negated && closes ? fix(m.index + m[0].length) : null;
  }
  let k = 0;
  while (after[k] && (isAdverb(after[k].w) || INFINITIVE_CLITICS.has(after[k].w))) k++;
  const next = after[k];
  if (!next || (k === 0 && NOUN_INFINITIVES.has(next.w))) return null;
  // "du être", "du avoir": a partitive would elide ("de l'être").
  if (!readingsOf(next.w).some((r) => r.slot === "I" && r.lemma === next.w)) return null;
  return fix(next.end);
}

// Words after which "prés" is the noun (meadows): "les prés", "deux prés", "de verts prés".
const PRES_BEFORE = new Set([
  ...DETERMINERS,
  ..."deux trois quatre plusieurs quelques nombreux grands petits beaux verts".split(" "),
]);

/** "prés de Paris", "de prés", "le plus prés": the adverb près. */
function presToPres(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const [previous, second] = tokensBefore(ctx.text, m.index, 2);
  // "voir de prés", not "une demande de prés" (prêt): only after a verb.
  if (previous?.w === "de" && !(second && plainVerb(second.w, () => true))) return null;
  if (previous && (PRES_BEFORE.has(previous.w) || previous.w === "et" || previous.w === "ou"))
    return null;
  // "de vastes prés", "les maisons prés de la gare": after a plural word it may be the noun.
  if (previous && /[sx]$/.test(previous.w)) {
    const singular = previous.w.replace(/[sx]$/, "");
    if (adjectiveReadings(previous.w).length || isInflectedNoun(singular)) return null;
  }
  return wordFinding(ctx, m.index, m[0], ["près"], RULE, MESSAGE);
}

/** "je ne l'aime guerre": the adverb guère in a negated clause. */
function guerreToGuere(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 6);
  const previous = before[0];
  if (!previous || DETERMINERS.has(previous.w) || PREPOSITIONS.has(previous.w)) return null;
  if (["en", "après", "avant", "contre", "de", "d'"].includes(previous.w)) return null;
  const verb = previous.w === "plus" ? before[1] : previous;
  if (!verb || !readingsOf(verb.w).some(isFinite)) return null;
  if (!before.some((t) => t.w === "ne" || t.w === "n'")) return null;
  return wordFinding(ctx, m.index, m[0], ["guère"], RULE, MESSAGE);
}

/** "Ont dit que…": the pronoun "on" opening a sentence. */
function ontToOn(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  if (!sentenceStart(ctx.text, m.index) || ctx.text[m.index + m[0].length] === "-") return null;
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  if (!next) return null;
  const third = readingsOf(next.w).some((r) => isFinite(r) && ((r.slot as number) & IL) > 0);
  if (!third && !["ne", "n'", "se", "s'", "y", "en"].includes(next.w)) return null;
  return wordFinding(ctx, m.index, m[0], ["on"], RULE, MESSAGE);
}

const AFTER_EVEN = new Set([...DETERMINERS, ...STRESSED, ...SUBJECT_PRONOUNS, ...PREPOSITIONS]);

// Words after "an" that keep it: "l'an dernier", "un an plus tard", "dix ans révolus".
const AN_KEEPS = new Set(
  (
    "dernier prochain passé passés neuf entier plein révolu révolus accompli accomplis complet " +
    "complets environ plus après avant auparavant tout tous seulement exactement juste pile " +
    "durant pendant chaque ou et mais"
  ).split(" "),
);
const EPICENE_ADJECTIVE = /(?:ible|able|ile|aire|ique|ème)s?$/;
const AN_DETERMINERS: Record<string, string> = {
  un: "une",
  "l'": "l'",
  cet: "cette",
  les: "les",
  des: "des",
  mes: "mes",
  ces: "ces",
  nos: "nos",
  vos: "vos",
  ses: "ses",
};

/** "un an difficile", "l'an scolaire", "mes ans scolaires": a year described is "année". */
function anToAnnee(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const { det, an, adj } = m.groups!;
  const lowerDet = det.toLowerCase().replaceAll("’", "'");
  const plural = an.toLowerCase() === "ans";
  if (plural !== ["les", "des", "mes", "ces", "nos", "vos", "ses"].includes(lowerDet)) return null;
  if (an !== an.toLowerCase() || adj !== adj.toLowerCase() || AN_KEEPS.has(adj)) return null;
  if (readingsOf(adj).some((r) => isFinite(r) || r.slot === "Q" || r.slot === "G")) return null;
  const masculine = adjectiveReadings(adj).find((r) => r.slot === (plural ? "mp" : "ms"));
  let feminine: string | undefined;
  if (masculine) feminine = inflect(masculine, plural ? "fp" : "fs")[0];
  else if (EPICENE_ADJECTIVE.test(adj) && /s$/.test(adj) === plural) feminine = adj;
  if (!feminine) return null;
  const typedDet = carryCase(det, AN_DETERMINERS[lowerDet]);
  const space = lowerDet === "l'" ? "" : " ";
  const noun = plural ? "années" : "année";
  return finding(RULE, "review_msg_contextual_grammar", m.index, m.index + m[0].length, [
    `${typedDet}${space}${noun} ${feminine}`,
  ]);
}
const AN_ADJECTIVE =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?<det>un|[lL]['’]|cet|les|des|mes|ces|nos|vos|ses|Un|Les|Mes|Ces)[ \t]{0,8}(?<=['’]|[ \t])(?<an>ans?)[ \t]{1,8}(?<adj>\p{Ll}+)(?![\p{L}\p{M}\p{N}_'’-])/gu;

/** "des 1980", "des 11 h", "livraison offerte des 20 €": "dès" (from) before a date, a time, an
 * age or a threshold. */
function desToDes(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const rest = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 40);
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  const year = /^[ \t\u00a0]+(?:1\d{3}|20\d{2})(?![\d\p{L}])(?![ \t\u00a0]+(?:\p{Ll}|et\b))/u.test(
    rest,
  );
  const time = /^[ \t\u00a0]+\d{1,2}[ \t\u00a0]*(?:h|heures?|ans)(?![\p{L}])/u.test(rest);
  const offer =
    !!previous &&
    /^(?:offerte?s?|gratuite?s?)$/.test(previous.w) &&
    /^[ \t\u00a0]+(?:\d|[$€£])/u.test(rest);
  if (!year && !time && !offer) return null;
  // "les jeunes des 18 ans": after a noun "des" may be "de les".
  if (!offer && previous && !/^(?:et|ou|mais|puis|rendez-vous)$/.test(previous.w)) return null;
  return wordFinding(ctx, m.index, m[0], [m[0][0] === "D" ? "Dès" : "dès"], RULE, MESSAGE);
}
const DES_NUMBER = /(?<![\p{L}\p{M}\p{N}_'’-])[dD]es(?=[ \t\u00a0]+[\d$€£])/gu;

/** "il croit aveuglement" (the adverb aveuglément), "son aveuglément" (the noun aveuglement). */
function aveuglement(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  if (!previous) return null;
  const noun = DETERMINERS.has(previous.w) || ["sans", "cet", "l'"].includes(previous.w);
  const adverb = m[0].toLowerCase() === "aveuglément";
  if (adverb && noun)
    return wordFinding(ctx, m.index, m[0], [`${m[0].slice(0, 6)}ement`], RULE, MESSAGE);
  if (!adverb && !noun && readingsOf(previous.w).length && !isVerbHomograph(previous.w))
    return wordFinding(ctx, m.index, m[0], [`${m[0].slice(0, 6)}ément`], RULE, MESSAGE);
  return null;
}
const AVEUGLEMENT = /(?<![\p{L}\p{M}\p{N}_'’-])[aA]veugl[eé]ment(?![\p{L}\p{M}\p{N}_'’-])/gu;

/** "il dure prêt de deux heures": "près de" (nearly) before a number, right after a verb. "Un
 * prêt de 2 000 euros" (a loan) has its determiner. */
function pretToPres(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m.groups!.pret;
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  if (!previous || DETERMINERS.has(previous.w) || !readingsOf(previous.w).some(isFinite))
    return null;
  return wordFinding(ctx, m.index, typed, ["près"], RULE, MESSAGE, {
    start: m.index,
    end: m.index + m[0].length,
  });
}
const PRET_NUMBER =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?<pret>[pP]rêts?)[ \t]+de[ \t]+(?:\d|(?:deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|soixante|cent|mille)(?![\p{L}\p{M}\p{N}_'’-]))/gu;

/** "Tache de partir tôt", "il tache que tout aille bien": tâcher (to try), not tacher (to stain). */
function tacherToTacher(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0].toLowerCase();
  if (!readingsOf(word).some((r) => isFinite(r) && r.lemma === "tacher")) return null;
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  if (previous && DETERMINERS.has(previous.w)) return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 7);
  let k = 0;
  // "Tâchons quand même de", "il tâche de ne pas le lui dire".
  if (after[0]?.w === "quand" && after[1]?.w === "même") k = 2;
  while (after[k] && ADVERBS.has(after[k].w)) k++;
  const next = after[k];
  if (!next) return null;
  let j = k + 1;
  while (
    after[j] &&
    (["ne", "n'", "pas", "rien", "jamais", "plus", "point"].includes(after[j].w) ||
      INFINITIVE_CLITICS.has(after[j].w))
  )
    j++;
  const infinitive =
    after[j] && readingsOf(after[j].w).some((r) => r.slot === "I" && r.lemma === after[j].w);
  const fits =
    next.w === "que" || next.w === "qu'" || ((next.w === "de" || next.w === "d'") && infinitive);
  if (!fits) return null;
  return wordFinding(ctx, m.index, m[0], [`${m[0][0]}â${m[0].slice(2)}`], RULE, MESSAGE, {
    start: m.index,
    end: next.end,
  });
}
const TACHER =
  /(?<![\p{L}\p{M}\p{N}_'’-])[tT]ach(?:e|es|ez|ons|ent|ais|ait|aient|iez|ions|era|erai|eras|erons|erez|eront)(?![\p{L}\p{M}\p{N}_'’-])/gu;

// What leaves a stain ("une tache de café"), what a stain is ("tenace") and what it is on.
const STAINS = new Set(
  (
    "café vin sang graisse gras encre huile ketchup sauce chocolat moutarde peinture boue rouille " +
    "confiture jus thé lait sueur herbe cambouis goudron moisissure humidité mayonnaise beurre"
  ).split(" "),
);
const STAIN_ADJECTIVES = new Set("indélébile indélébiles tenace tenaces".split(" "));
const STAINED_THINGS = new Set(
  (
    "chemise chemisier pantalon jean robe jupe veste manteau pull cravate nappe tapis moquette " +
    "drap draps oreiller canapé tissu vêtement vêtements linge lit mur plafond"
  ).split(" "),
);
// What a task is ("une tâche ardue") and verbs whose object is a task ("accomplir la tâche").
const TASK_ADJECTIVES = new Set(
  (
    "complexe complexes ménagère ménagères quotidienne quotidiennes principale principales " +
    "administrative administratives répétitive répétitives fastidieuse fastidieuses ardue " +
    "ardues ingrate ingrates délicate délicates prioritaire prioritaires"
  ).split(" "),
);
const TASK_VERBS = new Set(
  (
    "accomplir effectuer exécuter réaliser remplir terminer achever finir simplifier faciliter " +
    "compliquer confier assigner déléguer répartir"
  ).split(" "),
);
const OBJECT_DETERMINERS = new Set(
  (
    "le l' un ce cet mon ton son la une cette sa ma ta notre votre leur les des ces ses mes tes " +
    "nos vos leurs"
  ).split(" "),
);

/** "une tâche de café" -> "tache", "accomplir la tache" -> "tâche", "j'ai tâché ma chemise" ->
 * "taché": the stain (tache, tacher) against the task (tâche) and trying (tâcher de). */
function tacheToTache(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const word = typed.toLowerCase();
  const accented = word[1] === "â";
  const swap = `${typed[0]}${accented ? "a" : "â"}${typed.slice(2)}`;
  const before = tokensBefore(ctx.text, m.index, 3);
  const after = tokensAfter(ctx.text, m.index + typed.length, 3);
  const noun = /^t[aâ]ches?$/.test(word) && before[0] !== undefined && DETERMINERS.has(before[0].w);
  let fits = false;
  if (accented && noun) {
    const [next, second, third] = after;
    fits =
      (["de", "d'"].includes(next?.w ?? "") && STAINS.has(second?.w ?? "")) ||
      STAIN_ADJECTIVES.has(next?.w ?? "") ||
      (next?.w === "sur" && DETERMINERS.has(second?.w ?? "") && STAINED_THINGS.has(third?.w ?? ""));
  } else if (accented) {
    // "j'ai tâché ma chemise", "il se tâche": tâcher (to try) takes "de" or "que", never an
    // object or a reflexive pronoun.
    const object = after[0] !== undefined && OBJECT_DETERMINERS.has(after[0].w);
    const reflexive = ["se", "s'", "me", "m'", "te", "t'"].includes(before[0]?.w ?? "");
    fits =
      (/^tâch(?:é|ée|és|ées|er)$/.test(word) && object) ||
      (reflexive && !/^(?:de|d'|que|qu')$/.test(after[0]?.w ?? ""));
  } else if (noun) {
    const verb = before[1];
    fits =
      TASK_ADJECTIVES.has(after[0]?.w ?? "") ||
      (OBJECT_DETERMINERS.has(before[0].w) &&
        verb !== undefined &&
        readingsOf(verb.w).some((r) => TASK_VERBS.has(r.lemma)));
  }
  return fits ? wordFinding(ctx, m.index, typed, [swap], RULE, MESSAGE) : null;
}
const TACHE =
  /(?<![\p{L}\p{M}\p{N}_'’-])[tT][aâ]ch(?:es?|é|ée|és|ées|er)(?![\p{L}\p{M}\p{N}_'’-])/gu;

/** "il est venu comme même": "quand même"; "comme même ses amis" (like even) stays. */
function commeMeme(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  const rest = ctx.text.slice(m.index + m[0].length);
  if (next && /^[\s ]*\p{L}/u.test(rest)) {
    const typed = ctx.text.slice(next.start, next.end);
    if (AFTER_EVEN.has(next.w) || /^\p{Lu}/u.test(typed) || next.w === "si") return null;
  } else if (/^[\s ]*\d/u.test(rest)) return null;
  return wordFinding(ctx, m.index, m[0].slice(0, 5), ["quand"], RULE, MESSAGE, {
    start: m.index,
    end: m.index + m[0].length,
  });
}
const COMME_MEME = /(?<![\p{L}\p{M}\p{N}_'’-])comme[ \t]+même(?![\p{L}\p{M}\p{N}_'’-])/giu;

/** A plural adjective, as far as the lists tell: no verb form, no noun with a gender. */
const describesPlural = (word: string) =>
  /[sx]$/.test(word) &&
  !["autres", "mêmes", "certains", "certaines", "plusieurs"].includes(word) &&
  !nounGender(word.slice(0, -1)) &&
  !nounGender(word) &&
  // "précises" is also "tu précises".
  (adjectiveReadings(word).some((r) => r.slot === "mp" || r.slot === "fp") ||
    (isInflectedNoun(word) && !isNounLemma(word) && !readingsOf(word).some(isFinite)));
/** A word that only describes: an adjective with gendered forms or a participle, no noun. */
const describes = (word: string) =>
  !nounGender(word) &&
  (readingsOf(word).some((r) => r.slot === "Q") ||
    (adjectiveReadings(word).length > 0 &&
      !readingsOf(word).some(isFinite) &&
      // "le directeur et fondateur": agent nouns inflect like adjectives.
      !/(?:eur|ier|ien)$/.test(word)));

/** "le repas est se trouve", "des solutions simples est rapides": the conjunction "et". */
function estToEt(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  const [next, after] = tokensAfter(ctx.text, m.index + m[0].length, 2);
  // "à l'est se trouve", "le nord-est": the compass point.
  if (!before || !next || before.w === "l'" || before.w === "du" || before.hyphen) return null;
  if (SUBJECT_PRONOUNS.has(before.w) || before.w === "c'" || before.w === "ce") return null;
  // "est se trouve", "est ne semble": a clitic and a second finite verb.
  const clitic = ["se", "s'", "ne", "n'"].includes(next.w);
  const verb = clitic && !!after && after.w !== "importe" && plainVerb(after.w, isFinite);
  // "simples est rapides": two plural adjectives.
  const pair = describesPlural(before.w) && describesPlural(next.w);
  if (!verb && !pair) return null;
  return wordFinding(ctx, m.index, m[0], ["et"], RULE, MESSAGE, {
    start: before.start,
    end: (verb ? after : next).end,
  });
}

/** "le chien et abandonné", "quelle et la plus grande ?": the verb "est". */
function etToEst(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 8);
  const [next, after] = tokensAfter(ctx.text, m.index + m[0].length, 2);
  if (!before[0] || !next) return null;
  const fix = (end: number) =>
    wordFinding(ctx, m.index, m[0], ["est"], RULE, MESSAGE, { start: before[0].start, end });
  if (/^quel(?:le)?s?$/.test(before[0].w) && before.length === 1 && DETERMINERS.has(next.w))
    return fix(next.end);
  // A singular subject noun phrase opening its clause, then a describing word that ends it.
  const [noun, det] = before;
  if (!det || !["le", "la", "l'", "un", "une", "ce", "cet", "cette"].includes(det.w)) return null;
  if (!isInflectedNoun(noun.w) || (readingsOf(noun.w).length && !isVerbHomograph(noun.w)))
    return null;
  if (before.length > 2 && !CLAUSE_SUBJECTS.has(before[2].w) && !CONJUNCTIONS.has(before[2].w))
    return null;
  const word = ADVERBS.has(next.w) || /..ment$/.test(next.w) ? after : next;
  if (!word || /s$/.test(word.w) || !describes(word.w) || word.w.startsWith("demi")) return null;
  if (!/^[\s ]*(?:[.!?;]|$)/u.test(ctx.text.slice(word.end, word.end + 3))) return null;
  return fix(word.end);
}
const EST_ET = /(?<![\p{L}\p{M}\p{N}_'’-])(?:est|et)(?![\p{L}\p{M}\p{N}_'’-])/gu;

const CANDIDATE =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:à|a|A|ou|Ou|où|sûre?s?|sure?s?|[cC]e|[sS]e|[sS]['’](?:est|était)|[sS]a|ma|ta|la|sont|son|on|non|[pP]eut|[pP]eux|[qQ]uant|[qQ]uand|du|[oO]nt|[pP]rés|guerres?)(?![\p{L}\p{M}\p{N}_'’])/gu;

function homophones(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, CANDIDATE)) {
    const word = m[0];
    const lower = word.toLowerCase().replaceAll("’", "'");
    let finding: RawFinding | null = null;
    if (lower === "à") finding = graveToA(ctx, m);
    else if (lower === "a") finding = aToGrave(ctx, m);
    else if (lower === "ou") finding = ouToOu(ctx, m);
    else if (lower === "où") finding = ouGraveToOu(ctx, m);
    else if (lower.startsWith("sû")) finding = surGraveToSur(ctx, m);
    else if (lower.startsWith("sur") || lower === "sure" || lower === "sures")
      finding = surToSur(ctx, m);
    else if (lower === "ce") finding = ceToSe(ctx, m);
    else if (lower === "se") finding = seToCe(ctx, m);
    else if (lower.startsWith("s'")) finding = sEstToCEst(ctx, m);
    else if (lower === "sa") finding = saToCa(ctx, m);
    else if (lower === "ma" || lower === "ta" || lower === "la")
      finding = elidedAuxiliary(ctx, m) ?? (lower === "la" ? laToLa(ctx, m) : null);
    else if (lower === "sont") finding = sontToSon(ctx, m);
    else if (lower === "son") finding = sonToSont(ctx, m);
    else if (lower === "on") finding = onToOnt(ctx, m);
    else if (lower === "non") finding = nonToNont(ctx, m);
    else if (lower === "peut" || lower === "peux") finding = peutToPeu(ctx, m);
    else if (lower === "quant") finding = quantToQuand(ctx, m);
    else if (lower === "quand") finding = quandToQuant(ctx, m);
    else if (lower === "du") finding = duToDu(ctx, m);
    else if (lower === "prés") finding = presToPres(ctx, m);
    else if (lower === "guerre" || lower === "guerres") finding = guerreToGuere(ctx, m);
    else if (lower === "ont") finding = ontToOn(ctx, m) ?? ontPeut(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, C_ELIDED)) {
    const finding = cToS(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, AN_ADJECTIVE)) {
    const finding = anToAnnee(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, DES_NUMBER)) {
    const finding = desToDes(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, AVEUGLEMENT)) {
    const finding = aveuglement(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, PRET_NUMBER)) {
    const finding = pretToPres(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, TACHER)) {
    const finding = tacherToTacher(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, TACHE)) {
    const finding = tacheToTache(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, COMME_MEME)) {
    const finding = commeMeme(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, HYPHEN_LA)) {
    const finding = hyphenLa(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, EST_ET)) {
    const finding = m[0] === "est" ? estToEt(ctx, m) : etToEst(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: homophones }];
