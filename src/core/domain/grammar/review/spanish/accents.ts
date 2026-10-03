import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  Around,
  attributeOf,
  BOUNDARY,
  CLITICS,
  CONJUNCTIONS,
  DETERMINERS,
  endsQuestion,
  greetingSlot,
  GIVEN_NAMES,
  INVARIANT,
  isBoundary,
  isInfinitive,
  OPENING,
  PREPOSITIONS,
  PRENOMINAL,
  replaceToken,
  SER,
  tokenize,
  type Token,
  verbLike,
  words,
} from "./common";
import { attribute, finiteVerb, genderedForm, isGerund, isNoun, participle } from "./lexicon";
import { isLang } from "../phraseTemplates";

// Written accents that tell two real words apart: "esta" (this) / "está" (is). Each check
// reads the closed-class words around the target; the lexicon only says whether a neighbour
// can be a participle, an adjective or a noun.

const RULE = "spanishAccents" as const;

// Adverbs that modify the verb or an adjective after it, never a noun.
const PLACE_MANNER = words("bien mal aquí ahí allí allá acá");
const DEGREE = words("muy tan bastante demasiado medio casi");
// Prepositions an "estar" phrase takes; "a", "para" and "por" start pronoun phrases too often.
const ESTAR_PREPOSITIONS = words("en con sin bajo sobre entre junto dentro detrás delante encima");
// "esta en realidad", "esta sin duda": a pronoun and a parenthetical, not a location.
const PARENTHETICAL = words(
  "realidad cambio particular concreto general especial principio efecto definitiva resumen " +
    "cuanto parte todo duda embargo",
);
// "está de acuerdo", "está de moda": fixed "estar de" phrases.
const ESTAR_DE = words(
  "acuerdo vacaciones moda pie viaje broma baja luto más sobra paso vuelta camino servicio " +
    "guardia parto suerte buenas malas fiesta rodillas espaldas",
);
// Quantifiers and "solo" read as masculine adjectives but start a pronoun's phrase:
// "esta mucho más moderna", "esta solo es".
const QUANTIFIERS = words("mucho poco tanto otro cuanto uno ninguno alguno mismo todo solo");
// Participles that are also everyday nouns the dictionary does not list as such.
const PARTICIPLE_NOUNS = words(
  "subida bajada bebida entrada llegada mirada parada jugada caída herida medida venida " +
    "ida salida comida llamada partida vuelta propuesta respuesta puesta vista",
);
// After these a verb is likely: the subject, a time adverb or "no" sits right before it.
const BEFORE_VERB = words(
  "no ya ahora todavía aún siempre también tampoco nunca hoy ayer aquí ahí allí que él ella " +
    "usted uno",
);
const TIME = words("siempre todavía ya aún ahora también hoy nunca");
// "esta los domingos abre": a time phrase after the pronoun.
const TIME_NOUNS = words(
  "domingos lunes martes miércoles jueves viernes sábados semana semanas mañanas tardes " +
    "noches días veces vez año años mes meses",
);
// After these a participle closing its clause is the attribute of "está".
const RELATIVES = words("y e pero cual cuales quien quienes donde cuando");
const INTERROGATIVES = words("dónde adónde cómo quién quiénes cuándo");
const SUBJECTS_3 = words("él ella usted");
const COUNTS = words("dos tres cuatro cinco seis siete ocho nueve diez veinte treinta cien mil");
const SUBJECTS_2 = words("tú vos");

/** A capitalized sentence-initial word the lexicon does not know: a name ("París está"). */
function nameLike(at: Around): boolean {
  const before = at.tokens[at.i - 1];
  if (!before?.word || at.tokens[at.i].broken || !/^\p{Lu}\p{Ll}/u.test(before.text)) return false;
  const word = before.lower;
  if (GIVEN_NAMES.has(word)) return true;
  return (
    word.length > 2 &&
    !isNoun(word) &&
    !attribute(word) &&
    !verbLike(word) &&
    !isInfinitive(word) &&
    !PREPOSITIONS.has(word) &&
    !CONJUNCTIONS.has(word) &&
    !DETERMINERS.has(word) &&
    !CLITICS.has(word) &&
    !SER.has(word) &&
    !/mente$/u.test(word)
  );
}

