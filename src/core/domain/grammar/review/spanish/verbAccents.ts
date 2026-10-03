import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  Around,
  CLITICS,
  CONJUNCTIONS,
  DETERMINERS as COMMON_DETERMINERS,
  GIVEN_NAMES,
  isInfinitive,
  PREPOSITIONS,
  PRENOMINAL,
  SER,
  replaceToken,
  tokenize,
  words,
} from "./common";
import { readNoun } from "./agreement";
import {
  ACCENTED_NOMINAL,
  attribute,
  finiteVerb,
  genderedForm,
  isGerund,
  isNoun,
  isVerb,
  participle,
  subjunctiveLike,
} from "./lexicon";
import { isLang } from "../phraseTemplates";

// Accents that tell a verb form from its twin: "el termino" (término, the noun), "se creo"
// (creó, the preterite), "no sabia" (sabía, the imperfect).

const RULE = "spanishAccents" as const;

// Determiners that are never clitics: "el termino", "su numero", "dos practicas".
const DETERMINERS = words(
  "el un una unos unas del al mi mis tus su sus cada nuestro nuestra nuestros nuestras dos tres cuatro " +
    "cinco varios varias muchas muchos pocas pocos otra otro otras otros toda todo cuyo cuya " +
    "cuyos cuyas",
);
const DEGREE = words("muy más tan bastante");
// Demonstratives are also subject pronouns ("este opera"): only after a preposition.
const DEMONSTRATIVES = words(
  "este esta estos estas ese esa esos esas aquel aquella aquellos aquellas",
);
const SUBJECTS = words("él ella usted");
const TENER = words("tengo tienes tiene tenemos tienen tenía tenías teníamos tenían tuve tuvo");
// Before these, an imperfect or conditional verb: "no sabía", "se hacía", "yo tenía".
const BEFORE_VERB = words("me te se le les nos os no yo él ella usted lo");

// "-o" words that are conjunctions, adverbs or quantifiers before a verb ("no sé cómo").
const FUNCTION_WORDS = words(
  "como cuando donde pero todo mucho poco solo tanto otro mismo uno ninguno alguno cuanto " +
    "luego tampoco sino demasiado medio esto eso aquello",
);

/**
 * After a noun it agrees with, where that noun cannot be the verb's subject: a preposition, an
 * indefinite article or a verb before it ("en una zona crítica", "hace tareas específicas"),
 * and the phrase closing after the adjective ("crítica.", "válida y", "íntegro de").
 */
function postponedAdjective(at: Around, accented: string): boolean {
  const ending = /(o|a)(s?)$/u.exec(accented);
  const noun = ending && readNoun(at.prev());
  if (!ending || !noun?.gender || at.tokens[at.i - 1].broken) return false;
  if ((noun.gender === "f") !== (ending[1] === "a") || noun.plural !== (ending[2] === "s"))
    return false;
  const before = at.prev(2);
  const article = /^(?:un|una|unos|unas)$/u.test(before);
  // Where the governing preposition stands: "en zona", "en esta zona".
  const preposition = PREPOSITIONS.has(before)
    ? 2
    : COMMON_DETERMINERS.has(before) && PREPOSITIONS.has(at.prev(3))
      ? 3
      : 0;
  const after0 = at.next();
  const governed =
    article ||
    preposition > 0 ||
    (!!before && finiteVerb(before) && !isNoun(before) && !readNoun(before)) ||
    // "La especie domestica vive aquí": a finite verb right after, so the word is no verb.
    (COMMON_DETERMINERS.has(before) &&
      !!after0 &&
      finiteVerb(after0) &&
      !isNoun(after0) &&
      !attribute(after0) &&
      !CLITICS.has(after0) &&
      !PREPOSITIONS.has(after0) &&
      !CONJUNCTIONS.has(after0)) ||
    // "Las disposiciones explicitas", "el método practico": a first-person or a second-person
    // form cannot have the noun before it as its subject ("La gente critica" can).
    (COMMON_DETERMINERS.has(before) && /(?:o|as|os)$/u.test(at.tokens[at.i].lower));
  if (!governed) return false;
  const after = at.next();
  // "Por este motivo solicito desde…": after a fronted phrase the word may be the main verb.
  if (!article && preposition && new Around(at.tokens, at.i - preposition).starts)
    return at.endsAfter();
  return (
    at.endsAfter() ||
    ((after === "y" || after === "e") && !COMMON_DETERMINERS.has(at.next(2))) ||
    (PREPOSITIONS.has(after) && after !== "a") ||
    /^\p{L}{4,}mente$/u.test(after)
  );
}

