import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  IL,
  isInflectedNoun,
  isVerbHomograph,
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
  withCase,
  wordFinding,
  type Token,
} from "./frenchTokens";

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
    /^[\p{Lu}\d]/u.test(text.slice(token.start, token.end)) ||
    readingsOf(token.w).some((r) => r.slot === "I" && r.lemma === token.w)
  );
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

/** "je pense a toi", "j'ai répondu a ta lettre", "A la fin": the preposition missing its accent. */
function aToGrave(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  if (ctx.text[m.index + 1] === "-" || ctx.text[m.index - 1] === "-") return null;
  const before = tokensBefore(ctx.text, m.index);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 2);
  const next = after[0];
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
  if (
    /\d[ \t\u00a0]{0,8}$/.test(ctx.text.slice(Math.max(0, m.index - 9), m.index)) &&
    /^[ \t\u00a0]{0,8}\d/.test(ctx.text.slice(m.index + 1, m.index + 10))
  )
    return fix(undefined);
  // "rien a faire", "beaucoup a apprendre".
  if (QUANTIFIERS.has(previous.w) && isInfinitive(next.w)) return fix(previous);
  // Past the clause's own subject clause ("ce qu'il pense a de l'importance") it may be the verb.
  if (tokensBefore(ctx.text, m.index, 30).some((t) => CLAUSE_SUBJECTS.has(t.w))) return null;
  if (SUBJECT_PRONOUNS.has(previous.w) || CLITICS.has(previous.w)) return null;
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
  const verb = own.find((t, i) => {
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
  if (verb && !asked && !own.some((t) => t.w === "y")) return fix(verb);
  // A finite verb with its subject: "il pense a sa mère".
  if (
    plainVerb(previous.w, (r) => isFinite(r) && r.lemma !== "avoir" && r.lemma !== "être") &&
    !isParticiple(next.w)
  )
    return fix(previous);
  // A participle after its auxiliary: "j'ai répondu a ta lettre", "elle est partie a la poste".
  if (readingsOf(previous.w).some((r) => r.slot === "Q")) {
    let k = 1;
    while (before[k] && ADVERBS.has(before[k].w)) k++;
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
  // "nous sommes surs", "en êtes-vous surs ?": the preposition has no plural; after être the
  // plural is "sûrs".
  if (/^(?:surs|sures)$/i.test(m[0])) {
    const verb = tokensBefore(ctx.text, m.index, 4).find((t) => !ADVERBS.has(t.w));
    if (verb && readingsOf(verb.w).some((r) => r.lemma === "être")) return fix();
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
  const [next, after] = tokensAfter(ctx.text, m.index + m[0].length, 2);
  if (!next || next.hyphen) return null;
  const fix = (from: Token | undefined) =>
    wordFinding(ctx, m.index, m[0], ["se"], RULE, MESSAGE, {
      start: from?.start ?? m.index,
      end: next.end,
    });
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
  if (!subject || ctx.text[subject.start - 1] === "-") return null;
  if (!["il", "elle", "on", "ils", "elles", "ne", "n'"].includes(subject.w)) return null;
  const elided = m[0].slice(0, 2);
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
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
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

/** "les enfants son là", "ce son eux": "sont". */
function sonToSont(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 4);
  const next = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  // "Ce son des enfants", "ce son eux": "ce sont" before a plural noun phrase.
  if (before[0]?.w === "ce" && !before[1] && next && CE_SONT_NEXT.has(next.w))
    return wordFinding(ctx, m.index, m[0], ["sont"], RULE, MESSAGE, {
      start: before[0].start,
      end: next.end,
    });
  // "les personnes invitées son là": an adjective or participle may follow the noun.
  const plural = (t?: Token) => !!t && /[sx]$/.test(t.w);
  let h = 0;
  if (plural(before[0]) && plural(before[1]) && participleOnly(before[0].w)) h = 1;
  const det = before[h + 1];
  const pronoun = h === 0 && PLURAL_SUBJECTS.has(before[0]?.w ?? "") && !det;
  if (!pronoun) {
    if (!det || !(PLURAL_DETERMINERS.has(det.w) || NUMBERS.test(det.w)) || !plural(before[h]))
      return null;
    if (before[h + 2] && !CONJUNCTIONS.has(before[h + 2].w)) return null;
  }
  if (!next || next.hyphen || /^\p{Lu}/u.test(ctx.text[next.start])) return null;
  const nounLike = nounGender(next.w) || nounGender(next.w.replace(/[sx]$/, ""));
  const predicate =
    adjectiveReadings(next.w).length ||
    readingsOf(next.w).some((r) => r.slot === "Q") ||
    ADVERBS.has(next.w) ||
    next.w === "là" ||
    next.w === "ici";
  // "son" never stands before a plural: "les épaules son larges".
  if (nounLike || (!predicate && !/[sx]$/.test(next.w))) return null;
  return wordFinding(ctx, m.index, m[0], ["sont"], RULE, MESSAGE, {
    start: (det ?? before[0]).start,
    end: next.end,
  });
}

/** "ceux qui on fait", "les habitants on parlé": "ont" before a participle. */
function onToOnt(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 3);
  const after = tokensAfter(ctx.text, m.index + m[0].length, 3);
  const word = after[after[0] && ADVERBS.has(after[0].w) ? 1 : 0];
  if (!word || !participleOnly(word.w) || isVerbHomograph(word.w)) return null;
  const previous = before[0];
  if (!previous) return null;
  // "à qui on parle": after a preposition "qui on" is a clause of its own.
  const relative =
    previous.w === "qui" && !(before[1] && (PREPOSITIONS.has(before[1].w) || before[1].w === "à"));
  const plural = /[sx]$/.test(previous.w) && !!before[1] && PLURAL_DETERMINERS.has(before[1].w);
  if (!relative && !plural) return null;
  return wordFinding(ctx, m.index, m[0], ["ont"], RULE, MESSAGE, {
    start: previous.start,
    end: word.end,
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
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start: m.index, end: start + 2 },
    alternatives: [`-${withCase(typed.slice(-2), "là")}`],
    context: { start: head.start, end: start + 2 },
  };
}
const HYPHEN_LA = /(?<=\p{L})(?:-|[ \t])la(?![\p{L}\p{M}\p{N}_'’-])/gu;

/** "avec sont frère": the possessive "son". */
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
  return wordFinding(ctx, m.index, m[0], ["son"], RULE, MESSAGE, {
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

const CANDIDATE =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:à|a|A|ou|Ou|où|sûre?s?|sure?s?|[cC]e|[sS]e|[sS]['’](?:est|était)|[sS]a|ma|ta|la|sont|son|on|[pP]eut|[pP]eux|[qQ]uant|[qQ]uand|du|[oO]nt|[pP]rés|guerres?)(?![\p{L}\p{M}\p{N}_'’])/gu;

function homophones(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, CANDIDATE)) {
    const word = m[0];
    const lower = word.toLowerCase().replace("’", "'");
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
  for (const m of ownedFrenchWords(ctx, TACHER)) {
    const finding = tacherToTacher(ctx, m);
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
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: homophones }];
