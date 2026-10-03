import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { readNoun } from "./agreement";
import { Around, attributeOf, CLITICS, replaceToken, tokenize, words, type Token } from "./common";
import { finiteVerb, genderedForm, isNoun, participle, subjunctiveLike } from "./lexicon";

// The comma after a sentence connector that opens its clause ("Sin embargo, no ganó") and
// between a greeting and the person greeted ("Hola, Marta").

const RULE = "spanishTypography" as const;
const MESSAGE = "review_msg_spanish_comma" as const;

const CONNECTORS = [
  "sin embargo",
  "por lo tanto",
  "por tanto",
  "por consiguiente",
  "por ende",
  "en consecuencia",
  "en cambio",
  "por el contrario",
  "al contrario",
  "por otro lado",
  "por otra parte",
  "por un lado",
  "por una parte",
  "además",
  "asimismo",
  "así pues",
  "en primer lugar",
  "en segundo lugar",
  "en tercer lugar",
  "por último",
  "en conclusión",
  "en resumen",
  "en definitiva",
  "en efecto",
  "es decir",
  "o sea",
  "de hecho",
  "por cierto",
  "en fin",
  "aun así",
  "de todos modos",
  "de todas formas",
  // Adverbs that judge the whole sentence: "Afortunadamente, llegó a tiempo".
  "afortunadamente",
  "desafortunadamente",
  "desgraciadamente",
  "lamentablemente",
  "evidentemente",
  "obviamente",
  "efectivamente",
  "sinceramente",
  "francamente",
  "honestamente",
  "curiosamente",
  "sorprendentemente",
  "indudablemente",
].map((phrase) => phrase.split(" "));
// What may follow a connector's words in another reading: "además de", "al contrario que",
// "o sea que", "por otro lado del río", "de hecho y de derecho".
const NOT_CONNECTOR_AFTER = words("de del que a al y e o u como");

const GREETINGS = [
  "hola",
  "adiós",
  "buenos días",
  "buenas tardes",
  "buenas noches",
  "felicidades",
  "enhorabuena",
  "hasta luego",
  "hasta pronto",
  "felices fiestas",
  "muchos besos",
  "muy buen día",
  "buen día",
  "buenas",
  "un beso",
  "un abrazo",
  "besos",
  "abrazos",
  "muchas gracias",
  "gracias",
  "saludos",
  "bienvenido",
  "bienvenida",
  "bienvenidos",
  "bienvenidas",
  "a sus órdenes",
  "feliz cumpleaños",
  "feliz navidad",
  // A question to the person addressed: "¿Cómo estás, Jorge?".
  "cómo estás",
  "cómo estáis",
].map((phrase) => phrase.split(" "));
// Greetings that may close a sentence: "Os deseo buenos días, amigos".
const CLOSING_GREETINGS = words("días día tardes noches");
// Words that open the clause after the person addressed: "Hola amigo, cómo estás".
const CLAUSE_OPENERS = words(
  "cómo como qué que dónde donde cuándo cuando quién quien cuál te me os nos le les ya hoy",
);
const ADDRESSED = words(
  "amigo amiga amigos amigas chico chica chicos chicas guapo guapa guapos guapas cariño " +
    "querido querida queridos queridas señor señora señores señoras señorita jefe jefa " +
    "compañero compañera compañeros compañeras hermano hermana tío tía mamá papá abuelo " +
    "abuela hijo hija niños niñas estimado estimada estimados estimadas colega colegas " +
    "preciosa precioso amor cielo vecino vecina vecinos chaval chavales muchachos " +
    "muchachas gente familia equipo",
);

// ------------------------------------------------------------------ sino and pero

const NEGATIONS = words("no nunca jamás tampoco ni");
// "No hace sino llorar", "nadie sino él", "no tiene otra salida sino esperar": "sino" means
// "except" here and takes no comma.
const EXCEPTIVE = words("nadie nada ningún ninguna ninguno otro otra otros otras más menos cosa");

/**
 * "No lo hizo él sino que lo hice yo" -> "él, sino que": "sino que" opening the clause that
 * replaces a negated one. Without "que" the comma may go ("no es azul sino verde"), and right
 * after the verb "sino" means "only" ("No te pido sino que te vayas").
 */