// Words after which "la"/"las" is a clitic: "Ella la practica de vez en cuando".
const NOT_BEFORE_ARTICLE = words(
  "yo tú él ella usted nosotros nosotras vosotros vosotras ellos ellas ustedes no ya también " +
    "tampoco nunca siempre que quien se me te nos os",
);

const formOf = (word: string) => {
  const m = /(o|a)(s?)$/u.exec(word);
  return m ? { feminine: m[1] === "a", plural: m[2] === "s" } : null;
};
/** An -o/-a word of the gender and number given. */
function agrees(form: { feminine: boolean | null; plural: boolean }, accented: string): boolean {
  const own = formOf(accented);
  return (
    !!own &&
    own.plural === form.plural &&
    (form.feminine === null || own.feminine === form.feminine)
  );
}
const agreesWithArticle = (article: string, accented: string) =>
  agrees({ feminine: !article.startsWith("lo"), plural: article.endsWith("s") }, accented);
/** The next word is a noun of the gender and number of the -o/-a word before it. */
function agreesWithNext(at: Around, accented: string): boolean {
  const own = formOf(accented);
  const noun = readNoun(at.next());
  if (!own || !noun || noun.paired || !noun.gender || at.tokens[at.i + 1].broken) return false;
  if (finiteVerb(at.next()) || noun.plural !== own.plural) return false;
  return (noun.gender === "f") === own.feminine;
}

const DEMONSTRATIVE_FORM: Record<string, { feminine: boolean | null; plural: boolean }> = {};
for (const [forms, feminine] of [
  ["este ese aquel", false],
  ["esta esa aquella", true],
] as const)
  for (const form of forms.split(" ")) {
    DEMONSTRATIVE_FORM[form] = { feminine, plural: false };
    DEMONSTRATIVE_FORM[form === "aquel" ? "aquellos" : `${form.replace(/e$/u, "o")}s`] = {
      feminine,
      plural: true,
    };
  }

const isPerfectParticipleLike = (word: string) => /(?:ado|ido)$/u.test(word) && !!participle(word);

/** No finite verb after the word before the sentence ends: "Critica de cine.". */
function verbless(at: Around): boolean {
  for (let k = 1; k <= 8; k++) {
    if (at.endsAfter(k - 1)) return true;
    const word = at.next(k);
    if (!word) return true;
    if (
      /^(?:es|son|era|fue|está|están|hay|ha|han|ve|va|da|dio|vio|hace|tiene|puede|dice)$/u.test(
        word,
      )
    )
      return false;
    if (PREPOSITIONS.has(word) || COMMON_DETERMINERS.has(word) || CONJUNCTIONS.has(word)) continue;
    if (finiteVerb(word) && !isNoun(word) && !attribute(word) && !genderedForm(word)) return false;
  }
  return false;
}

