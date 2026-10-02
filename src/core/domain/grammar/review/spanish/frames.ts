import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { pluralOf, readNoun } from "./agreement";
import {
  Around,
  attributeOf,
  CLITICS,
  INVARIANT,
  isInfinitive,
  isBoundary,
  replaceToken,
  tokenize,
  words,
  type Token,
} from "./common";
import { finiteVerb, genderedForm, isGerund, isNoun, plain } from "./lexicon";

// Short closed-class frames: "de el" -> "del", "ala casa" -> "a la casa", "miles de persona"
// -> "personas", "soy conscientes" -> "consciente", "q" -> "que".

const span = (ctx: DetectContext, first: Token, last: Token): Token => ({
  ...first,
  end: last.end,
  text: ctx.text.slice(first.start, last.end),
});

/** "la casa de el lago", "ve a el que quieras": the article joins "a" and "de". */
function contraction(ctx: DetectContext, at: Around): RawFinding | null {
  const prep = at.tokens[at.i];
  const article = at.tokens[at.i + 1];
  if (!/^(?:de|a)$/u.test(prep.lower) || article?.text !== "el" || article.broken) return null;
  // "y A el área": a capital mid-sentence is a variable or a name.
  if (/^\p{Lu}/u.test(prep.text) && !at.starts) return null;
  // "de el." and "de el viene" are the pronoun "él" missing its accent.
  const next = at.tokens[at.i + 2];
  if (!next?.word || next.broken || !/^\p{Ll}/u.test(next.text)) return null;
  if (finiteVerb(next.lower) && !isNoun(next.lower) && !attributeOf(next.lower)) return null;
  const joined = prep.lower === "de" ? "del" : "al";
  return replaceToken(
    ctx,
    span(ctx, prep, article),
    [joined],
    "spanishConfusions",
    "review_msg_spanish_contraction",
    next,
  );
}

// Words that take "ala" (wing) without an article: "ala delta", "ala derecha".
const WING = words("delta derecha izquierda norte sur este oeste oriental occidental");
const WING_DETERMINERS = words(
  "el un del al su sus mi mis tu tus este ese aquel otra otras cada las unas estas esas " +
    "aquellas nuestra nuestras vuestra vuestras sin con en de por",
);

/** "voy ala ciudad" -> "a la ciudad": "ala" (wing) before a bare noun is "a la". */
function alaPreposition(ctx: DetectContext, at: Around): RawFinding | null {
  const word = at.tokens[at.i].lower;
  if (word !== "ala" && word !== "alas") return null;
  const prev = at.prev();
  const next = at.next();
  if (!prev || WING_DETERMINERS.has(prev) || !next || WING.has(next)) return null;
  if (!/^\p{Ll}/u.test(at.tokens[at.i + 1].text) || !isNoun(next) || attributeOf(next)) return null;
  const noun = readNoun(next);
  if (!noun || noun.plural !== (word === "alas")) return null;
  return replaceToken(
    ctx,
    at.tokens[at.i],
    [word === "ala" ? "a la" : "a las"],
    "spanishConfusions",
    "review_msg_spanish_confusion",
    at.tokens[at.i + 1],
  );
}

/** "Juan, Antonio y de más." -> "y demás": the rest closing a list. */
function deMas(ctx: DetectContext, at: Around): RawFinding | null {
  const tokens = at.tokens;
  if (tokens[at.i].lower !== "de" || at.next() !== "más" || !/^(?:y|e)$/u.test(at.prev()))
    return null;
  if (!isBoundary(tokens[at.i + 2]) || tokens[at.i + 2]?.text === "?") return null;
  return replaceToken(
    ctx,
    span(ctx, tokens[at.i], tokens[at.i + 1]),
    ["demás"],
    "spanishConfusions",
    "review_msg_spanish_confusion",
  );
}

// Nouns of amount that count a plural: "miles de personas", "decenas de veces".
// Mass nouns an amount may still measure loosely ("millones de dinero" is clumsy, not plural).
const MASS = words(
  "dinero gente agua tiempo información trabajo comida ropa música arena leche aire basura " +
    "energía sangre carne madera gasolina petróleo vino cerveza azúcar sal harina público " +
    "personal ganado polvo",
);
const AMOUNTS = words("miles millones cientos centenares decenas docenas billones millares");

/** "decenas de personalidad" -> "personalidades". */
function amountOf(ctx: DetectContext, at: Around): RawFinding | null {
  if (!AMOUNTS.has(at.tokens[at.i].lower) || at.next() !== "de") return null;
  const token = at.tokens[at.i + 2];
  if (!token?.word || token.broken || !/^\p{Ll}+$/u.test(token.text)) return null;
  const word = token.lower;
  const noun = readNoun(word);
  if (!noun || noun.plural || noun.invariant || !isNoun(word) || attributeOf(word)) return null;
  if (MASS.has(word)) return null;
  // "miles de millones", "cientos de miles": amounts of amounts are plural already.
  if (AMOUNTS.has(word) || finiteVerb(word)) return null;
  const plural = pluralOf(word);
  return plural
    ? replaceToken(
        ctx,
        token,
        [plural],
        "spanishAgreement",
        "review_msg_spanish_agreement",
        at.tokens[at.i],
      )
    : null;
}