// "sé dónde está", "si supiéramos cómo está": verbs that introduce an indirect question.
const ASKING = /^(?:s[ée]|sab\p{L}*|sup\p{L}*|pregunt\p{L}*|ver|veamos|dime|dinos|explica\p{L}*)$/u;

/** The question word before tokens[i] opens a question: "¿Cómo está?", "No sé dónde está.". */
function asks(at: Around): boolean {
  if (ASKING.test(at.prev(2))) return true;
  for (let j = at.i - 1; j >= Math.max(0, at.i - 12); j--) {
    const text = at.tokens[j].text;
    if (text === "¿") return true;
    if (/^[.;!?…]$/u.test(text) || at.tokens[j + 1].broken) return false;
  }
  return false;
}

/** After an attribute: the phrase ends there ("está casada.", "está basada en", "y"). */
function closes(at: Around, k: number): boolean {
  if (at.endsAfter(k)) return true;
  const after = at.next(k + 1);
  const coordinated = at.next(k + 2);
  return (
    PREPOSITIONS.has(after) ||
    // "casada y tiene", but "repentina y loable disposición".
    ((after === "y" || after === "e") && !isNoun(coordinated) && !attributeOf(coordinated)) ||
    // "licenciada y examinada por": two participles.
    ((after === "y" || after === "e") &&
      !!participle(at.next(k)) &&
      !!participle(coordinated) &&
      !isNoun(coordinated) &&
      closes(at, k + 2)) ||
    PLACE_MANNER.has(after) ||
    /^\p{L}{4,}mente$/u.test(after)
  );
}

/** "Su nueva novela esta…": a determiner, one or two adjectives and a noun before the word. */
function nounPhraseBefore(at: Around): boolean {
  const noun = at.prev();
  if (!noun || !isNoun(noun)) return false;
  for (let k = 2; k <= 3; k++) {
    const word = at.prev(k);
    if (DETERMINERS.has(word)) return k > 2;
    if (!PRENOMINAL.has(word.replace(/s$/u, "")) && (!attributeOf(word) || finiteVerb(word)))
      return false;
  }
  return false;
}

// Words a demonstrative never comes before: "Esta cada día más cansada" is "está".
const NOT_DETERMINED = words("cada afuera encima arriba apenas");
const HABER = words("he has ha hemos habéis han hay había habías habían hubo haya hayan");

/** No other word of the clause around tokens[i] may be a finite verb. */
function verbless(at: Around): boolean {
  const { tokens, i } = at;
  const finite = (token: Token) =>
    token.word &&
    (finiteVerb(token.lower) ||
      HABER.has(token.lower) ||
      (SER.has(token.lower) && !/^(?:ser|siendo|sido)$/u.test(token.lower)));
  for (let j = i - 1; j >= 0 && !tokens[j + 1].broken; j--) {
    if (BOUNDARY.test(tokens[j].text) || OPENING.test(tokens[j].text)) break;
    if (finite(tokens[j])) return false;
  }
  // The attribute itself may spell a verb too ("enferma").
  for (let j = i + 2; !isBoundary(tokens[j]); j++) if (finite(tokens[j])) return false;
  return true;
}

/**
 * "esta"/"estas" read as the verb "está"/"estás" from the words around them. `plural` is the
 * demonstrative's number: "estas" + a singular attribute cannot agree.
 */