/** "termino" -> "término" where a noun or adjective goes, not a verb. */
function nominal(at: Around): string | null {
  const word = at.tokens[at.i].lower;
  const accented = ACCENTED_NOMINAL.get(word);
  if (!accented) return null;
  const prev = at.prev();
  const next = at.next();
  // "una tremolo": a feminine determiner cannot take the masculine noun either.
  if (
    /^(?:una|unas|mis|tus|sus|toda|otra|otras|muchas|pocas|varias|nuestra|nuestras)$/u.test(prev) &&
    /os?$/u.test(accented)
  )
    return null;
  if (DETERMINERS.has(prev) || DEGREE.has(prev) || SER.has(prev)) return accented;
  // "un termino cuyo origen…": "cuyo" follows the noun it belongs to; "tengo lio": "tener"
  // takes a noun, never a second finite verb.
  if (/^cuy[oa]s?$/u.test(next) || TENER.has(prev)) return accented;
  // "el tristemente celebre episodio": a determiner, an adverb in -mente and the adjective
  // before a noun that agrees with it.
  if (
    /^\p{L}{3,}mente$/u.test(prev) &&
    (COMMON_DETERMINERS.has(at.prev(2)) || /^(?:del|al)$/u.test(at.prev(2))) &&
    (agreesWithNext(at, accented) || (!formOf(accented) && !!readNoun(next) && !finiteVerb(next)))
  )
    return accented;
  // "lo ultimo que quiero", "lo incomodo que es": the neuter "lo" and a relative.
  if (prev === "lo" && next === "que" && /o$/u.test(accented)) return accented;
  // "tu numero": "tú" takes no first or third person verb, so "tu" is the possessive.
  if (prev === "tu" && !word.endsWith("s")) return accented;
  // "Tengo 2 practicas": a count before a plural.
  const count = at.tokens[at.i - 1];
  if (
    count &&
    !at.tokens[at.i].broken &&
    /^\p{N}{1,3}$/u.test(count.text) &&
    count.text !== "1" &&
    accented.endsWith("s")
  )
    return accented;
  // "le pondría ese titulo": after a verb the demonstrative is its object's determiner.
  if (
    DEMONSTRATIVES.has(prev) &&
    ((finiteVerb(at.prev(2)) && !isNoun(at.prev(2))) || isInfinitive(at.prev(2))) &&
    agrees(DEMONSTRATIVE_FORM[prev], accented)
  )
    return accented;
  // "Un destacado interprete": a determiner and an adjective before the word.
  const adjective = genderedForm(prev);
  if (
    adjective &&
    !finiteVerb(prev) &&
    // "Mi abuelo practico el piano": a noun before it is the subject.
    !isNoun(prev) &&
    DETERMINERS.has(at.prev(2)) &&
    adjective.plural === accented.endsWith("s") &&
    (!formOf(accented) || formOf(accented)!.feminine === adjective.feminine)
  )
    return accented;
  // "Capitulo 3", "las paginas 3 y 4": a number after it counts or labels a noun.
  const numbered = /^\p{N}/u.test(at.tokens[at.i + 1]?.text ?? "") && !at.tokens[at.i + 1].broken;
  if (numbered && (at.starts || /^(?:la|las|los)$/u.test(prev))) return accented;
  // "Critica de cine.", "Optimas prestaciones.", "La ultima.": a heading or a fragment with no
  // verb of its own opens with the noun or adjective, not with a verb.
  const opener =
    at.starts ||
    (/^(?:la|las|los)$/u.test(prev) &&
      at.tokens[at.i - 1] &&
      new Around(at.tokens, at.i - 1).starts);
  if (opener && verbless(at)) {
    if (/^(?:la|las|los)$/u.test(prev) && at.endsAfter() && agreesWithArticle(prev, accented))
      return accented;
    // "Termino de trabajar", "Practica de lunes a viernes": a verb before "de" and an
    // infinitive or a time; a short heading ("Lineas de actuación") has neither.
    const after = at.next(2);
    const heading =
      (next === "de" || next === "del") &&
      at.endsAfter(2) &&
      !!after &&
      !isInfinitive(after) &&
      !TIME.has(after);
    if (at.starts && (heading || agreesWithNext(at, accented))) return accented;
  }
  if (DEMONSTRATIVES.has(prev) && PREPOSITIONS.has(at.prev(2))) return accented;
  // "No había termino medio": the impersonal "haber" takes a noun.
  if (/^(?:hay|había|habrá|hubo|haya|habría)$/u.test(prev)) return accented;
  // "La ultima consideración", "aquella magnifica intervención": a noun that agrees with it
  // follows, so the word is an adjective before it.
  if (
    /^(?:la|las|tu|tus|esta|estas|esa|esas|aquella|aquellas)$/u.test(prev) &&
    agreesWithNext(at, accented)
  )
    return accented;
  // "a buen termino", "un gran numero": these short forms only go before a noun.
  if (
    /^(?:buen|gran|primer|tercer|algún|ningún)$/u.test(prev) &&
    (prev === "gran" || /o$/u.test(accented))
  )
    return accented;
  // "Un solo termino", "la extraña maquina": an adjective between a determiner and the word.
  const between = PRENOMINAL.has(prev.replace(/s$/u, ""))
    ? (formOf(prev) ?? { feminine: null, plural: prev.endsWith("s") })
    : null;
  if (
    between &&
    (DETERMINERS.has(at.prev(2)) || /^(?:la|las|los|el)$/u.test(at.prev(2))) &&
    agrees(between, accented)
  )
    return accented;
  // "Hubo que poner termino a aquello": an infinitive's object, the infinitive no preposition's.
  if (isInfinitive(prev) && at.prev(2) && !PREPOSITIONS.has(at.prev(2)) && PREPOSITIONS.has(next))
    return accented;
  // "en la página", "parar la máquina", "la máquina del tiempo": "la" is no clitic there.
  if (/^(?:la|las|los)$/u.test(prev)) {
    // "la termino": a feminine article cannot take the masculine noun.
    if (prev !== "los" && /os?$/u.test(accented)) return null;
    const before = at.prev(2);
    const opens = !!at.tokens[at.i - 1] && new Around(at.tokens, at.i - 1).starts;
    return PREPOSITIONS.has(before) ||
      // "es la valida": "ser" takes no clitic.
      (SER.has(before) && agreesWithArticle(prev, accented)) ||
      // "La critica que haces": a relative after the noun opening the clause.
      (opens && next === "que" && agreesWithArticle(prev, accented)) ||
      isInfinitive(before) ||
      // "La maquina del tiempo.", "Las nauseas no se pasan": a clitic never opens a clause
      // before "de" or "no".
      (at.tokens[at.i - 1] &&
        new Around(at.tokens, at.i - 1).starts &&
        /^(?:de|del|no)$/u.test(next) &&
        agreesWithArticle(prev, accented)) ||
      /(?:ado|ido)$/u.test(before) ||
      (!!before &&
        (next === "de" || next === "del") &&
        !NOT_BEFORE_ARTICLE.has(before) &&
        !/^\p{Lu}/u.test(at.tokens[at.i - 2].text)) ||
      // "Memorizarás las fórmulas": a clitic goes before its verb, not after another one.
      (!!before && finiteVerb(before) && !isNoun(before) && !CLITICS.has(at.prev(3))) ||
      // "La fábrica produjo…": two finite verbs never stand side by side.
      (!!next &&
        finiteVerb(next) &&
        !isNoun(next) &&
        !attribute(next) &&
        !CLITICS.has(next) &&
        !PREPOSITIONS.has(next) &&
        !CONJUNCTIONS.has(next) &&
        !COMMON_DETERMINERS.has(next))
      ? accented
      : null;
  }
  // "una situación crítica.", "hace tareas específicas": an adjective after its noun.
  if (postponedAdjective(at, accented)) return accented;
  // A preposition never governs a finite verb: "de termino", "en linea", "por ultimo".
  return PREPOSITIONS.has(prev) && prev !== "a" ? accented : null;
}