const SINGULAR_COPULA = words("soy eres estoy estás");
const DEGREE = words("muy tan bastante demasiado más menos tremendamente realmente");

/** "Soy conscientes", "Estoy cansados": a first or second person singular takes no plural. */
function singularAttribute(ctx: DetectContext, at: Around): RawFinding | null {
  if (!SINGULAR_COPULA.has(at.tokens[at.i].lower)) return null;
  // "Tú y yo estamos" is plural; "yo soy" with a subject before keeps its person.
  if (/^(?:y|e|ni)$/u.test(at.prev(2))) return null;
  const k = DEGREE.has(at.next()) ? 2 : 1;
  const token = at.tokens[at.i + k];
  if (!token?.word || at.tokens[at.i + 1].broken || !/^\p{Ll}+$/u.test(token.text)) return null;
  const word = token.lower;
  if (!word.endsWith("s")) return null;
  const reading = attributeOf(word);
  let singular: string | null = null;
  if (reading?.plural && /[oa]s$/u.test(word) && !isNoun(word)) singular = word.slice(0, -1);
  else if (word.endsWith("ces") && INVARIANT.has(`${word.slice(0, -3)}z`))
    singular = `${word.slice(0, -3)}z`;
  else if (INVARIANT.has(word.slice(0, -1))) singular = word.slice(0, -1);
  else if (INVARIANT.has(word.slice(0, -2))) singular = word.slice(0, -2);
  if (!singular) return null;
  // The attribute closes its phrase: "soy conscientes de", "estoy cansados.".
  const after = new Around(at.tokens, at.i + k);
  if (!after.endsAfter() && !/^(?:de|del|con|para|por|en|a|y|e|pero)$/u.test(after.next()))
    return null;
  return replaceToken(
    ctx,
    token,
    [singular],
    "spanishAgreement",
    "review_msg_spanish_agreement",
    at.tokens[at.i],
  );
}

/** "Con el calor q hace": the chat shorthand for "que" between two words. */
function shorthandQue(ctx: DetectContext, at: Around): RawFinding | null {
  const token = at.tokens[at.i];
  if (token.text !== "q" || !at.prev() || !at.next()) return null;
  if (/^(?:la|una|letra|de|con|y)$/u.test(at.prev()) || at.tokens[at.i + 1].text === ".")
    return null;
  if (!/^\p{Ll}/u.test(at.tokens[at.i + 1].text)) return null;
  return replaceToken(ctx, token, ["que"], "spanishConfusions", "review_msg_typo");
}

// Short imperatives that take their pronouns at the end: "dame", "hazlo", "ponte".
const SHORT_IMPERATIVES = words("da di haz pon sal ten ven ve sé");

/** "Lo dame", "Le dale": a pronoun before an imperative that already carries one. */
function cliticTwice(ctx: DetectContext, at: Around): RawFinding | null {
  const clitic = at.tokens[at.i];
  const verb = at.tokens[at.i + 1];
  if (!CLITICS.has(clitic.lower) || !verb?.word || verb.broken) return null;
  if (!/^\p{Ll}+$/u.test(verb.text) || isNoun(verb.lower)) return null;
  // "dale que te dale": the repeated imperative of the idiom.
  if (at.prev() === "que" && at.prev(2) === verb.lower) return null;
  const m = /^(\p{L}+?)((?:me|te|le|les|lo|la|los|las|nos|os|se){1,2})$/u.exec(verb.lower);
  if (!m) return null;
  const stem = plain(m[1]);
  const imperative =
    SHORT_IMPERATIVES.has(stem) ||
    (/[áéí]/u.test(m[1]) && /[ae]$/u.test(stem) && finiteVerb(stem) && !isInfinitive(verb.lower));
  if (!imperative) return null;
  const finding = replaceToken(
    ctx,
    span(ctx, clitic, verb),
    [],
    "spanishConfusions",
    "review_msg_spanish_clitic_twice",
  );
  return finding && { ...finding, warningOnly: true };
}

/** "Les 20 primeros": a pronoun before a number stands where the article goes. */
function lesNumber(ctx: DetectContext, at: Around): RawFinding | null {
  const token = at.tokens[at.i];
  const count = at.tokens[at.i + 1];
  if (token.lower !== "les" || !count || count.broken || !/^\p{N}+$/u.test(count.text)) return null;
  if (count.text === "1") return null;
  return replaceToken(
    ctx,
    token,
    ["los", "las"],
    "spanishConfusions",
    "review_msg_spanish_pronoun_article",
    count,
  );
}

const COMPOUND_VERB =
  /^(?:corta|para|lava|saca|abre|guarda|limpia|porta|pasa|cuenta|rompe|mata|quita|salva|tapa|cubre|pica|lanza|toca|cumple|sujeta|chupa|espanta|trota|ciempiés)\p{L}{3,}s$/u;