function estarReading(at: Around, plural: boolean): boolean {
  const prev = at.prev();
  const prev2 = at.prev(2);
  const next = at.next();
  // "Deja la habitación como esta.": left as it is.
  if (
    prev === "como" &&
    !next &&
    at.endsAfter() &&
    [2, 3, 4, 5].some((k) => /^(?:d[eé]j|qued)\p{L}*$/u.test(at.prev(k)))
  )
    return true;
  // "Hola, como estas?": a greeting asked without its opening mark.
  if (prev === "como" && greetingSlot(new Around(at.tokens, at.i - 1)) && endsQuestion(at))
    return true;
  // "por ser esta la casa", "de esta manera", "combinar esta con", "como esta", "toda esta
  // recogida": a pronoun or a determiner.
  if (PREPOSITIONS.has(prev) || SER.has(prev) || isInfinitive(prev) || prev === "como")
    return false;
  if (/^tod[oa]s?$/u.test(prev)) return false;
  // "Escrito está.", "Lo hecho, hecho está": a participle and the verb closing the clause.
  if (!next && at.endsAfter() && !plural && participle(prev)?.feminine === false) return true;
  // "Finalizada esta en 1445": an absolute participle clause, then the pronoun.
  if (participle(prev) && new Around(at.tokens, at.i - 1).starts) return false;
  // "lo esta", "se le esta", "¿no lo estás?": a clitic only comes before a verb.
  if (CLITICS.has(prev) && prev !== "la" && prev !== "las") return true;
  const subjects = plural ? SUBJECTS_2 : SUBJECTS_3;
  // "esta 100 % seguro", "El cabo esta 30 millas al sur", "Esta cien por cien seguro": no
  // singular demonstrative counts more than one.
  const count = at.tokens[at.i + 1];
  if (
    !plural &&
    count &&
    !count.broken &&
    ((/^\p{N}+$/u.test(count.text) && count.text !== "1") || COUNTS.has(count.lower)) &&
    ((at.tokens[at.i + 2]?.word && at.next(2) !== "de") || at.tokens[at.i + 2]?.text === "%")
  )
    return true;
  if (!next) {
    // "¿Dónde está?", "no está.", "tú estás.": a verb closing its clause.
    if (!at.endsAfter()) return false;
    return (
      prev === "no" ||
      (INTERROGATIVES.has(prev) && asks(at)) ||
      (prev === "tal" && prev2 === "qué") ||
      (subjects.has(prev) && !PREPOSITIONS.has(prev2)) ||
      // "¡Ahí estás!", "Claro está.", "Escrito está.": no noun for a determiner to agree with.
      PLACE_MANNER.has(prev) ||
      // "¡Qué cerca esta!", "¡Qué buena esta!": an exclamation about how something is.
      ((prev2 === "qué" || prev2 === "que") &&
        at.tokens[at.i + 1]?.text === "!" &&
        (!!attributeOf(prev) || prev === "cerca" || prev === "lejos" || PLACE_MANNER.has(prev))) ||
      (!plural && attribute(prev)?.feminine === false && !attribute(prev)?.plural)
    );
  }
  // "esta cantando", "estás haciéndolo".
  if (isGerund(next)) return true;
  if (next === "de") return ESTAR_DE.has(at.next(2));
  if (/^\p{L}{4,}mente$/u.test(next)) return !CONJUNCTIONS.has(prev) || prev === "que";
  const reading = attributeOf(next);
  if (reading && !QUANTIFIERS.has(next) && reading.feminine !== null) {
    // A masculine attribute cannot agree with "esta"; no singular one with "estas".
    if (!reading.plural && (plural || !reading.feminine)) return true;
  }
  if (QUANTIFIERS.has(next) && (next === "solo" || next === "todo"))
    return at.endsAfter(1) || PLACE_MANNER.has(at.next(2)) || DEGREE.has(at.next(2));
  // "la tienda esta cerrada": after a determiner and its noun, "esta" cannot start another
  // noun phrase (the colloquial "la chica esta" is followed by its verb).
  const afterNoun =
    (DETERMINERS.has(prev2) && !!prev && !PREPOSITIONS.has(prev) && !CONJUNCTIONS.has(prev)) ||
    nounPhraseBefore(at);
  if (afterNoun && reading && !reading.plural && !QUANTIFIERS.has(next) && closes(at, 1))
    return true;
  // The rest needs a verb-like slot: a subject, a name, "no", a time adverb or a clause start.
  // "¿A qué altura esta la calle?": a question phrase is the verb's slot too.
  const asked = /^(?:qué|cuál|cuánto|cuánta|cuántos|cuántas)$/u.test(prev2) && isNoun(prev);
  const slot =
    asked ||
    at.starts ||
    at.prevIsName ||
    afterNoun ||
    nameLike(at) ||
    BEFORE_VERB.has(prev) ||
    subjects.has(prev) ||
    INTERROGATIVES.has(prev) ||
    ((isNoun(prev) || attribute(prev) !== null) && !verbLike(prev));
  // "y esta embarazada.", "la cual esta basada en": a true participle closing the clause after
  // a conjunction or a relative is the verb's attribute.
  if (
    !slot &&
    (RELATIVES.has(prev) || prev === "que") &&
    reading &&
    !reading.plural &&
    !!participle(next) &&
    // The dictionary lists "basada" and "pegada" as nouns too; the everyday ones are listed.
    (!isNoun(next) || /[ai]da$/u.test(next)) &&
    !PARTICIPLE_NOUNS.has(next) &&
    !verbLike(next) &&
    closes(at, 1)
  )
    return true;
  // "Esta subida en la silla.", "Esta cada día más cansada", "Mira la vaca, esta enferma.":
  // in a clause with no other verb the word is the verb, not a determiner before an attribute.
  if (!plural && !QUANTIFIERS.has(next) && verbless(at)) {
    // "esta fuera de lugar", but "aunque esta fuera la mejor" (were).
    if ((NOT_DETERMINED.has(next) || (next === "fuera" && at.next(2) === "de")) && !at.endsAfter(1))
      return true;
    // A verb's own form ("esta afecta a todos") only closing the clause: "esta enferma.".
    if (
      reading &&
      !reading.plural &&
      reading.feminine !== false &&
      closes(at, 1) &&
      (at.endsAfter(1) ? !PARTICIPLE_NOUNS.has(next) : !finiteVerb(next))
    )
      return true;
  }
  if (!slot) return false;
  // "¿A qué distancia esta la calle?", "¿a qué altura esta Lima?": after the asked phrase a
  // noun phrase is the verb's subject, even one that reads as a verb too ("calle").
  const nextToken = at.tokens[at.i + 1];
  if (
    asked &&
    !plural &&
    ((/^(?:el|la|los|las|mi|su|tu)$/u.test(next) && isNoun(at.next(2))) ||
      (/^\p{Lu}\p{Ll}/u.test(nextToken.text) && !nextToken.broken))
  )
    return true;
  // "En el cerro esta la catedral": a determiner cannot follow the demonstrative, so "está"
  // introduces the subject; "esta la tiene" is a pronoun and its clitic.
  if (
    /^(?:el|la|los|las|un|una|mi|su|tu)$/u.test(next) &&
    !isBoundary(at.tokens[at.i + 2]) &&
    isNoun(at.next(2)) &&
    !verbLike(at.next(2)) &&
    !finiteVerb(at.next(2)) &&
    !TIME_NOUNS.has(at.next(2))
  )
    return !at.starts;
  // "esta más allá de", "esta más cerca": a degree of place.
  if (next === "más" && /^(?:allá|cerca|lejos|adelante|atrás|arriba|abajo)$/u.test(at.next(2)))
    return true;
  // "La tienda donde trabajo esta al lado del banco": a place after "al" ("esta al menos").
  if (next === "al" && /^(?:lado|fondo|final|norte|sur|este|oeste|borde|otro)$/u.test(at.next(2)))
    return true;
  // "Tom está todavía despierto", "Está siempre corriendo": a time adverb, then the attribute.
  if (TIME.has(next)) {
    const after = at.next(2);
    const later = attributeOf(after);
    if (isGerund(after)) return true;
    if (later && !later.plural && later.feminine !== null && (plural || !later.feminine))
      return !QUANTIFIERS.has(after);
    return !!later && !later.plural && !isNoun(after) && !verbLike(after) && closes(at, 2);
  }
  // "esta casada.", "está basada en", but "esta preciosa casa", "esta llamada".
  if (
    reading &&
    !reading.plural &&
    !QUANTIFIERS.has(next) &&
    !PARTICIPLE_NOUNS.has(next) &&
    !verbLike(next) &&
    // "basada", "pegada": participles the dictionary lists as nouns too.
    (!isNoun(next) || INVARIANT.has(next) || (!!participle(next) && /[ai]da$/u.test(next))) &&
    closes(at, 1)
  )
    return true;
  if (PLACE_MANNER.has(next)) return !CLITICS.has(at.next(2)) && at.next(2) !== "la";
  if (next === "cerca" || next === "lejos") return at.next(2) === "de" || at.endsAfter(1);
  if (DEGREE.has(next)) {
    const after = at.next(2);
    // "muy" only takes adjectives and adverbs; "tan bonita ciudad" may still be a noun phrase.
    return (
      (PLACE_MANNER.has(after) || after === "cerca" || after === "lejos" || !!attributeOf(after)) &&
      (next === "muy" || !isNoun(after) || INVARIANT.has(after)) &&
      !isNoun(at.next(3))
    );
  }
  if (ESTAR_PREPOSITIONS.has(next)) return !PARENTHETICAL.has(at.next(2));
  // "La ciudad esta al este", "La casa esta a dos calles": a place after a subject.
  if ((next === "al" || next === "a") && (afterNoun || subjects.has(prev)))
    return !CLITICS.has(at.next(2)) && !isInfinitive(at.next(2));
  // "no esta casa": "no" before a verb, unless a noun follows.
  if (prev === "no") return !isNoun(next) && !CLITICS.has(next);
  // "¿Dónde esta tu padre?", "Tom está feliz": a question word or subject right before it.
  if (INTERROGATIVES.has(prev) || subjects.has(prev) || (prev === "tal" && prev2 === "qué"))
    return (
      (!isNoun(next) || DETERMINERS.has(next) || /^\p{Lu}/u.test(nextToken.text)) &&
      !CLITICS.has(next)
    );
  return false;
}