const ADVERBS = words("no nunca ya también siempre jamás");
// What follows a verb but not a noun or adjective ("trabajo en un banco", "canto hoy");
// "de" and "a" follow both ("repleto de", "junto a").
const ARTICLES = words("el la los las un una unos unas");
const AFTER_VERB = words(
  "el la los las un una hoy ayer anoche mucho poco bien mal tarde pronto en con por para " +
    "sin hasta desde",
);
const SUBJECT_DETERMINERS = words(
  "el la un una mi tu su este esta ese esa aquel aquella nuestro nuestra",
);
// Capitalized words that are no name: "Me quedo", "Al contrario", "Mañana trabajo".
const notName = (word: string) =>
  !GIVEN_NAMES.has(word) &&
  (CLITICS.has(word) ||
    PREPOSITIONS.has(word) ||
    CONJUNCTIONS.has(word) ||
    COMMON_DETERMINERS.has(word) ||
    CLOSED.has(word) ||
    /mente$/u.test(word) ||
    !!attribute(word) ||
    isInfinitive(word) ||
    finiteVerb(word));
const CLOSED = words(
  "al del lo yo tú él ella usted nosotros ellos ellas ustedes no ya hoy ayer anoche mañana aquí " +
    "allí así también tampoco muy más menos siempre nunca entonces luego después antes ahora " +
    "todavía aún",
);
// "Esta semana no puedo", "El año pasado trabajo…": a time phrase, not a subject.
const TIME = words(
  "semana año mes día tarde noche mañana vez momento rato verano invierno otoño primavera " +
    "lunes martes miércoles jueves viernes sábado domingo fin",
);

/**
 * A third-person subject opening the clause right before the verb: a name ("Juan hablo",
 * "Time Magazine llamo") or a determiner and noun ("La policía colaboro"), with at most one
 * adverb between ("Jesús nunca enseño"). "En Madrid trabajo" starts with a preposition.
 */
function nounSubject(at: Around, opens: (k: number) => boolean): boolean {
  const tokens = at.tokens;
  let k = ADVERBS.has(at.prev()) ? 2 : 1;
  // "El pan compro yo": a fronted object.
  if ([1, 2, 3].some((n) => at.next(n) === "yo")) return false;
  let names = 0;
  while (
    names < 3 &&
    tokens[at.i - k]?.word &&
    /^\p{Lu}\p{Ll}/u.test(tokens[at.i - k].text) &&
    !notName(tokens[at.i - k].lower) &&
    at.prev(k)
  ) {
    names++;
    k++;
  }
  if (names > 0) return opens(k - 1);
  const noun = at.prev(k);
  const det = at.prev(k + 1);
  return (
    !!noun &&
    SUBJECT_DETERMINERS.has(det) &&
    !TIME.has(noun) &&
    (isNoun(noun) || !!attribute(noun)) &&
    !noun.endsWith("s") &&
    opens(k + 1) &&
    // "que un grupo deshonesto tenga": an adjective, unless a verb's company follows.
    (AFTER_VERB.has(at.next()) || at.next() === "a" || at.next() === "al")
  );
}

