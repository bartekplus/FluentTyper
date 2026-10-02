import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  Around,
  CLITICS,
  CONJUNCTIONS,
  DETERMINERS as COMMON_DETERMINERS,
  GIVEN_NAMES,
  isInfinitive,
  PREPOSITIONS,
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
  isNoun,
  isVerb,
  participle,
} from "./lexicon";

// Accents that tell a verb form from its twin: "el termino" (término, the noun), "se creo"
// (creó, the preterite), "no sabia" (sabía, the imperfect).

const RULE = "spanishAccents" as const;

// Determiners that are never clitics: "el termino", "su numero", "dos practicas".
const DETERMINERS = words(
  "el un una unos unas del al mi mis tus su sus cada nuestro nuestra nuestros nuestras dos tres cuatro " +
    "cinco varios varias muchas muchos pocas pocos otra otro otras otros toda todo",
);
const DEGREE = words("muy más tan bastante");
// Demonstratives are also subject pronouns ("este opera"): only after a preposition.
const DEMONSTRATIVES = words(
  "este esta estos estas ese esa esos esas aquel aquella aquellos aquellas",
);
const SUBJECTS = words("él ella usted");
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
  const governed =
    article ||
    preposition > 0 ||
    (!!before && finiteVerb(before) && !isNoun(before) && !readNoun(before));
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
  if (DEMONSTRATIVES.has(prev) && PREPOSITIONS.has(at.prev(2))) return accented;
  // "en la página", "parar la máquina", "la máquina del tiempo": "la" is no clitic there.
  if (/^(?:la|las|los)$/u.test(prev)) {
    // "la termino": a feminine article cannot take the masculine noun.
    if (prev !== "los" && /os?$/u.test(accented)) return null;
    const before = at.prev(2);
    return PREPOSITIONS.has(before) ||
      isInfinitive(before) ||
      /(?:ado|ido)$/u.test(before) ||
      (!!before && (next === "de" || next === "del")) ||
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
    (SUBJECTS.has(at.prev(2)) && /^(?:no|le|les|lo|la|me|te|nos)$/u.test(prev) && opens(2));
  // After a named subject, a noun twin ("Mi madre trabajo en…") is the verb when what follows
  // goes with a verb; "el niño modelo saluda" keeps its noun.
  const named =
    !pronounSubject &&
    /o$/u.test(word) &&
    !participle(word) &&
    !ACCENTED_NOMINAL.has(word) &&
    at.tokens[at.i + 1]?.text !== "-" &&
    (!(isNoun(word) || attribute(word)) || AFTER_VERB.has(at.next())) &&
    nounSubject(at, opens);
  const subject = pronounSubject || named;
  if ((prev === "se" && at.prev(2) !== "per") || subject) {
    const m = /^(\p{L}{2,})o$/u.exec(word);
    // "lio" and "guion" take no accent; nouns and adjectives after "él" are not verbs.
    // "Ella, creo, no lo sabe": a parenthetical first person.
    const aside =
      FUNCTION_WORDS.has(word) ||
      (subject && /^(?:creo|pienso|supongo|digo|imagino|opino)$/u.test(word));
    const nominal = pronounSubject && (isNoun(word) || attribute(word));
    if (m && word.length > 3 && !aside && !nominal) {
      if (isVerb(`${m[1]}ar`)) return `${m[1]}ó`;
      if ((isVerb(`${m[1]}er`) || isVerb(`${m[1]}ir`)) && !isNoun(word)) return `${m[1]}ió`;
    }
  }
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
      isInfinitive(future[1]) &&
      (!isNoun(word) || /^(?:ya|tú|se|me|te|le|lo|no)$/u.test(prev)) &&
      word !== "para"
    )
      return `${future[1]}${{ a: "á", as: "ás", an: "án", e: "é" }[future[2]]}`;
  }
  return null;
}

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
  if (at.tokens[at.i].lower !== "hacia") return null;
  const prev = at.prev();
  const next = at.next();
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
const NUMBERS = words(
  "dos tres cuatro cinco seis siete ocho nueve diez once doce quince veinte treinta cien mil",
);

function verbAccents(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
    const at = new Around(tokens, i);
    const fix = nominal(at) ?? verbAccent(at) ?? hacia(at) ?? seria(at);
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
