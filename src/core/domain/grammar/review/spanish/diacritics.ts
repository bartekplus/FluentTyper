import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  Around,
  attributeOf,
  CLITICS,
  DETERMINERS,
  isInfinitive,
  PREPOSITIONS,
  replaceToken,
  tokenize,
  verbLike,
  words,
  type Token,
} from "./common";
import {
  finiteVerb,
  isGenderedEntry,
  isGerund,
  isNoun,
  secondPersonVerb,
  subjunctiveLike,
} from "./lexicon";

/** Any noun or adjective the lexicon knows: "mente", "retrato", "asistencia". */
const known = (word: string) => isNoun(word) || !!attributeOf(word) || isGenderedEntry(word);

// Question words after ¿ and ¡ or a verb of knowing (qué, cómo, dónde), and the stressed
// monosyllables (tú, él, mí, sí, sé, dé, té, más, aún) told from their unstressed twins by
// the closed-class word beside them.

const RULE = "spanishAccents" as const;

const INTERROGATIVE: Record<string, string> = {
  que: "qué",
  como: "cómo",
  donde: "dónde",
  adonde: "adónde",
  cuando: "cuándo",
  quien: "quién",
  quienes: "quiénes",
  cual: "cuál",
  cuales: "cuáles",
  cuanto: "cuánto",
  cuanta: "cuánta",
  cuantos: "cuántos",
  cuantas: "cuántas",
  cuan: "cuán",
};
// Words a question may open with before its question word: "¿Y de qué…?", "¿Pero cómo…?".
const LEAD = words("y e o u pero pues entonces bueno ah oye");
const ADVERBIALS = words("bien mal tarde pronto aquí allí ahí siempre nunca");
// Verbs whose object can be an indirect question: "no sé qué hacer", "pregunta dónde vive".
const KNOWING =
  /^(?:sé|sabe|sabes|sabemos|saben|sabéis|sabía|sabías|sabían|sabíamos|saber|sabiendo|supe|supo|supieron|supiera|supiéramos|pregunt\p{L}*|decidir|decide|decidió|decidieron|elegir|explica|explícame|explíqueme|explicar|imagin\p{L}*|recuerdo|recuerda|recordaba|averiguar|entender|entiendo|ignoro|dime|dinos)$/u;

// The verbs whose "que" + noun can only be "qué": "¿sabes qué libro…?", "pregunta qué hora es".
const ASKING =
  /^(?:sé|sabe|sabes|sabemos|saben|sabía|sabías|sabían|saber|pregunt\p{L}*|decidir|elegir|averiguar|se)$/u;

/** The question word right after "¿"/"¡", after at most one lead word and one preposition. */
function opensQuestion(at: Around): "?" | "!" | null {
  let j = at.i - 1;
  if (PREPOSITIONS.has(at.prev(1)) && !at.tokens[at.i].broken) j--;
  if (LEAD.has(at.tokens[j]?.lower ?? "") && at.tokens[j]?.word) j--;
  const mark = at.tokens[j];
  if (!mark || (j < at.i - 1 && at.tokens[j + 1].broken)) return null;
  return mark.text === "¿" ? "?" : mark.text === "¡" ? "!" : null;
}

const SUBJECTS = words(
  "yo tú él ella usted nosotros nosotras vosotros vosotras ellos ellas ustedes",
);

/** A noun that no reading makes a verb form: "hora", "libro", "nombre". */
export function solidNoun(word: string): boolean {
  return (
    !!word &&
    isNoun(word) &&
    !attributeOf(word) &&
    !(verbLike(word) && !word.endsWith("o")) &&
    !secondPersonVerb(word) &&
    !subjunctiveLike(word) &&
    !isInfinitive(word) &&
    !FINITE.has(word) &&
    !NOT_NOUNS.has(word) &&
    !DETERMINERS.has(word)
  );
}
// Irregular finite verbs and adverbs the dictionary also lists as nouns.
const FINITE = words(
  "es son era fue fui vino dijo hizo puso tuvo estuvo quiso supo pudo trajo anduvo ve ven " +
    "eres soy somos sois estás " +
    "da dan haz pon sal ten di va van ha han hay",
);
const NOT_NOUNS = words(
  "sí no bien mal mañana tarde hoy ayer noche siempre nunca igual tal solo sola así esto eso " +
    "aquello ese esa qué cómo dónde cuándo quién cuál cuánto",
);