/** "se creo" -> "creó", "él hablo" -> "habló", "no sabia" -> "sabía". */
function verbAccent(at: Around): string | null {
  const word = at.tokens[at.i].lower;
  const prev = at.prev();
  // A first-person present never follows "se" or a third-person subject.
  // The subject opens its clause: "Ella habló", "y él no le habló" (not "tiene usted empleo").
  const opens = (k: number) => {
    const before = new Around(at.tokens, at.i - k);
    return before.starts || /^(?:y|e|pero|que|cuando|porque|pues|aunque)$/u.test(before.prev());
  };
  const pronounSubject =
    (SUBJECTS.has(prev) && opens(1)) ||
    (SUBJECTS.has(at.prev(2)) && /^(?:no|le|les|lo|la|me|te|nos)$/u.test(prev) && opens(2)) ||
    // "Él no le hablo": "no" and a clitic between.
    (SUBJECTS.has(at.prev(3)) &&
      at.prev(2) === "no" &&
      /^(?:le|les|lo|la|me|te|nos|se)$/u.test(prev) &&
      opens(3));
  // After a named subject, a noun twin ("Mi madre trabajo en…") is the verb when what follows
  // goes with a verb; "el niño modelo saluda" keeps its noun.
  const named =
    !pronounSubject &&
    /o$/u.test(word) &&
    !participle(word) &&
    // "La revista catalogo la campaña": an article right after makes even "catálogo" the verb.
    (!ACCENTED_NOMINAL.has(word) || ARTICLES.has(at.next())) &&
    at.tokens[at.i + 1]?.text !== "-" &&
    // "Uber pago a sus socios", but "el niño modelo a seguir".
    (!(isNoun(word) || attribute(word)) ||
      AFTER_VERB.has(at.next()) ||
      (at.next() === "a" &&
        !isInfinitive(at.next(2)) &&
        !/^(?:junto|debido|respecto)$/u.test(word))) &&
    nounSubject(at, opens);
  const subject = pronounSubject || named;
  if ((prev === "se" && at.prev(2) !== "per") || subject) {
    const m = /^(\p{L}{2,})o$/u.exec(word);
    // "lio" and "guion" take no accent; nouns and adjectives after "él" are not verbs.
    // "Ella, creo, no lo sabe": a parenthetical first person.
    const aside =
      FUNCTION_WORDS.has(word) ||
      (subject && /^(?:creo|pienso|supongo|digo|imagino|opino)$/u.test(word));
    // "Él tranquilo, ella nerviosa" leaves the copula out; "él trabajo varias horas" and "él
    // limpio la herida" go on as a verb does.
    const nominal =
      pronounSubject &&
      (isNoun(word) || attribute(word)) &&
      !AFTER_VERB.has(at.next()) &&
      !/^(?:varias|varios|muchas|muchos|dos|tres|cuatro|cinco|algunas|algunos)$/u.test(at.next());
    if (m && word.length > 3 && !aside && !nominal) {
      if (isVerb(`${m[1]}ar`)) return `${m[1]}ó`;
      if ((isVerb(`${m[1]}er`) || isVerb(`${m[1]}ir`)) && !isNoun(word)) return `${m[1]}ió`;
    }
  }
  // "Nos lo confeso", "Me lo recordo": a stem-changing -ar verb has no present on its plain
  // stem ("confieso"), so after a clitic the -o form is the preterite missing its accent. "lo"
  // alone may be the neuter article before an adjective.
  const plainStem = /^(\p{L}{3,})o$/u.exec(word);
  if (
    plainStem &&
    CLITICS.has(prev) &&
    isVerb(`${plainStem[1]}ar`) &&
    !finiteVerb(word) &&
    !isNoun(word) &&
    (!attribute(word) || !/^(?:lo|la|los|las)$/u.test(prev) || CLITICS.has(at.prev(2)))
  )
    return `${plainStem[1]}ó`;
  if (BEFORE_VERB.has(prev)) {
    const m = /^(\p{L}+)ia(s|n|mos)?$/u.exec(word);
    // "lo hacia abajo": the preposition "hacia".
    const direction =
      word === "hacia" &&
      /^(?:abajo|arriba|adelante|atrás|afuera|adentro|allá|acá|aquí|allí|delante|el|la|los|las)$/u.test(
        at.next(),
      );
    if (!direction && m && (isVerb(`${m[1]}er`) || isVerb(`${m[1]}ir`) || isInfinitive(m[1])))
      return `${m[1]}ía${m[2] ?? ""}`;
  }
  // "con él varias cosas": a pronoun after a preposition is no subject.
  const governed = SUBJECTS.has(prev) && PREPOSITIONS.has(at.prev(2));
  if (!governed && (BEFORE_VERB.has(prev) || /^(?:ya|tú|que|si|quién)$/u.test(prev))) {
    // "se continua" -> "continúa", "lo amplias" -> "amplías": -uar/-iar verbs stress the vowel.
    // Every -uar verb but -guar/-cuar ("averigua"); only the listed -iar verbs ("cambia" is not).
    const stressed = /^(\p{L}+)([ui])(a|as|an|e|es|en)$/u.exec(word);
    const iar =
      stressed?.[2] === "i" &&
      /^(?:ampl|env|conf|f|var|cr|gu|enfr|desv|vac|esp|desaf|exp|resfr|hast|roc)$/u.test(
        stressed[1],
      );
    const uar = stressed?.[2] === "u" && !/[gc]$/u.test(stressed[1]);
    if (stressed && (iar || uar) && isVerb(`${stressed[1]}${stressed[2]}ar`) && !isNoun(word))
      return `${stressed[1]}${stressed[2] === "u" ? "ú" : "í"}${stressed[3]}`;
    // "ya veras" -> "verás", "se ira" -> "irá": a future without its accent.
    const future = /^(\p{L}*?[eií]r)(a|as|an|e)$/u.exec(word);
    if (
      future &&
      (isInfinitive(future[1]) || future[1] === "ir") &&
      (!isNoun(word) || /^(?:ya|tú|se|me|te|le|lo|no)$/u.test(prev)) &&
      word !== "para"
    )
      return `${future[1]}${{ a: "á", as: "ás", an: "án", e: "é" }[future[2]]}`;
  }
  // "Yo lo analice ayer", "Me enfade.", "Ayer tome el día libre" -> "analicé", "enfadé",
  // "tomé": an -ar subjunctive needs a trigger before it ("que yo cante"), so at a sentence
  // start after "yo", "me" or "ayer" it is the first person preterite without its accent.
  if (/^\p{L}{3,}e$/u.test(word) && subjunctiveLike(word) && !isNoun(word) && !attribute(word)) {
    let k = 1;
    while (k < 3 && /^(?:me|te|lo|la|los|las|le|les|nos|os)$/u.test(at.prev(k))) k++;
    const lead = at.prev(k);
    const leadStarts = new Around(at.tokens, at.i - k).starts;
    const clitics = k > 1 && new Around(at.tokens, at.i - k + 1).starts;
    // "cuando ayer lo analice", "cuando lo analice la semana pasada": a past time in the
    // clause rules out the subjunctive's future.
    const pastAfter = [1, 2, 3].some(
      (n) =>
        /^(?:ayer|anoche|anteayer)$/u.test(at.next(n)) ||
        (/^(?:pasado|pasada)$/u.test(at.next(n)) &&
          /^(?:semana|año|mes|lunes|martes|miércoles|jueves|viernes|sábado|domingo|verano|invierno)$/u.test(
            at.next(n - 1),
          )),
    );
    if (
      (leadStarts && /^(?:yo|ayer|anoche|anteayer)$/u.test(lead)) ||
      // A clitic before the verb and no "que" trigger before it ("el ayer ocupe" is a noun).
      (k > 1 &&
        lead !== "que" &&
        (/^(?:ayer|anoche|anteayer)$/u.test(lead) || pastAfter) &&
        !DETERMINERS.has(at.prev(k + 1))) ||
      // "Me envíe la factura" may be a request: only before the clause end or a preposition.
      (clitics &&
        at.prev(k - 1) === "me" &&
        (at.endsAfter() || /^(?:a|en|de|con|sin|por)$/u.test(at.next())))
    )
      return `${word.slice(0, -1)}é`;
  }
  // "e ira creciendo", "cómo ira armado": "ira" (anger) takes no gerund or participle after
  // it unless a determiner makes it the noun ("la ira creciendo en su pecho").
  const ira = /^ir(a|as|an)$/u.exec(word);
  if (
    ira &&
    !COMMON_DETERMINERS.has(prev) &&
    !PREPOSITIONS.has(prev) &&
    !/^(?:mi|tu|su|sus|nuestra|vuestra)$/u.test(prev) &&
    // "rechazo e ira dirigido a ellos": two nouns and their participle.
    (isGerund(at.next()) || (isPerfectParticipleLike(at.next()) && !CONJUNCTIONS.has(prev)))
  )
    return `ir${{ a: "á", as: "ás", an: "án" }[ira[1]]}`;
  // "Cantara mañana" -> "cantará", "¿Cuándo llegaras?" -> "llegarás": an -ar future without
  // its accent reads as a past subjunctive, which needs a trigger ("si", "que") before it.
  const arFuture = /^(\p{L}+ar)(a|as|an)$/u.exec(word);
  if (arFuture && isVerb(arFuture[1]) && !isNoun(word)) {
    const triggered = [1, 2, 3].some((k) => FUTURE_BLOCKERS.has(at.prev(k)));
    const asked =
      /^(?:cuándo|cuánto|cuánta|cuántos|cuántas|dónde|adónde)$/u.test(prev) &&
      at.tokens[at.i - 2]?.text === "¿";
    if (!triggered && (asked || at.next() === "mañana"))
      return `${arFuture[1]}${{ a: "á", as: "ás", an: "án" }[arFuture[2]]}`;
  }
  return null;
}
// Words that call for the past subjunctive: "si cantara mañana", "como si lo supiera".
const FUTURE_BLOCKERS = words("si que ojalá aunque como cuando quizá quizás tal");