function commaBeforeSino(tokens: Token[], i: number): boolean {
  if (tokens[i].lower !== "sino" || !tokens[i - 1]?.word || tokens[i].broken) return false;
  const at = new Around(tokens, i);
  if (at.next() !== "que") return false;
  let between = 0;
  for (let k = 1; k <= 12; k++) {
    const word = at.prev(k);
    if (!word || EXCEPTIVE.has(word)) return false;
    if (NEGATIONS.has(word)) return between >= 2;
    if (!CLITICS.has(word)) between++;
  }
  return false;
}

// Finite verbs the dictionary also lists as nouns.
const COMMON_FINITE = words("es son era eran fue fueron ha han va van da dan ve ven hay");
const clauseVerb = (word: string) =>
  COMMON_FINITE.has(word) ||
  (!!word && finiteVerb(word) && !isNoun(word) && !genderedForm(word) && !participle(word));

/** "Son muchos pero no bastan" -> "muchos, pero": "pero" joining two clauses. */
function commaBeforePero(tokens: Token[], i: number): boolean {
  if (tokens[i].lower !== "pero" || !tokens[i - 1]?.word || tokens[i].broken) return false;
  const at = new Around(tokens, i);
  // Only a negated clause is surely one: "pero no bastan", "pero ya no lo tengo".
  let k = 1;
  if (at.next(k) === "ya") k++;
  if (!NEGATIONS.has(at.next(k))) return false;
  k++;
  while (k < 5 && CLITICS.has(at.next(k))) k++;
  if (!clauseVerb(at.next(k))) return false;
  // The clause before it has a verb of its own.
  for (let back = 1; back <= 10; back++) {
    const word = at.prev(back);
    if (!word) return false;
    if (clauseVerb(word)) return true;
  }
  return false;
}

// ------------------------------------------------------------------ subject and verb

// Determiners of a subject a comma may not cut from its verb; "mi"/"tu" open vocatives ("Mi
// amor, está lista la cena").
const SUBJECT_DETERMINERS = words(
  "el la los las este esta estos estas ese esa esos esas aquel aquella aquellos aquellas " +
    "nuestro nuestra nuestros nuestras su sus",
);
// Nouns that open a sentence as an adverbial or a remark, comma and all: "La verdad, no lo sé",
// "El lunes, llegaron todos", "La mayoría, se fue".
const NOT_SUBJECT_NOUNS = words(
  "verdad semana semanas año años mes meses día días tarde tardes noche noches mañana " +
    "mañanas vez veces momento rato verano invierno otoño primavera lunes martes miércoles " +
    "jueves viernes sábado sábados domingo domingos fin principio final mayoría mitad resto",
);
const SINGULAR_COPULA = words("es está era estaba fue será ha va tiene");
const PLURAL_COPULA = words("son están eran estaban fueron serán han van tienen");

/**
 * "El problema, es que…" -> "El problema es": a comma between a subject opening the sentence
 * and its verb. Only common verbs that agree with it are read, and a second comma soon after
 * ("El problema, dice Juan, es…") marks an inserted remark.
 */
function subjectComma(tokens: Token[], i: number): number {
  if (!SUBJECT_DETERMINERS.has(tokens[i].lower) || !new Around(tokens, i).starts) return -1;
  // "¿Este método, es seguro?": a question may set its topic apart.
  if (/^[¿¡]$/u.test(tokens[i - 1]?.text ?? "")) return -1;
  const nounToken = tokens[i + 1];
  // "Esas, se dividen en tres": a plural demonstrative standing for its noun ("Este, …" may be
  // a filler).
  const pronoun = /^(?:estos|estas|esos|esas|aquellos|aquellas)$/u.test(tokens[i].lower);
  const noun =
    pronoun && nounToken?.text === ","
      ? { plural: true }
      : nounToken?.word && !nounToken.broken
        ? readNoun(nounToken.lower)
        : null;
  if (!noun || NOT_SUBJECT_NOUNS.has(nounToken.lower)) return -1;
  let comma = nounToken.text === "," ? i + 1 : i + 2;
  // One adjective after the noun: "Nuestro objetivo principal, es…".
  const adjective = tokens[comma];
  if (comma === i + 2 && adjective?.word && !adjective.broken && !finiteVerb(adjective.lower))
    comma++;
  if (tokens[comma]?.text !== "," || tokens[comma].broken) return -1;
  // "El gobierno, no anunció nada", "La empresa, se fundó en 1990": "no" or "se" first.
  const lead = /^(?:no|se)$/u.test(tokens[comma + 1]?.lower ?? "") ? 1 : 0;
  const verb = tokens[comma + 1 + lead];
  if (!verb?.word || verb.broken || /^\p{Lu}/u.test(tokens[comma + 1].text)) return -1;
  const word = verb.lower;
  let plural = PLURAL_COPULA.has(word);
  if (!plural && !SINGULAR_COPULA.has(word)) {
    // Any other verb whose third person ending agrees: "trabaja", "anunció", "llegaron".
    if (!/(?:n|[aeó])$/u.test(word) || !finiteVerb(word) || isNoun(word)) return -1;
    if (attributeOf(word) || subjunctiveLike(word) || CLITICS.has(word)) return -1;
    plural = word.endsWith("n");
  }
  if (plural !== noun.plural) return -1;
  for (let k = comma + 2; k < comma + 7 && tokens[k] && !tokens[k].broken; k++)
    if (/^[,;:—–()]$/u.test(tokens[k].text)) return -1;
  return comma;
}