// "que esté", "cuando esté", "tal vez esté": subjunctive triggers right before "este".
const SUBJUNCTIVE_TRIGGERS = words("que cuando aunque mientras ojalá quizá quizás");

const plural0 = (at: Around) => at.tokens[at.i].lower !== "este";

function subjunctiveReading(at: Around): boolean {
  const prev = at.prev();
  const prev2 = at.prev(2);
  const clitic = CLITICS.has(prev) && prev !== "la" && prev !== "las" && prev !== "los";
  const prev3 = at.prev(3);
  const trigger =
    clitic ||
    SUBJUNCTIVE_TRIGGERS.has(prev) ||
    (prev === "vez" && prev2 === "tal") ||
    (prev === "pronto" && prev2 === "tan") ||
    // "que no esté", "cuando el niño esté", "que su país esté".
    (prev === "no" && SUBJUNCTIVE_TRIGGERS.has(prev2)) ||
    (SUBJUNCTIVE_TRIGGERS.has(prev3) && DETERMINERS.has(prev2) && !!prev && !CLITICS.has(prev2));
  const next0 = at.next();
  // "para que la cuenta este configurada", "que cualquier negocio este a la vanguardia": a
  // trigger a few words back, and what follows cannot go with masculine "este".
  if (
    !trigger &&
    at.tokens[at.i].lower === "este" &&
    [2, 3, 4].some(
      (k) =>
        SUBJUNCTIVE_TRIGGERS.has(at.prev(k)) &&
        // "Dijo que el libro está a la venta": a report keeps the indicative.
        !/^(?:dij|dic|dec|cre|pens|piens|sab|sé|afirm|asegur|explic|cuent|cont)\p{L}*$/u.test(
          at.prev(k + 1),
        ),
    ) &&
    ((participle(next0)?.feminine && !isNoun(next0)) || (next0 === "a" && at.next(2) === "la"))
  )
    return true;
  if (!trigger) return false;
  const next = at.next();
  if (!next) return clitic && at.endsAfter();
  if (isGerund(next)) return true;
  if (PLACE_MANNER.has(next)) return closes(at, 1);
  if (next === "de") return ESTAR_DE.has(at.next(2));
  if (ESTAR_PREPOSITIONS.has(next) || next === "al") return !PARENTHETICAL.has(at.next(2));
  if (next === "por" || next === "a") return /^(?:encima|debajo|punto|tiempo)$/u.test(at.next(2));
  // "cuando tu orden este procesada": a feminine participle cannot follow masculine "este".
  if (!plural0(at) && participle(next)?.feminine && !isNoun(next)) return true;
  if (next === "cerca" || next === "lejos") return at.next(2) === "de";
  if (DEGREE.has(next)) return !!attributeOf(at.next(2)) && closes(at, 2);
  const reading = attributeOf(next);
  // "que este cansado.", "cuando esté lista", but "que este libro", "que este mismo papa".
  return (
    !!reading &&
    !QUANTIFIERS.has(next) &&
    !PARTICIPLE_NOUNS.has(next) &&
    !(verbLike(next) && !next.endsWith("o")) &&
    closes(at, 1)
  );
}