const DIRECTIONS = words(
  "abajo arriba adelante atrás afuera adentro allá acá aquí allí delante donde dónde",
);
const WEATHER = words("calor frío sol viento fresco bueno malo buen mal");
const AMOUNTS = words("mucho muchos tanto tantos poco pocos demasiado casi unos unas más una un");
const TIME_NOUNS = words(
  "tiempo años días meses semanas horas minutos rato siglos año día mes semana hora minuto",
);
const OBJECT_CLITICS = words("lo la los las le les me te se nos os");

/** "Hacia dos años que…", "lo que hacia", "la hacia otra empresa": the imperfect "hacía". */
function hacia(at: Around): string | null {
  const prev = at.prev();
  const next = at.next();
  // "Se fue hacía el sur", "Miró hacía las estrellas": after a verb of its own, the
  // preposition towards a place.
  if (at.tokens[at.i].lower === "hacía")
    return (DIRECTIONS.has(next) || COMMON_DETERMINERS.has(next)) &&
      finiteVerb(prev) &&
      !isNoun(prev) &&
      !attribute(prev) &&
      !CLITICS.has(prev)
      ? "hacia"
      : null;
  if (at.tokens[at.i].lower !== "hacia") return null;
  // "Entonces hacia las veces de gerente": "hacer las veces".
  if (next === "las" && at.next(2) === "veces") return "hacía";
  const nextToken = at.tokens[at.i + 1];
  const numeral = /^\p{N}/u.test(nextToken?.text ?? "");
  if (DIRECTIONS.has(next) || numeral) return null;
  if (OBJECT_CLITICS.has(prev)) return "hacía";
  if (COMMON_DETERMINERS.has(next)) return null;
  // "¿Qué hacia en la calle?", "lo que hacia no importaba".
  if ((prev === "qué" || (prev === "que" && at.prev(2) === "lo")) && !/^(?:más|ya)$/u.test(next))
    return "hacía";
  if (WEATHER.has(next) || (next === "las" && at.next(2) === "veces")) return "hacía";
  // An amount of time: "hacia mucho tiempo", "hacia dos años que no se veían", "hacia ya
  // treinta días", "hacia muchos, muchos meses que".
  const start = next === "ya" ? 2 : 1;
  const amount = at.next(start);
  if (AMOUNTS.has(amount) || NUMBERS.has(amount)) {
    for (let j = at.i + start, n = 0; j < at.tokens.length && n < 7; j++, n++) {
      const token = at.tokens[j];
      if (token.broken || /^[.;:!?]$/u.test(token.text)) break;
      if (TIME_NOUNS.has(token.lower)) return "hacía";
      // "hacía mucho que no se veían": the amount alone, then "que".
      if (token.lower === "que" && j === at.i + start + 1) return "hacía";
    }
  }
  return null;
}