/**
 * "¿Que has visto un ovni?", "¿Que el vecino vino?": a question that repeats a statement
 * ("you say that…?") rather than asking "what". Its clause names what "qué" would ask for.
 */
function echoQuestion(at: Around): boolean {
  let haber = false;
  let afterPreposition = false;
  for (let j = at.i + 1; j < at.tokens.length && j < at.i + 12; j++) {
    const token = at.tokens[j];
    if (token.broken || token.text === "?" || /^[.!;]$/u.test(token.text)) return false;
    if (!token.word) {
      if (/^\p{N}/u.test(token.text)) return true;
      continue;
    }
    const word = token.lower;
    if (j > at.i + 1 && /^\p{Lu}/u.test(token.text)) return true;
    if (DETERMINERS.has(word) || SUBJECTS.has(word) || word === "que" || word === "no") return true;
    if (/[áéíóú]/u.test(word) && Object.values(INTERROGATIVE).includes(word)) return true;
    if (/^\p{L}{4,}mente$/u.test(word)) return true;
    if (j === at.i + 1 || (CLITICS.has(at.tokens[j - 1].lower) && !haber)) {
      if (subjunctiveLike(word)) return true;
    }
    // "te pasa" is a verb after its clitic, not the adjective "pasa".
    const afterClitic = CLITICS.has(at.tokens[j - 1].lower) && verbLike(word);
    if (attributeOf(word) && !haber && !isGerund(word) && !afterClitic) return true;
    if (solidNoun(word) && !afterPreposition) return true;
    haber = /^(?:he|has|ha|hemos|habéis|han|había|habías|habían)$/u.test(word);
    afterPreposition = PREPOSITIONS.has(word);
  }
  return false;
}

// Gerunds whose missing object "qué" asks for: "¿Qué estás haciendo?". Any other progressive
// right after "¿Que" reads as an echo: "¿Que estás temblando?" (you say you are…?).
const ASKED_GERUNDS = words(
  "haciendo diciendo pensando buscando mirando viendo leyendo comiendo bebiendo escribiendo " +
    "esperando tramando planeando preparando cocinando escuchando insinuando sugiriendo " +
    "intentando tomando estudiando contando pidiendo vendiendo comprando ocultando " +
    "escondiendo pasando ocurriendo sucediendo aprendiendo celebrando proponiendo",
);
// Verbs of affection whose object is the clitic before them: "¿Que me adora?" (that she…?).
const AFFECTION =
  /^(?:quier[eo]|quieres|quieren|ama|amas|aman|adora|adoras|adoran|odia|odias|odian)$/u;

/**
 * "¿Que nos odian?", "¿Que estás temblando?": a clause that leaves nothing for "qué" to ask,
 * either a clitic object of a verb of affection or a progressive of a verb rarely asked about.
 */
function echoClause(at: Around): boolean {
  let k = 1;
  if (at.next(k) === "no") k++;
  const first = at.next(k);
  if (/^(?:me|te|lo|la|nos|os|los|las)$/u.test(first) && AFFECTION.test(at.next(k + 1)))
    return at.endsAfter(k + 1);
  if (/^(?:estás|está|están|estáis|estamos|estaba|estabas|estaban)$/u.test(first)) {
    const gerund = at.next(k + 1);
    return isGerund(gerund) && !ASKED_GERUNDS.has(gerund) && at.endsAfter(k + 1);
  }
  return false;
}