// Adverbs and the like that end like feminine nouns: "no está nada mal", "está fuera".
const NOT_AFTER_DEMONSTRATIVE = words(
  "nada cada nunca ahora fuera afuera cerca encima arriba contra mañana media toda apenas",
);
const DEMONSTRATIVE: Record<string, string> = { está: "esta", estás: "estas", esté: "este" };

/** "de está manera", "Está misma mañana", "Estás casas": the verb where a determiner goes. */
function demonstrativeReading(at: Around): boolean {
  const prev = at.prev();
  const next = at.next();
  if (!next) return false;
  const form = at.tokens[at.i].lower;
  if (/^mism[oa]s?$/u.test(next)) return true;
  // A preposition never governs a finite verb: "con está definición".
  // "según está escrito" and "hasta está cansado" (even) are clauses.
  if (PREPOSITIONS.has(prev) && !/^(?:a|al|del|según|hasta)$/u.test(prev))
    return (
      (isNoun(next) || (!!genderedForm(next) && !participle(next))) &&
      !NOT_AFTER_DEMONSTRATIVE.has(next) &&
      !isGerund(next)
    );
  if (attributeOf(next) || NOT_AFTER_DEMONSTRATIVE.has(next) || !isNoun(next)) return false;
  // "Arreglar está avería", "Estás casas son verdes": "estar" takes no bare noun, so a
  // feminine noun after it wants the demonstrative.
  // Nouns in -a may be adjectives too ("está enferma"): only after an infinitive.
  if (form === "está")
    return (
      at.next(2) !== "de" &&
      (/(?:ión|dad|tud)$/u.test(next) || (/a$/u.test(next) && isInfinitive(prev)))
    );
  return form === "estás" && /as$/u.test(next);
}

function estarAccents(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "es")) return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  const add = (finding: RawFinding | null) => finding && findings.push(finding);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
    const at = new Around(tokens, i);
    const lower = token.lower;
    const verb =
      lower === "esta"
        ? estarReading(at, false) && "está"
        : lower === "estas"
          ? estarReading(at, true) && "estás"
          : lower === "este"
            ? subjunctiveReading(at) && "esté"
            : false;
    if (verb)
      add(replaceToken(ctx, token, [verb], RULE, "review_msg_spanish_accent", tokens[i + 1]));
    const demonstrative = DEMONSTRATIVE[lower];
    if (demonstrative && demonstrativeReading(at))
      add(
        replaceToken(
          ctx,
          token,
          [demonstrative],
          RULE,
          "review_msg_spanish_accent_extra",
          tokens[i + 1],
        ),
      );
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: estarAccents }];