const DEGREE_BEFORE = words("muy tan poco más menos bastante demasiado ya");
const LINKS = words("es era fue está estaba estuvo parece parecía puso quedó quedaba sea");

/** "Esta observación seria correcta": the conditional "sería" before its attribute. */
function seria(at: Around): string | null {
  if (at.tokens[at.i].lower !== "seria") return null;
  const prev = at.prev();
  if (DEGREE_BEFORE.has(prev) || LINKS.has(prev) || COMMON_DETERMINERS.has(prev)) return null;
  let k = 1;
  if (/^(?:más|menos|muy|tan|mucho|bastante)$/u.test(at.next(k))) k++;
  const next = at.next(k);
  if (next === "yo" || next === "mejor" || next === "peor") return "sería";
  if (!next || LEADING.has(next)) return null;
  const form = genderedForm(next) ?? participle(next);
  if (form) return form.plural ? null : "sería";
  // "todo seria más difícil": any adjective after a degree word.
  return k === 2 && isNoun(next) ? "sería" : null;
}
const LEADING = words("otra otro otras otros misma mismo tercera segunda primera cierta");

// Future and imperfect forms whose plain spelling is a noun: "sera" (a basket), "veras" (de
// veras), "venia" (leave). A subject, "no" or a sentence start before them makes them verbs.
const PLAIN_TWINS: Record<string, string> = {
  sera: "será",
  seras: "serás",
  serian: "serían",
  veras: "verás",
  venia: "venía",
};
const SUBJECT_OR_NO = words(
  "yo tú él ella usted ellos ellas ustedes eso esto estos esos aquellos no ya nunca también " +
    "tampoco",
);
const VERAS_NEXT = words("el la los las un una lo que qué cómo cuándo si");
function plainTwin(at: Around): string | null {
  const word = at.tokens[at.i].lower;
  const fix = PLAIN_TWINS[word];
  if (!fix) return null;
  const prev = at.prev();
  if (!(at.starts || SUBJECT_OR_NO.has(prev))) return null;
  const next = at.next();
  // "Veras el resultado", "Venia de lejos"; "veras" alone is "de veras" ("¿Veras?").
  if (word === "veras") return VERAS_NEXT.has(next) ? fix : null;
  if (word === "venia") return /^(?:de|a|desde|con|por)$/u.test(next) ? fix : null;
  return next ? fix : null;
}
const NUMBERS = words(
  "dos tres cuatro cinco seis siete ocho nueve diez once doce quince veinte treinta cien mil",
);