/** A subjunctive verb before the "?": "¿Para que Juan venga?" states a purpose. */
function purposeClause(at: Around): boolean {
  for (let j = at.i + 1; j < at.tokens.length && j < at.i + 12; j++) {
    const token = at.tokens[j];
    if (token.broken || /^[?.!;]$/u.test(token.text)) return false;
    if (token.word && subjunctiveLike(token.lower) && !isNoun(token.lower)) return true;
  }
  return false;
}

/** What follows a "que" can only be read as a wish or an echo: "¡Que te vaya bien!". */
function wishAfter(at: Around, k = 1): boolean {
  let word = at.next(k);
  while (CLITICS.has(word) || word === "no") word = at.next(++k);
  return subjunctiveLike(word);
}

/** At most three words, none a finite verb, close the clause after tokens[i + k]. */
function shortClause(at: Around, k: number): boolean {
  for (let n = 1; n <= 4; n++) {
    if (at.endsAfter(k + n - 1)) return true;
    const word = at.next(k + n);
    if (!word || FINITE.has(word) || word === "está" || word === "que") return false;
  }
  return false;
}

/** A finite verb form: "pasa", "piensas", "ha", "hay", "quiere". */
const FINITE_NOT_NOUN = (word: string) =>
  FINITE.has(word) || /^(?:hay|he|has|ha|hemos|han|había|habían)$/u.test(word) || finiteVerb(word);

/** Inside a question opened by "¿": "¿Crees que no sé que me mientes?" states a fact. */
function inQuestion(at: Around): boolean {
  for (let j = at.i - 1; j >= Math.max(0, at.i - 16); j--) {
    const text = at.tokens[j].text;
    if (text === "¿") return true;
    if (/^[.!?;]$/u.test(text) || at.tokens[j + 1].broken) return false;
  }
  return false;
}