/** tokens[i..] spell `phrase` on one line: the index of its last token, or -1. */
function phraseAt(tokens: Token[], i: number, phrase: string[]): number {
  for (let k = 0; k < phrase.length; k++) {
    const token = tokens[i + k];
    if (!token?.word || token.lower !== phrase[k] || (k > 0 && token.broken)) return -1;
  }
  return i + phrase.length - 1;
}

/** The person addressed after a greeting at tokens[at]: the index of its last word, or -1. */
function addressee(tokens: Token[], at: number): number {
  let k = at;
  // "Felicidades, mi querido amigo".
  if (tokens[k]?.lower === "mi" && !tokens[k].broken) k++;
  if (/^querid[oa]s?$/u.test(tokens[k]?.lower ?? "") && ADDRESSED.has(tokens[k + 1]?.lower ?? ""))
    k++;
  const token = tokens[k];
  if (!token?.word || token.broken) return -1;
  if (ADDRESSED.has(token.lower)) return k;
  return k === at && /^\p{Lu}\p{Ll}/u.test(token.text) ? k : -1;
}

/** A comma after tokens[i], unless the writer's word or casing says otherwise. */
function commaAfter(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const token = tokens[i];
  return replaceToken(ctx, token, [`${token.lower},`], RULE, MESSAGE, tokens[i + 1]);
}

function commas(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  const push = (finding: RawFinding | null) => finding && findings.push(finding);
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].word) continue;
    if (commaBeforeSino(tokens, i) || commaBeforePero(tokens, i))
      push(commaAfter(ctx, tokens, i - 1));
    const comma = subjectComma(tokens, i);
    if (comma >= 0)
      push(replaceToken(ctx, tokens[comma], [""], RULE, MESSAGE, tokens[comma + 1], true));
    const starts = new Around(tokens, i).starts;
    let last = -1;
    for (const phrase of starts ? CONNECTORS : []) {
      last = phraseAt(tokens, i, phrase);
      if (last < 0) continue;
      const after = tokens[last + 1];
      const next = after?.lower ?? "";
      // Only before a word of the clause it opens; "Por tanto esfuerzo" is "for so much".
      if (!after?.word || after.broken || NOT_CONNECTOR_AFTER.has(next)) last = -1;
      else if (phrase.join(" ") === "por tanto" && isNoun(next)) last = -1;
      // "Francamente bueno", "Sinceramente tuyo": an adverb of the word after it.
      else if (
        /mente$/u.test(phrase[0]) &&
        (attributeOf(next) || /^(?:tuy|suy|vuestr)/u.test(next))
      )
        last = -1;
      break;
    }
    let addressed = -1;
    if (last < 0) {
      for (const phrase of GREETINGS) {
        last = phraseAt(tokens, i, phrase);
        if (last < 0) continue;
        // "Hola Marta", "Adiós amigos"; "¡Hola a todos!" greets no one by name.
        addressed = addressee(tokens, last + 1);
        // Inside a sentence only a closing greeting before the end: "Te deseo buenos días amigo."
        const closes = addressed >= 0 && new Around(tokens, addressed).endsAfter();
        if (addressed < 0 || (!starts && !(CLOSING_GREETINGS.has(tokens[last].lower) && closes)))
          last = addressed = -1;
        break;
      }
    }
    if (last < 0) continue;
    push(commaAfter(ctx, tokens, last));
    // "Hola amigo, cómo estás": the clause after the person addressed opens with a comma too.
    const next = tokens[addressed + 1];
    if (addressed >= 0 && next?.word && !next.broken && CLAUSE_OPENERS.has(next.lower))
      push(commaAfter(ctx, tokens, addressed));
    i = Math.max(last, addressed);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: commas }];