// Nouns with a stressed "i" in hiatus whose plain spelling is a preterite since 2010 ("lio",
// "rio", "frio" from "liar", "reír", "freír"). A determiner or a verb that takes the noun
// before them makes them nouns.
const HIATUS_NOUNS: Record<string, string> = { lio: "lío", rio: "río", frio: "frío" };
const BEFORE_HIATUS_NOUN = words(
  "del al menudo tremendo gran buen qué vaya mucho poco tanto más menos muy ni hace hacía " +
    "hizo hará tengo tienes tiene tenemos tienen tenía tenían hay había paso pasa pasé pasamos",
);
function hiatusNoun(at: Around): string | null {
  const fix = HIATUS_NOUNS[at.tokens[at.i].lower];
  const prev = at.prev();
  // "Rio de Janeiro": a river name ("Río de la Plata") with a name after "de".
  const named = at.tokens[at.i].text === "Rio" && at.next() === "de";
  if (named && /^\p{Lu}/u.test(at.tokens[at.i + 2]?.text ?? "")) return fix;
  return fix && (COMMON_DETERMINERS.has(prev) || BEFORE_HIATUS_NOUN.has(prev)) ? fix : null;
}

/** "El hecho en si sucedió", "la idea en si es buena": "en sí" (in itself) after a noun. */
function inItself(at: Around): string | null {
  if (at.tokens[at.i].lower !== "si" || at.prev() !== "en") return null;
  // "Piensa en si vendrá": after a verb, "si" opens an indirect question.
  const head = at.prev(2);
  if (!isNoun(head) || finiteVerb(head) || isInfinitive(head)) return null;
  const next = at.next();
  return at.endsAfter() || (finiteVerb(next) && !isNoun(next)) || SER.has(next) ? "sí" : null;
}

function verbAccents(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "es")) return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
    const at = new Around(tokens, i);
    const fix =
      nominal(at) ??
      verbAccent(at) ??
      hacia(at) ??
      seria(at) ??
      plainTwin(at) ??
      hiatusNoun(at) ??
      inItself(at);
    if (!fix) continue;
    const finding = replaceToken(
      ctx,
      token,
      [fix],
      RULE,
      "review_msg_spanish_accent",
      tokens[i - 1] ?? token,
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: verbAccents }];