function interrogative(at: Around): string | null {
  const word = at.tokens[at.i].lower;
  const accented = INTERROGATIVE[word];
  if (!accented) return null;
  const next = at.next();
  const nextToken = at.tokens[at.i + 1];
  const prev = at.prev();
  const mark = opensQuestion(at);
  if (mark === "?") {
    // "¿Como cuánto?", "¿como para pagar?": approximation and purpose, not "how".
    if (word === "como" && (DETERMINERS.has(next) || next === "para" || /[áéíóú]/u.test(next)))
      return null;
    if ((word === "cuando" || word === "como") && wishAfter(at)) return null;
    if (word !== "que") return accented;
    // "¿A qué hora?"; "¿A que te ha gustado?" is a bet.
    if (prev === "a") return solidNoun(next) ? accented : null;
    // "¿Por qué no viniste?", "¿De qué sirve?"; "¿Para que lo sepas?" is a purpose clause.
    // "¿Con que esta era la felicidad?" (so this was…) introduces a clause.
    if (PREPOSITIONS.has(prev)) return purposeClause(at) || DETERMINERS.has(next) ? null : accented;
    if (next === "tal" || (solidNoun(next) && !DETERMINERS.has(next))) return accented;
    return echoQuestion(at) || echoClause(at) ? null : accented;
  }
  if (mark === "!") {
    if (word !== "que" && word !== "como" && word !== "cuan") return null;
    if (CLITICS.has(next) && word === "que") return null;
    // "¡Cómo me gusta!"; "¡Como le he dicho!" (as) and "¡Como se lo digo!" (if) are not.
    if (word === "como")
      return /^(?:me|te|nos|os)$/u.test(next) &&
        !/^(?:he|has|ha)$/u.test(at.next(2)) &&
        !wishAfter(at)
        ? accented
        : null;
    if (word === "cuan") return accented;
    // "¡Qué bonito!", "¡Qué suerte!", "¡Qué mal!", but "¡Que aproveche!", "¡Que sí!".
    return next &&
      !subjunctiveLike(next) &&
      next !== "sí" &&
      next !== "no" &&
      (isNoun(next) ||
        !!attributeOf(next) ||
        ADVERBIALS.has(next) ||
        next === "tan" ||
        next === "más")
      ? accented
      : null;
  }
  // "¿Y tú qué cuentas?", "¿Y ahora qué?": a subject or "ahora" between "¿" and the word.
  if (
    word === "que" &&
    /^(?:tú|usted|ustedes|vosotros|vosotras|ellos|ellas|él|ella|esto|eso|aquello|ahora|entonces)$/u.test(
      prev,
    ) &&
    opensQuestion(new Around(at.tokens, at.i - 1)) === "?" &&
    (!next || !wishAfter(at))
  )
    return accented;
  // "a cambio de qué.", "Para hacer qué.", "no recordaba qué.": a "que" closing the sentence
  // after a preposition, an infinitive or a verb of knowing asks.
  if (
    word === "que" &&
    /^[.!?]$/u.test(nextToken?.text ?? "") &&
    !nextToken.broken &&
    at.tokens[at.i + 2]?.text !== "." &&
    (PREPOSITIONS.has(prev) || KNOWING.test(prev) || isInfinitive(prev))
  )
    return accented;
  // "No sé qué pasa", "no sé qué le pasa": present "no sé" cannot state what it denies knowing,
  // so an indicative after it is asked about ("No sé que sea así" keeps the conjunction).
  if (word === "que" && prev === "sé" && /^(?:no|ni)$/u.test(at.prev(2)) && !inQuestion(at)) {
    const verb = CLITICS.has(next) ? at.next(2) : next;
    if (verb && FINITE_NOT_NOUN(verb) && !subjunctiveLike(verb)) return accented;
  }
  // "no sé qué hacer", "sabes qué libro", "pregunta dónde vive".
  if (KNOWING.test(prev) || (prev === "se" && /^(?:no|yo|lo|ya)$/u.test(at.prev(2)))) {
    if (!next) return null;
    // "no sé qué hacer ahora"; "sé que bajar música sin pagar está mal" is a statement.
    if (isInfinitive(next)) return shortClause(at, 1) ? accented : null;
    if (word === "que") return ASKING.test(prev) && solidNoun(next) ? accented : null;
    if (word === "donde" || word === "adonde" || word === "quien" || word === "quienes")
      return CLITICS.has(next) || !!nextToken?.word ? accented : null;
    if (word === "cual" || word === "cuales")
      return /^(?:es|son|era|eran|fue|será|sería|de)$/u.test(next) ? accented : null;
  }
  // "Que divertido.", "Que mujer tan lista.": an exclamation without its opening mark.
  const before = at.tokens[at.i - 1];
  const sentenceStart = !before || at.tokens[at.i].broken || /^[.!?…]$/u.test(before.text);
  if (word === "que" && sentenceStart && next && !subjunctiveLike(next) && !CLITICS.has(next)) {
    const after = at.next(2);
    const closes = at.endsAfter(1) || /^(?:tan|más|es|son|era|está|estaba)$/u.test(after);
    if (closes && (!!attributeOf(next) || (isNoun(next) && !verbLike(next))) && next !== "no")
      return accented;
  }
  return null;
}

// --------------------------------------------------------------- monosyllables

// Words that can follow a possessive "mi" inside its noun phrase.
const BEFORE_NOUN = words(
  "mejor peor mayor menor primer primera último última único única propio propia gran buen " +
    "querido querida pobre viejo vieja nuevo nueva otro otra",
);
const NUMBERS = words("dos tres cuatro cinco seis siete ocho nueve diez cien mil");
/** After "para mi": a word that starts no noun phrase ("para mí es", "aparta de mí este"). */
const notNounPhrase = (word: string) =>
  !BEFORE_NOUN.has(word) &&
  (DETERMINERS.has(word) ||
    PREPOSITIONS.has(word) ||
    NUMBERS.has(word) ||
    /^(?:algo|nada|esto|eso|también|tampoco)$/u.test(word) ||
    ((verbLike(word) || FINITE.has(word) || COMMON_VERBS.has(word) || secondPersonVerb(word)) &&
      !isNoun(word) &&
      !attributeOf(word)));