// Shortened adjectives and their full plural forms: "buen amigo" but "buenos amigos".
const APOCOPE: Record<string, [string, string]> = {
  buen: ["buenos", "buenas"],
  mal: ["malos", "malas"],
  gran: ["grandes", "grandes"],
  primer: ["primeros", "primeras"],
  tercer: ["terceros", "terceras"],
};

/** "buen amigos" -> "buenos amigos": the shortened form goes only before a singular noun. */
function apocopePlural(ctx: DetectContext, at: Around): RawFinding | null {
  const token = at.tokens[at.i];
  const forms = APOCOPE[token.lower];
  const nounToken = at.tokens[at.i + 1];
  if (!forms || !nounToken?.word || nounToken.broken || !/^\p{Ll}+$/u.test(nounToken.text))
    return null;
  const noun = readNoun(nounToken.lower);
  if (!noun?.plural || !noun.gender) return null;
  // "gran cortafuegos", "un buen paraguas": a verb-and-noun compound is singular too.
  if (COMPOUND_VERB.test(nounToken.lower)) return null;
  // "Gran Bretaña" and other names are capitalized; "el mal menor" is no plural.
  return replaceToken(
    ctx,
    token,
    [forms[noun.gender === "f" ? 1 : 0]],
    "spanishAgreement",
    "review_msg_spanish_agreement",
    nounToken,
  );
}

/**
 * "las consecuencias directas e indirectos" -> "indirectas": the second of two adjectives
 * joined after a noun agrees with the noun the first one already agrees with.
 */
function coordinatedAdjective(ctx: DetectContext, at: Around): RawFinding | null {
  const noun = readNoun(at.tokens[at.i].lower);
  if (!noun?.gender || noun.paired || !/^\p{Ll}/u.test(at.tokens[at.i].text)) return null;
  const first = at.next();
  const second = at.tokens[at.i + 3];
  if (!/^(?:y|e|o|u|ni)$/u.test(at.next(2)) || !second?.word || second.broken) return null;
  const a = genderedForm(first);
  const b = genderedForm(second.lower);
  // The first adjective agreeing with the noun shows the phrase is "noun adjective y …"; a
  // second word that is a noun too may start a phrase of its own ("faldas rojas y blanco").
  if (!a || !b || isNoun(second.lower) || finiteVerb(second.lower)) return null;
  const feminine = noun.gender === "f";
  if (a.feminine !== feminine || a.plural !== noun.plural) return null;
  if (b.feminine === feminine && b.plural === noun.plural) return null;
  const stem = /^(\p{L}+?)(?:o|a|os|as)$/u.exec(second.lower)?.[1];
  if (!stem || !new Around(at.tokens, at.i + 3).endsAfter()) return null;
  const fix = `${stem}${feminine ? "a" : "o"}${noun.plural ? "s" : ""}`;
  return replaceToken(
    ctx,
    second,
    [fix],
    "spanishAgreement",
    "review_msg_spanish_agreement",
    at.tokens[at.i],
  );
}

// Verbs in -uar whose stressed forms carry "ú": unaccented, they are adjectives.
const UAR: Record<string, string> = {
  continua: "continúa",
  continuas: "continúas",
  continuan: "continúan",
  perpetua: "perpetúa",
  perpetuan: "perpetúan",
};

/** "Continua recibiendo apoyos", "se perpetua": the verb before a gerund or after a pronoun. */
function uarVerb(ctx: DetectContext, at: Around): RawFinding | null {
  const token = at.tokens[at.i];
  const verb = UAR[token.lower];
  if (!verb) return null;
  const next = at.next();
  const gerund = /(?:ando|iendo|yendo)$/u.test(next) && isGerund(next);
  const clitic = /^(?:se|me|te|le|les|nos|os|lo)$/u.test(at.prev());
  if (!gerund && !clitic) return null;
  return replaceToken(
    ctx,
    token,
    [verb],
    "spanishAccents",
    "review_msg_spanish_accent",
    at.tokens[at.i + 1] ?? token,
  );
}

type Check = (ctx: DetectContext, at: Around) => RawFinding | null;

function frames(ctx: DetectContext, checks: Check[]): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
    const at = new Around(tokens, i);
    for (const check of checks) {
      const finding = check(ctx, at);
      if (finding) {
        findings.push(finding);
        break;
      }
    }
  }
  return findings;
}

const CONFUSIONS: Check[] = [
  contraction,
  alaPreposition,
  deMas,
  shorthandQue,
  cliticTwice,
  lesNumber,
];
const AGREEMENT: Check[] = [amountOf, singularAttribute, apocopePlural, coordinatedAdjective];
const ACCENTS: Check[] = [uarVerb];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["spanishConfusions"], detect: (ctx) => frames(ctx, CONFUSIONS) },
  { rules: ["spanishAgreement"], detect: (ctx) => frames(ctx, AGREEMENT) },
  { rules: ["spanishAccents"], detect: (ctx) => frames(ctx, ACCENTS) },
];
