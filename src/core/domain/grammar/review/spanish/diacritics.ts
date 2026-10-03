import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { readNoun } from "./agreement";
import {
  Around,
  attributeOf,
  CLITICS,
  CONJUNCTIONS,
  DETERMINERS,
  endsQuestion,
  greetingSlot,
  INVARIANT,
  isInfinitive,
  PREPOSITIONS,
  PRENOMINAL,
  replaceToken,
  tokenize,
  verbLike,
  words,
  type Token,
} from "./common";
import {
  finiteVerb,
  genderedForm,
  isGenderedEntry,
  isGerund,
  isNoun,
  participle,
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
  /^(?:sé|sabe|sabes|sabemos|saben|sabéis|sabía|sabías|sabían|sabíamos|saber|sabiendo|sabido|sabrá|sabré|sabría|supe|supo|supieron|supiera|supiéramos|pregunt\p{L}*|decidir|decide|decidió|decidieron|elegir|explica|explícame|explíqueme|explicar|imagin\p{L}*|recuerdo|recuerda|recordaba|averiguar|entender|entiendo|ignoro|dime|dinos)$/u;

// Nouns a question asks about after a preposition: "hasta qué punto", "de qué manera".
const QUESTION_NOUNS = words(
  "punto forma manera modo hora color momento medida tipo clase edad precio tamaño frecuencia " +
    "razón motivo lado parte",
);

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
  "es son era fue fui vino dije dijo hizo puso tuvo estuvo quiso supo pudo trajo anduvo ve ven " +
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
  for (let n = 1; n <= 8; n++) {
    if (at.endsAfter(k + n - 1)) return true;
    const word = at.next(k + n);
    if (!word || FINITE.has(word) || word === "está" || word === "que") return false;
    // Past four words, only a clause with no other verb: "qué regalarle a los niños por Navidad".
    if (n > 4 && finiteVerb(word) && !isNoun(word) && !attributeOf(word)) return false;
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

const QUANTITY = words(
  "mucho mucha muchos muchas poco poca pocos pocas varios varias algunos algunas algún alguna " +
    "ningún ninguna tantos tantas bastantes demasiados demasiadas dos tres cuatro cinco cien mil",
);
const EXISTS = words("hay había habrá hubo habría");
const PLACE_START = words(
  "en a al dentro detrás debajo encima fuera delante tras bajo sobre aquí allí ahí allá",
);
const EVENT = /^(?:pas|ocurr|suced)(?:a|ó|aba|ará|ará|ía|e|ió|erá|irá|ado|ido)$/u;
const AFTER_EVENT = words(
  "aquí allí ahí allá ahora hoy ayer entonces realmente exactamente después antes luego",
);

/** "que hay en la caja.": "hay" and a place, then the clause ends with nothing that exists. */
function missingThing(at: Around): boolean {
  if (!EXISTS.has(at.next()) || !PLACE_START.has(at.next(2))) return false;
  // Words of the place phrase since its last preposition or determiner: a bare noun takes
  // one ("en casa"), an article up to three ("en aquella enorme caja azul"); more is the
  // thing that exists ("en casa comida", "en la sala un piano").
  let content = 0;
  let room = 1;
  for (let k = 3; k <= 9; k++) {
    if (at.endsAfter(k - 1)) return true;
    const word = at.next(k);
    if (!word) return false;
    if (PREPOSITIONS.has(word)) {
      content = 0;
      room = /^(?:al|del)$/u.test(word) ? 3 : 1;
    } else if (DETERMINERS.has(word) || SUBJECTS.has(word) || QUANTITY.has(word)) {
      if (content) return false;
      room = 3;
    } else if (FINITE_NOT_NOUN(word) && !isNoun(word)) return false;
    else if (++content > room) return false;
  }
  return false;
}

/** "que ocurrió.", "que le pasa aquí", "que ha pasado": an event with no subject after it. */
function untoldEvent(at: Around): boolean {
  let k = 1;
  if (CLITICS.has(at.next(k))) k++;
  if (/^(?:ha|había|habrá|habría)$/u.test(at.next(k))) k++;
  if (!EVENT.test(at.next(k))) return false;
  if (AFTER_EVENT.has(at.next(k + 1))) k++;
  return at.endsAfter(k);
}

// "hacer" with no object of its own, after a dative clitic and a modal or "haber".
const DEED =
  /^(?:hacer|hacerles?|hago|haces|hace|hacemos|hacen|hice|hiciste|hizo|hicimos|hicieron|hecho|haré|harás|hará|haría|harías)$/u;
const BEFORE_DEED =
  /^(?:puedo|puedes|puede|podemos|pueden|podría|podrías|debo|debes|debe|debemos|deben|quiero|quieres|quiere|queremos|quieren|voy|vas|va|vamos|van|tengo|tienes|tiene|tenemos|tienen|he|has|ha|hemos|han|había|habías|habían)$/u;
const AFTER_DEED = words("para con ahora hoy mañana aquí allí ahí después luego");

/** "sé qué has hecho.", "saber qué puedo hacer para…": the deed is asked about, not stated. */
function untoldDeed(at: Around): boolean {
  let k = 1;
  if (/^(?:me|te|le|les|nos|os)$/u.test(at.next(k))) k++;
  if (BEFORE_DEED.test(at.next(k))) {
    k++;
    if (/^(?:a|que)$/u.test(at.next(k))) k++;
  }
  if (!DEED.test(at.next(k))) return false;
  return at.endsAfter(k) || AFTER_DEED.has(at.next(k + 1));
}

/** A "¿" opens the sentence before tokens[i]. */
const mark0 = (at: Around) => opensQuestion(at) !== null || inQuestion(at);

function interrogative(at: Around): string | null {
  const word = at.tokens[at.i].lower;
  const accented = INTERROGATIVE[word];
  if (!accented) return null;
  const next = at.next();
  const nextToken = at.tokens[at.i + 1];
  const prev = at.prev();
  // "No importa el qué sino el cómo": a question word made a noun by "el", standing alone.
  if (
    prev === "el" &&
    !/^cua(?:n|l|les)$/u.test(word) &&
    ((at.endsAfter() && word !== "que") || /^(?:sino|ni|y|e|o|u)$/u.test(next)) &&
    !nextToken?.broken
  )
    return accented;
  // "Hola, como estas?": "cómo" and "estar" closing a question without its opening mark.
  if (
    word === "como" &&
    !mark0(at) &&
    greetingSlot(at) &&
    /^(?:estas|esta|estás|está|están|estan|estáis|estais)$/u.test(next) &&
    endsQuestion(new Around(at.tokens, at.i + 1))
  )
    return accented;
  // "en qué y cómo influía", "cómo y qué": a question word paired with another.
  const asked = (w: string) => /[áéíóú]/u.test(w) && Object.values(INTERROGATIVE).includes(w);
  if (
    word === "que" &&
    ((/^(?:y|e|o|u|ni)$/u.test(next) && asked(at.next(2))) ||
      (/^(?:y|e|o|u|ni)$/u.test(prev) && asked(at.prev(2))))
  )
    return accented;
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
    // "¡Cómo no!", "¡Pero cómo no le va a gustar!"; "¡Como no vengas…!" threatens.
    if (word === "como" && next === "no" && !wishAfter(at)) return accented;
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
  // "me pregunto qué quería": wondering asks; "le pregunto que si viene" reports.
  if (
    word === "que" &&
    /^pregunt\p{L}*$/u.test(prev) &&
    /^(?:me|te|se|nos|os)$/u.test(at.prev(2)) &&
    !!next &&
    FINITE_NOT_NOUN(next) &&
    !isNoun(next) &&
    !subjunctiveLike(next)
  )
    return accented;
  // "no sabía qué había en la caja", "explícame qué ocurrió": an existential or an event
  // verb that leaves its subject or object unsaid is asked about.
  if (
    word === "que" &&
    (KNOWING.test(prev) || /^(?:ver|veamos|mira|mirar)$/u.test(prev)) &&
    (missingThing(at) || untoldEvent(at) || untoldDeed(at))
  )
    return accented;
  // "no sé qué hacer", "sabes qué libro", "pregunta dónde vive".
  if (KNOWING.test(prev) || (prev === "se" && /^(?:no|yo|lo|ya)$/u.test(at.prev(2)))) {
    if (!next) return null;
    // "no sé qué hacer ahora"; "sé que bajar música sin pagar está mal" is a statement.
    if (isInfinitive(next)) return shortClause(at, 1) ? accented : null;
    // "me preguntaba qué medidas tomar": a noun and the infinitive it is the object of.
    if (word === "que" && (isNoun(next) || !!attributeOf(next)) && isInfinitive(at.next(2)))
      return shortClause(at, 2) ? accented : null;
    if (word === "que") return ASKING.test(prev) && solidNoun(next) ? accented : null;
    if (word === "donde" || word === "adonde" || word === "quien" || word === "quienes")
      return CLITICS.has(next) || !!nextToken?.word ? accented : null;
    if (word === "cual" || word === "cuales")
      return /^(?:es|son|era|eran|fue|será|sería|de)$/u.test(next) ? accented : null;
  }
  // "no sé a qué se refiere", "me pregunto con qué ideas vendrá": a verb of knowing, a
  // preposition and "que"; "saber de que" is no conjunction ("darse cuenta de que" is).
  if (
    (word === "que" || word === "quien" || word === "quienes") &&
    /^(?:a|de|con|en|sobre)$/u.test(prev) &&
    KNOWING.test(at.prev(2)) &&
    !inQuestion(at) &&
    next &&
    !DETERMINERS.has(next)
  )
    return accented;
  // "hasta qué punto", "de qué forma", "a qué hora": a preposition, then "que" and a bare
  // noun that a question asks about; the conjunction would need a clause with its subject.
  if (
    word === "que" &&
    /^(?:a|de|en|hasta|por|con|desde)$/u.test(prev) &&
    QUESTION_NOUNS.has(next) &&
    !/^(?:de|que)$/u.test(at.next(2))
  )
    return accented;
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
// Verb forms no possessive goes before, though the dictionary lists "es" (the letter) and
// "fue" as nouns; "mi era", "mi vino" and "mi son" are nouns too.
const ONLY_VERBS = words(
  "es fue fui dijo hizo puso tuvo estuvo quiso supo pudo trajo eres soy somos estás va van ha " +
    "han hay parece parecen resulta resultan",
);
/** After "para mi": a word that starts no noun phrase ("para mí es", "aparta de mí este"). */
const notNounPhrase = (word: string) =>
  !BEFORE_NOUN.has(word) &&
  (ONLY_VERBS.has(word) ||
    DETERMINERS.has(word) ||
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
const GIVEN = words(
  "cuenta voz gracias permiso asentimiento golpecitos crédito importancia consentimiento " +
    "aprobación apoyo bendición",
);
// What "dar" gives with an article: "que Dios dé una respuesta", "que dé un alarido".
const GIVEN_WITH_ARTICLE = words("respuesta alarido abrazo beso consejo");
const giveObject = (at: Around) => {
  // "que no dé su asentimiento": a possessive before the bare object.
  const k = /^(?:su|sus|tu|tus|mi|mis)$/u.test(at.next()) ? 2 : 1;
  return (
    (GIVEN.has(at.next(k)) &&
      (at.endsAfter(k) || /^(?:de|del|a|al|por|para|y)$/u.test(at.next(k + 1)))) ||
    (/^(?:un|una)$/u.test(at.next()) && GIVEN_WITH_ARTICLE.has(at.next(2))) ||
    (at.next() === "a" && at.next(2) === "luz") ||
    // "que cada uno dé según su corazón": "de" governs no other preposition.
    /^(?:con|según)$/u.test(at.next())
  );
};
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

// What follows an answer's "Sí,": "Sí, me gusta", "Sí, pero…", "Sí, claro".
const ANSWER_AFTER = words(
  "pero claro gracias señor señora vale bueno ya también me te nos lo la le es son está hay " +
    "tengo quiero puedo creo exacto correcto perfecto efectivamente desde seguro",
);
const FINITE_FORM = (word: string) => !!word && (FINITE.has(word) || finiteVerb(word));
const participleOf = (word: string) => !!word && !!participle(word);
const isPlainInfinitive = (word: string) => /^\p{L}+[aeií]r$/u.test(word) && isInfinitive(word);

/** A comma closes the phrase after tokens[i] before any finite verb: "Aún sin saberlo, se fue". */
function concessive(at: Around): boolean {
  for (let k = 1; k <= 6; k++) {
    const token = at.tokens[at.i + k];
    if (!token || token.broken || /^[.;:!?]$/u.test(token.text)) return false;
    if (token.text === ",") return k > 1;
    if (k > 1 && token.word && FINITE.has(token.lower)) return false;
  }
  return false;
}

/** The sentence ends after tokens[i + k] within a few words, with no comma or finite verb. */
function endsPlainly(at: Around, k: number): boolean {
  for (let n = k; n <= k + 5; n++) {
    const token = at.tokens[at.i + n];
    if (!token || token.broken || /^[.!?]$/u.test(token.text)) return true;
    if (!token.word || FINITE.has(token.lower) || finiteVerb(token.lower)) return false;
  }
  return false;
}

const PRETERITE = /^\p{L}{2,}(?:é|ó|aste|iste|ió|aron|ieron)$/u;
const IRREGULAR_PAST = words(
  "hice hizo fui fue fuimos fueron tuve tuvo dije dijo puse puso vine vino estuve estuvo pude " +
    "pudo quise quiso supe supo",
);
/** A preterite or perfect right after "si", past its clitics: "si hice", "si me ha importado". */
function pastFact(at: Around, firstPerson: boolean): boolean {
  let k = 1;
  while (k < 3 && CLITICS.has(at.next(k))) k++;
  const verb = at.next(k);
  if (firstPerson) {
    if (verb === "he") return !!participle(at.next(k + 1));
    return (
      /^(?:hice|fui|tuve|dije|puse|vine|estuve|pude|quise|supe)$/u.test(verb) ||
      (/^\p{L}{2,}é$/u.test(verb) && finiteVerb(verb) && !isNoun(verb))
    );
  }
  if (IRREGULAR_PAST.has(verb) || (PRETERITE.test(verb) && finiteVerb(verb) && !isNoun(verb)))
    return true;
  return /^(?:he|has|ha|hemos|han)$/u.test(verb) && !!participle(at.next(k + 1));
}
/** The sentence runs to a plain full stop with no comma, colon or second clause. */
function plainSentence(at: Around): boolean {
  for (let j = at.i + 1; j < at.tokens.length && j < at.i + 16; j++) {
    const token = at.tokens[j];
    if (token.broken) return false;
    if (token.text === ".") return at.tokens[j + 1]?.text !== ".";
    if (!token.word || /^(?:si|que|pero|porque|cuando|aunque)$/u.test(token.lower)) return false;
  }
  return false;
}

/** A "no" earlier in the sentence, before the "pero" right ahead of tokens[i]. */
function deniedBefore(at: Around): boolean {
  for (let j = at.i - 2; j >= Math.max(0, at.i - 16); j--) {
    const token = at.tokens[j];
    if (/^[.!?;]$/u.test(token.text) || at.tokens[j + 1].broken) return false;
    if (token.lower === "no") return true;
  }
  return false;
}

/** Finite verbs (that are no nouns) from tokens[i] to the full stop. */
function finiteCount(at: Around): number {
  let count = 0;
  for (let j = at.i + 1; j < at.tokens.length && j < at.i + 16; j++) {
    const token = at.tokens[j];
    if (token.broken || /^[.!?]$/u.test(token.text)) break;
    if (token.word && FINITE_FORM(token.lower) && !isNoun(token.lower)) count++;
    // "dímelo", "házmelo": an imperative carrying its pronouns.
    else if (
      token.word &&
      /^\p{L}*[áéíóú]\p{L}*(?:me|te|se|lo|la|le|nos|os|los|las|les)$/u.test(token.lower) &&
      !isInfinitive(token.lower) &&
      !/(?:ándo|iéndo|yéndo)/u.test(token.lower)
    )
      count++;
  }
  return count;
}

/** A finite verb before the clause ends: "pero si hay casos" is a condition. */
function verbAhead(at: Around): boolean {
  for (let k = 1; k <= 8; k++) {
    const token = at.tokens[at.i + k];
    if (!token || token.broken || /^[.;:!?,]$/u.test(token.text)) return false;
    const word = token.lower;
    if (DETERMINERS.has(word) || PREPOSITIONS.has(word) || CLITICS.has(word)) continue;
    if (token.word && (FINITE.has(word) || (finiteVerb(word) && !isNoun(word)))) return true;
  }
  return false;
}

// Relatives written as question words after their antecedent: "nada qué hacer" -> "que",
// "el modo cómo" -> "como", "la fecha cuándo" -> "cuando", "el lugar dónde" -> "donde".
const QUANTITY_ANTECEDENTS = words("nada algo nadie alguien mucho poco bastante");
const NOUN_ANTECEDENTS: Record<string, Set<string>> = {
  cómo: words("modo manera forma"),
  cuándo: words("fecha día momento época hora año"),
  dónde: words("lugar sitio casa ciudad zona pueblo país parte punto"),
};
const PLAIN_RELATIVE: Record<string, string> = {
  qué: "que",
  quién: "quien",
  quiénes: "quienes",
  dónde: "donde",
  cómo: "como",
  cuándo: "cuando",
};

/** "No tengo nada qué hacer", "alguien en quién confiar": a relative after its antecedent. */
function relative(at: Around): string | null {
  const word = at.tokens[at.i].lower;
  const plainForm = PLAIN_RELATIVE[word];
  if (!plainForm || at.tokens[at.i - 1]?.text === "¿") return null;
  const k = PREPOSITIONS.has(at.prev()) ? 2 : 1;
  const antecedent = at.prev(k);
  if (QUANTITY_ANTECEDENTS.has(antecedent) && isInfinitive(at.next())) return plainForm;
  // "el lugar por donde"; a preposition before "cómo" or "cuándo" keeps the question.
  const placed = k === 1 || word === "dónde";
  return NOUN_ANTECEDENTS[word]?.has(antecedent) && placed && !!at.next() ? plainForm : null;
}

// Masculine adjectives that follow a subject "él": "él solo", "él mismo", "él propio".
const NOT_AFTER_EL = words("solo sólo mismo propio único entero solito junto todo bueno");

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
      // "en mi menor", "en mi bemol": the note.
      if (/^(?:bemol|sostenido|mayor|menor)$/u.test(next)) return null;
      if (ends || /^(?:mismo|misma|me|que|no|el|la|los|las|lo)$/u.test(next)) return "mí";
      // "en mi contra" is the possessive idiom; "en mi era" the noun.
      if (next === "era" && (prev === "en" || prev === "de")) return null;
      if (
        next &&
        next !== "contra" &&
        !/^\p{Lu}/u.test(nextToken?.text ?? "") &&
        notNounPhrase(next)
      )
        return "mí";
      if (prev === "a" && isInfinitive(next)) return "mí";
      // "algo para mi incomprensible", "para mi más característico": an adjective closing the
      // phrase has no noun for a possessive; "mi más sincero pésame" has one.
      {
        const k = /^(?:más|menos|muy|tan|bastante)$/u.test(next) ? 2 : 1;
        const adjective = at.next(k);
        if (
          // A participle, an invariant adjective or one in -ible: "mi hermano" may close too.
          (participle(adjective) ||
            INVARIANT.has(adjective) ||
            /ibles?$/u.test(adjective) ||
            (k === 2 && !!attributeOf(adjective))) &&
          !PRENOMINAL.has(adjective.replace(/s$/u, "")) &&
          (at.endsAfter(k) || PREPOSITIONS.has(at.next(k + 1)))
        )
          return "mí";
      }
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
      // "en mí bemol", "sonata en mí menor": the note.
      if (
        word === "mí" &&
        (/^(?:bemol|sostenido)$/u.test(next) ||
          (/^(?:mayor|menor)$/u.test(next) && /^(?:en|de)$/u.test(prev) && at.endsAfter(1)))
      )
        return "mi";
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
      // "sino el cuando." names the question word ("el cuándo").
      if (next === "cuando" && (at.endsAfter(1) || /^(?:sino|ni|y|o)$/u.test(at.next(2))))
        return null;
      if (/^(?:pero|aunque|cuando|mientras|un|una|unos|unas)$/u.test(next)) return "él";
      if (/ó$/u.test(next) && !isNoun(next)) return "él";
      if (/^(?:mismo)$/u.test(next) && (COMMON_VERBS.has(at.next(2)) || CLITICS.has(at.next(2))))
        return "él";
      // "el té de menta".
      if (next === "te" && (TEA.has(at.next(2)) || at.endsAfter(1))) return null;
      if (CLITICS.has(next) && next !== "la" && next !== "lo") return "él";
      // "si el la tiene", "el lo sabe": "la"/"lo" before a verb that is no noun ("el la
      // menor" is the note).
      if (
        (next === "la" || next === "lo") &&
        FINITE_FORM(at.next(2)) &&
        !isNoun(at.next(2)) &&
        !PREPOSITIONS.has(at.next(2))
      )
        return "él";
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
    case "él": {
      // "Él coche lo dejé", "con él voto de", "Él mismo susto": a bare singular noun after it
      // wants the article. "a él", "de él", "para él" and "por él" take objects after them.
      const governed =
        /^(?:con|en|sin|sobre|entre|hacia|desde|hasta|tras|según|ante|bajo|contra|durante|mediante)$/u.test(
          prev,
        );
      if (!at.starts && !governed) return null;
      const k = next === "mismo" ? 2 : 1;
      const noun = at.next(k);
      if (!noun || noun.endsWith("s") || /^\p{Lu}/u.test(at.tokens[at.i + k].text)) return null;
      const form = genderedForm(noun);
      const masculineNoun =
        solidNoun(noun) ||
        (!!form && !form.feminine && !form.plural && !participle(noun) && !NOT_AFTER_EL.has(noun));
      // "Con él voto yo": a verb form after the pronoun, unless "de" makes it a noun.
      const verbForm = verbLike(noun) || finiteVerb(noun);
      // "Él vera lo que quiere": a feminine noun ("la vera") takes no "el".
      return masculineNoun &&
        readNoun(noun)?.gender !== "f" &&
        (!verbForm || /^(?:de|del)$/u.test(at.next(k + 1))) &&
        (k === 1 || isNoun(noun))
        ? "el"
        : null;
    }
    case "se":
      // "yo no sé", "lo sé.", "no sé si", "no sé cómo".
      // "se" + an accented question word, "lo se": no clitic reading ("lo" never precedes it).
      if (/[áéíóú]/u.test(next) && Object.values(INTERROGATIVE).includes(next)) return "sé";
      if (prev === "lo" || prev === "me")
        return /^(?:te|le|les|lo|la|los|las)$/u.test(next) ? null : "sé";
      // "Sé de qué hablo": "de" and a question word.
      if (next === "de" && /^(?:qué|quién|quiénes|dónde|cuál|cuáles)$/u.test(at.next(2)))
        return "sé";
      // "yo también sé nadar": a bare infinitive takes no clitic before it.
      if (isPlainInfinitive(next) && !PREPOSITIONS.has(prev) && prev !== "para") return "sé";
      // "Sé amable": the imperative of "ser" before an adjective closing the sentence.
      if (
        at.starts &&
        /^\p{Lu}/u.test(at.tokens[at.i].text) &&
        (INVARIANT.has(next) ||
          /(?:ble|nte|z)$/u.test(next) ||
          (!!genderedForm(next) && !participleOf(next))) &&
        !finiteVerb(next) &&
        (at.endsAfter(1) || PREPOSITIONS.has(at.next(2)))
      )
        return "sé";
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
      // "Sí, me gusta.", "Sí, pero…": an answer; "Si, como dices, llueve" opens a condition.
      if (nextToken?.text === "," && at.starts && ANSWER_AFTER.has(at.next(2))) return "sí";
      // "Si pero no quiero": no condition starts with "pero".
      if (next === "pero" && at.starts) return "sí";
      // "Pasó esto, si, ¿y ahora?": an affirmation set off by commas ("si, y solo si," is not).
      if (nextToken?.text === "," && at.tokens[at.i - 1]?.text === ",") {
        const after = at.tokens[at.i + 2];
        if (
          after &&
          !after.broken &&
          (/^[¿¡]$/u.test(after.text) || /^(?:pero|claro|aunque)$/u.test(after.lower))
        )
          return "sí";
      }
      if (nextToken?.text === ",") return PLAIN_SI_PREV.has(prev) ? "sí" : null;
      // "No tengo casos, pero si hay otros.": after a denial, "pero sí" and one verb running
      // to the full stop; a condition would need its main clause too.
      if (prev === "pero" && deniedBefore(at) && plainSentence(at) && finiteCount(at) === 1)
        return "sí";
      // "Aquello sí era felicidad": an emphatic yes after a demonstrative subject.
      if (
        /^(?:esto|eso|aquello)$/u.test(prev) &&
        new Around(at.tokens, at.i - 1).starts &&
        /^(?:es|era|fue|será|sería|está|estaba)$/u.test(next) &&
        endsPlainly(at, 2)
      )
        return "sí";
      // "No tengo coche, pero sí moto": "pero sí" and a phrase with no verb of its own.
      if (prev === "pero" && /^(?:a|al|un|una|unos|unas)$/u.test(next) && !verbAhead(at))
        return "sí";
      // "«Sí», le dijimos.": closed by its quote.
      if (
        /^[»”"]$/u.test(nextToken?.text ?? "") &&
        /^[«“"]$/u.test(at.tokens[at.i - 1]?.text ?? "") &&
        at.tokens[at.i + 2]?.text === ","
      )
        return "sí";
      // "Si hice el trabajo.", "Esta vez si me ha importado.": a past fact opening a sentence
      // that ends without the main clause a condition needs; at the very start only the
      // speaker's own ("Si tuvo todas las oportunidades." may be a fragment).
      {
        const lead =
          /^(?:pues|ahora|entonces)$/u.test(prev) || (prev === "vez" && at.prev(2) === "esta");
        if ((lead || at.starts) && pastFact(at, !lead) && plainSentence(at)) return "sí";
      }
      return ends ? "sí" : null;
    }
    case "aun":
      // "aún no", "aún más", "más aún", "es mi marido aún.": still.
      if (next === "no" && !isGerund(at.next(2))) return "aún";
      if (/^(?:más|menos|mayor|menor|mejor|peor)$/u.test(next)) return "aún";
      if (/^(?:más|menos)$/u.test(prev)) return "aún";
      // "Aún recuerdo", "aún se desconoce": still, before the verb or its clitic.
      if (CLITICS.has(next) && next !== "la" && next !== "las" && next !== "los") return "aún";
      // "Estaban aún durmiendo": between "estar" and its gerund.
      if (isGerund(next) && /^est[aá]/u.test(prev)) return "aún";
      // "aun así", "aun cuando", "aun si" and "aun siendo" (even) take no verb.
      if (/^(?:así|cuando|si|con|sin|a|al|en)$/u.test(next) || CONJUNCTIONS.has(next)) return null;
      // "Aún recuerdo aquel día", "que aún lucha": still, before a finite verb, even one that is
      // also a noun when no comma closes it ("aun niños, trabajaban").
      if (
        FINITE_FORM(next) &&
        !participle(next) &&
        (!attributeOf(next) || isNoun(next)) &&
        (!isNoun(next) || (/[oae]$/u.test(next) && at.tokens[at.i + 2]?.text !== ","))
      )
        return "aún";
      // "que el gobierno aún tenga": still, inside a "que" clause before a subjunctive that is
      // no other word; "aun tenga que ir" opening a clause is concessive (even if).
      if (
        subjunctiveLike(next) &&
        !isNoun(next) &&
        !attributeOf(next) &&
        [1, 2, 3].some((k) => at.prev(k) === "que")
      )
        return "aún";
      // "con los ojos aún abiertos": still, before a participle inside the clause.
      if (!at.starts && participleOf(next) && at.tokens[at.i + 2]?.text !== ",") return "aún";
      return ends && !at.starts ? "aún" : null;
    case "aún":
      if (prev === "ni") return "aun";
      // "aun así,", "aun si", "aun siendo": even.
      // "más aún si" (even more) keeps the accent.
      if (/^(?:más|menos|mejor|peor|mayor|menor)$/u.test(prev) || /mente$/u.test(prev)) return null;
      // "estaban aún durmiendo" keeps "still" between "estar" and its gerund.
      if (next === "si" || next === "cuando" || (isGerund(next) && !/^est[aá]/u.test(prev)))
        return "aun";
      // "Aun no siendo cierto": even, before a negated gerund.
      if (next === "no" && isGerund(at.next(2))) return "aun";
      // "Aún sin saberlo, se fue", "Aún cansado, lo intentó": a concessive phrase opening the
      // sentence and closed by a comma before its verb.
      if (at.starts && (PREPOSITIONS.has(next) || participleOf(next)) && concessive(at))
        return "aun";
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
    const fix = question ?? relative(at) ?? monosyllable(at);
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