const ONE_OFF = words("también tampoco nunca jamás mismo misma");
// Finite verbs too common to need the lexicon: "el fue" can only be "él fue".
const COMMON_VERBS = words(
  "es era fue está estaba estuvo tiene tenía tuvo dijo dice hizo hace sabe sabía quiere " +
    "quería quiso puede podía pudo iba ha había será sería",
);
const PRONOUNS = words("yo tú ella usted nosotros nosotras vosotros ellos ellas ti mí él");
const PLAIN_SI_PREV = words("que pues eso claro ahora creo");
const TEA = words("verde negro rojo blanco chino japonés inglés frío caliente helado con y de del");

// Bare objects "dar" takes in set phrases: "dé cuenta", "dé voz", "dé las gracias".
const GIVEN = words("cuenta voz gracias permiso asentimiento golpecitos crédito importancia");
const giveObject = (at: Around) =>
  (GIVEN.has(at.next()) &&
    (at.endsAfter(1) || /^(?:de|del|a|al|por|para|y)$/u.test(at.next(2)))) ||
  (at.next() === "a" && at.next(2) === "luz");
// Subjects that may stand between the subjunctive trigger and "dé".
const SUBJECT_FILLERS = words("él ella usted alguien nadie dios uno cada mismo ahora no nunca ya");

/** "que (alguien) de": a subjunctive trigger, with at most two subject words between. */
function subjunctiveSlot(at: Around): boolean {
  let k = 1;
  while (k <= 3 && SUBJECT_FILLERS.has(at.prev(k))) k++;
  // "más que de cuenta": a comparison.
  return (
    /^(?:que|ojalá|quien|aunque|cuando)$/u.test(at.prev(k)) &&
    !/^(?:más|menos|antes|mejor|peor|tal|así|ya)$/u.test(at.prev(k + 1))
  );
}

/** The words of a monosyllable check: [typed, replacement] or null. */
function monosyllable(at: Around): string | null {
  const word = at.tokens[at.i].lower;
  const prev = at.prev();
  const next = at.next();
  const nextToken = at.tokens[at.i + 1];
  // The clause ends after it: punctuation, not a closing quote ('la palabra "mi".').
  const ends =
    (nextToken ? /^[.,;:!?)]$/u.test(nextToken.text) && !nextToken.broken : true) &&
    !(nextToken?.text === "." && at.tokens[at.i + 2]?.text === ".");
  switch (word) {
    case "mi":
      // "a mí me gusta", "para mí, …", "confía en mí", "aparta de mí este cáliz".
      if (!PREPOSITIONS.has(prev)) return null;
      if (ends || /^(?:mismo|misma|me|que|no|el|la|los|las|lo)$/u.test(next)) return "mí";
      // "en mi contra" is the possessive idiom.
      if (
        next &&
        next !== "contra" &&
        !/^\p{Lu}/u.test(nextToken?.text ?? "") &&
        notNounPhrase(next)
      )
        return "mí";
      if (prev === "a" && isInfinitive(next)) return "mí";
      return (next === "y" || next === "o" || next === "ni") &&
        (PRONOUNS.has(at.next(2)) || PREPOSITIONS.has(at.next(2)))
        ? "mí"
        : null;
    case "tu":
      // "tú no vuelves", "tú también"; but "tu no asistencia", "tu mismo retrato".
      if (CLITICS.has(next)) return "tú";
      // "¿Lo hiciste tú solo?", "Y tú más.".
      if (/^(?:solo|sola|más)$/u.test(next) && at.endsAfter(1)) return "tú";
      // "si tú bajas el precio": a verb with its object, even when it is also a noun.
      if (
        /^(?:si|que|cuando|y|pero|porque|aunque)$/u.test(prev) &&
        /(?:as|es)$/u.test(next) &&
        verbLike(next) &&
        DETERMINERS.has(at.next(2))
      )
        return "tú";
      if ((next === "no" || ONE_OFF.has(next)) && !known(at.next(2))) return "tú";
      if (ends)
        return /^(?:como|entre|que|sino|según|excepto|menos|incluso|y|o|ni)$/u.test(prev)
          ? "tú"
          : null;
      if (next === "y" && PRONOUNS.has(at.next(2)) && PREPOSITIONS.has(prev)) return "tú";
      return secondPersonVerb(next) ? "tú" : null;
    case "tú":
    case "mí":
      // "a tú pie", "aprobará mí envío": a possessive before a noun takes no accent.
      // After a verb it may be the subject: "eres tú", "pones tú".
      if (verbLike(prev) || FINITE.has(prev) || /^(?:como|que|entre)$/u.test(prev)) return null;
      // "Tú cuentas las monedas": a second-person verb that is also a plural noun.
      if (word === "tú" && next.endsWith("s") && finiteVerb(next)) return null;
      return solidNoun(next) && !/^(?:bemol|menor|mayor)$/u.test(next)
        ? word === "tú"
          ? "tu"
          : "mi"
        : null;
    case "el":
      // "para el." / "entre el y yo" / "el se fue" / "el fue": the pronoun "él".
      if (/^[.,;:!?()]$/u.test(nextToken?.text ?? "") || (!nextToken && !at.starts)) return "él";
      // "el pero", "el un día", "cuando el llegó", "el mismo sabe": no noun can follow.
      if (/^(?:pero|aunque|cuando|mientras|un|una|unos|unas)$/u.test(next)) return "él";
      if (/ó$/u.test(next) && !isNoun(next)) return "él";
      if (/^(?:mismo)$/u.test(next) && (COMMON_VERBS.has(at.next(2)) || CLITICS.has(at.next(2))))
        return "él";
      // "el té de menta".
      if (next === "te" && (TEA.has(at.next(2)) || at.endsAfter(1))) return null;
      if (CLITICS.has(next) && next !== "la" && next !== "lo") return "él";
      if (COMMON_VERBS.has(next) || (ONE_OFF.has(next) && next !== "mismo" && next !== "misma"))
        return "él";
      if (
        next === "no" &&
        (CLITICS.has(at.next(2)) ||
          COMMON_VERBS.has(at.next(2)) ||
          FINITE.has(at.next(2)) ||
          /^(?:siempre|nunca|ya)$/u.test(at.next(2)))
      )
        return "él";
      return (next === "y" || next === "o") && PRONOUNS.has(at.next(2)) && PREPOSITIONS.has(prev)
        ? "él"
        : null;
    case "él":
      // "Él coche lo dejé": a bare noun after it wants the article.
      if (!at.starts) return null;
      return solidNoun(next) && !verbLike(next) ? "el" : null;
    case "se":
      // "yo no sé", "lo sé.", "no sé si", "no sé cómo".
      // "se" + an accented question word, "lo se": no clitic reading ("lo" never precedes it).
      if (/[áéíóú]/u.test(next) && Object.values(INTERROGATIVE).includes(next)) return "sé";
      if (prev === "lo" || prev === "me")
        return /^(?:te|le|les|lo|la|los|las)$/u.test(next) ? null : "sé";
      if (!/^(?:no|yo|ya|tampoco|bien)$/u.test(prev)) return null;
      if (ends) return "sé";
      // "no sé la lección", "no sé lo que dices": "se lo/la" with a noun or "que" after.
      if (/^(?:lo|la|los|las)$/u.test(next) && (solidNoun(at.next(2)) || at.next(2) === "que"))
        return "sé";
      return /^(?:si|qué|cómo|dónde|quién|quiénes|cuándo|cuál|cuánto|cuántos|nada|nadie|mucho|muy|poco|eso|esto|que|como|donde|quien|cuando|cual)$/u.test(
        next,
      )
        ? "sé"
        : null;
    case "de":
      // "cuando le dé esto", "que te dé tiempo": a clitic only goes before a verb.
      if (ends && prev) return "dé";
      // "que alguien dé cuenta", "espero que dé a luz": "dar" and its bare object.
      if (giveObject(at) && subjunctiveSlot(at)) return "dé";
      // "cuando te las dé": a clitic pair before it.
      if (/^(?:lo|la|los|las)$/u.test(prev) && /^(?:me|te|se|le|les|nos|os)$/u.test(at.prev(2)))
        return "dé";
      if (!/^(?:me|te|le|les|nos|os)$/u.test(prev)) return null;
      // "el te de menta", and a sentence-initial "Te de…" (tea) are not clitics.
      if (DETERMINERS.has(at.prev(2)) || PREPOSITIONS.has(at.prev(2))) return null;
      if (new Around(at.tokens, at.i - 1).starts) return null;
      return isInfinitive(next) ? null : "dé";
    case "té":
      // "Se té han caído": a clitic, not tea.
      return /^(?:se|me|no)$/u.test(prev) && !!next && !TEA.has(next) ? "te" : null;
    case "te":
      // "un té", "el té verde", "leche con té".
      if (prev === "un" || prev === "una") return "té";
      if ((prev === "de" || prev === "con") && (ends || next === "y" || next === "ahora"))
        return "té";
      return (prev === "el" || prev === "del" || prev === "al") && (ends || TEA.has(next))
        ? "té"
        : null;
    case "si": {
      // "dije que sí.", "¡Sí!", "el sí", "eso sí,": a clause-final "si" is the affirmative.
      if (prev === "el" || prev === "un") return next && isNoun(next) ? null : "sí";
      // "sí que me gusta", "en sí de alegría".
      if (next === "que" && !at.endsAfter(1) && prev !== "como") return "sí";
      if (prev === "en" && (next === "de" || ends)) return "sí";
      if (nextToken?.text === ",") return PLAIN_SI_PREV.has(prev) ? "sí" : null;
      return ends ? "sí" : null;
    }
    case "aun":
      // "aún no", "aún más", "más aún", "es mi marido aún.": still.
      if (next === "no" && !isGerund(at.next(2))) return "aún";
      if (/^(?:más|menos|mayor|menor|mejor|peor)$/u.test(next)) return "aún";
      if (/^(?:más|menos)$/u.test(prev)) return "aún";
      // "Aún recuerdo", "aún se desconoce": still, before the verb or its clitic.
      if (CLITICS.has(next) && next !== "la" && next !== "las" && next !== "los") return "aún";
      return ends && !at.starts ? "aún" : null;
    case "aún":
      if (prev === "ni") return "aun";
      // "aun así,", "aun si", "aun siendo": even.
      // "más aún si" (even more) keeps the accent.
      if (/^(?:más|menos|mejor|peor|mayor|menor)$/u.test(prev) || /mente$/u.test(prev)) return null;
      if (next === "si" || next === "cuando" || isGerund(next)) return "aun";
      return next === "así" && at.tokens[at.i + 2]?.text === "," ? "aun" : null;
    case "mas":
      // "lo más", "no hay más que", "más tarde": "mas" (but) only starts a clause.
      if (at.starts || at.tokens[at.i - 1]?.text === ",") return null;
      if (/^\p{Lu}/u.test(at.tokens[at.i].text)) return null;
      if (DETERMINERS.has(prev) || prev === "lo") return "más";
      if (ends || /^(?:que|de|tarde|temprano|bien|mal|o|allá|adelante|grande|pequeño)$/u.test(next))
        return "más";
      return /^\p{N}/u.test(nextToken?.text ?? "") || !!attributeOf(next) ? "más" : null;
    default:
      return null;
  }
}

function diacritics(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token: Token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
    const at = new Around(tokens, i);
    const question = interrogative(at);
    const fix = question ?? monosyllable(at);
    if (!fix) continue;
    const key = question
      ? "review_msg_spanish_interrogative"
      : /[áéíóú]/u.test(fix)
        ? "review_msg_spanish_accent"
        : "review_msg_spanish_accent_extra";
    const finding = replaceToken(ctx, token, [fix], RULE, key, tokens[i + 1]);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: diacritics }];
