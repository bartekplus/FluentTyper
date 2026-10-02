import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  Around,
  CLITICS,
  CONJUNCTIONS,
  isInfinitive,
  PREPOSITIONS,
  replaceToken,
  SER,
  tokenize,
  verbLike,
  words,
  type Token,
} from "./common";
import {
  attribute,
  finiteVerb,
  genderedForm,
  isGerund,
  isNoun,
  participle,
  isGenderedEntry,
  isNounEntry,
  plain,
  secondPersonVerb,
  subjunctiveLike,
} from "./lexicon";

// Noun-phrase agreement: a determiner and the noun right after it ("la sillas", "el
// bicicleta", "unos coche"), "uno de las", "la primer vez" and "dos perro". Number comes from
// the es_ES dictionary's plural flag; gender from the dictionary's -o/-a pairs or from the
// noun's ending where the ending decides it ("-ción", "-dad", "-aje"), with the nouns that
// break their ending's gender listed apart.

const RULE = "spanishAgreement" as const;
const MESSAGE = "review_msg_spanish_agreement" as const;

type Gender = "m" | "f";

// Determiner paradigms: masculine singular, feminine singular, masculine plural, feminine plural.
const PARADIGMS = [
  "el la los las",
  "un una unos unas",
  "este esta estos estas",
  "ese esa esos esas",
  "aquel aquella aquellos aquellas",
  "nuestro nuestra nuestros nuestras",
  "vuestro vuestra vuestros vuestras",
  "algún alguna algunos algunas",
  "otro otra otros otras",
  "mucho mucha muchos muchas",
  "poco poca pocos pocas",
  "demasiado demasiada demasiados demasiadas",
  "tanto tanta tantos tantas",
  "cuánto cuánta cuántos cuántas",
  "cuanto cuanta cuantos cuantas",
  "mi mi mis mis",
  "tu tu tus tus",
  "su su sus sus",
  "del de_la de_los de_las",
  "al a_la a_los a_las",
].map((line) => line.split(" ").map((form) => form.replace("_", " ")));

type Determiner = { forms: string[]; slot: number };
export const DETERMINER = new Map<string, Determiner>();
for (const forms of PARADIGMS)
  forms.forEach((form, slot) => {
    if (!form.includes(" ") && !DETERMINER.has(form)) DETERMINER.set(form, { forms, slot });
  });
const genderless = (det: Determiner) => det.forms[0] === det.forms[1];

// Determiners that may stand alone as a subject before a verb ("este cuenta", "otros
// dicen"), the clitic pronouns ("la cuentas"), and "el"/"tu" for an unaccented "él"/"tú".
const CLITIC = words("la las los");
const STANDALONE = words(
  "el tu este esta estos estas ese esa esos esas aquel aquella aquellos aquellas otro otra " +
    "otros otras mucho mucha muchos muchas poco poca pocos pocas demasiado demasiada " +
    "demasiados demasiadas tanto tanta tantos tantas cuanto cuanta cuantos cuantas cuánto " +
    "cuánta cuántos cuántas",
);
// Plural pronouns that drop a repeated verb: "unos piden problemas y otros oportunidades".
const ELLIPTIC = words("unos unas otros otras algunos algunas muchos muchas pocos pocas");
const ADJECTIVE_BLOCKERS = words(
  "este esta estos estas ese esa esos esas aquel aquella aquellos aquellas otros otras " +
    "algunos algunas muchos muchas pocos pocas mucho poco demasiado",
);
// "el agua", "un hacha", "algún arma": a stressed a- feminine noun takes these.
const BEFORE_STRESSED_A = words("el un algún ningún del al");

const NUMBER_WORDS = words(
  "cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince " +
    "dieciséis diecisiete dieciocho diecinueve veinte veintidós veintitrés veinticuatro " +
    "veinticinco veintiséis veintisiete veintiocho veintinueve treinta cuarenta cincuenta " +
    "sesenta setenta ochenta noventa cien ciento doscientos trescientos cuatrocientos " +
    "quinientos seiscientos setecientos ochocientos novecientos mil",
);

// ------------------------------------------------------------------ noun gender

// Feminine endings with no common exception.
const FEMININE_ENDING = /(?:ción|sión|xión|dad|tad|tud|umbre|triz)$/u;
// Nouns in -a that are masculine.
const MASCULINE_A = words(
  "día mapa planeta exoplaneta tranvía pijama piyama yoga tequila vodka champaña koala gorila " +
    "sida nirvana bocata problema tema sistema programa clima idioma esquema dilema poema " +
    "drama dogma lema fantasma enigma prisma aroma carisma diploma síntoma trauma panorama " +
    "cromosoma genoma fonema morfema teorema axioma estigma paradigma emblema sofisma plasma " +
    "magma karma puma pragma edema eccema glaucoma carcinoma melanoma hematoma linfoma " +
    "sarcoma reuma",
);
// Nouns in -ma that are feminine (most learned -ma nouns are masculine, so -ma decides nothing).
const FEMININE_MA = words(
  "cama forma reforma plataforma norma horma fama llama rama trama dama escama mama goma " +
    "broma loma paloma pluma espuma bruma suma crema yema gema flema diadema cima lima rima " +
    "víctima tarima estima esgrima calma palma firma",
);
// Nouns in -o that are feminine.
const FEMININE_O = words(
  "mano foto moto libido seo nao dinamo dínamo polio demo expo info porno quimio crono " + "eco",
);
const FEMININE_OR = words("flor labor coliflor sor");
// Either gender: a person noun ("el/la atleta", "el/la testigo"), a colour ("el rosa"), or
// a pair with two meanings ("el/la cometa", "el/la cura", "el/la guía").
const EITHER = words(
  "poeta atleta profeta esteta asceta anacoreta exegeta guardameta proxeneta pirata acróbata " +
    "psicópata sociópata autómata hipócrita colega estratega auriga camarada centinela " +
    "guardia guarda recluta escolta hincha indígena nómada espía vigía terapeuta homeópata " +
    "autodidacta maya inca azteca celta persa croata belga sherpa cometa papa cura guía " +
    "policía mañana manga panda lila rosa naranja violeta malva fucsia turquesa grana cólera " +
    "trompeta corneta batería cámara vista espada delta boa calavera coma " +
    "radio disco testigo modelo soprano piloto miembro reo canguro soldado cabo sargento " +
    "contralto sobrecargo árbitro micro jurado seño escriba paria cabecilla canalla gallina " +
    "crápula sinvergüenza caradura lumbrera tarambana granuja cava tanga cabeza gloria contra",
);
// Endings shared by person nouns of either gender: "-ista", "-crata", "-ota", "-ita".
const EITHER_ENDING = /(?:ista|asta|crata|iatra|auta|cida|arca|ita|ota)$/u;

/** The gender a singular noun without -o/-a forms takes, or null where its ending can't tell. */
// Nouns in -e (or another ending that decides nothing) with a fixed gender.
const FEMININE_OTHER = words(
  "madre mujer gente calle noche tarde leche muerte suerte fuente mente llave nave " +
    "clase nieve sangre torre carne sucursal cárcel miel señal catedral sal col " +
    "credencial luz voz paz vez nariz raíz nuez interfaz tez hoz red pared sed merced " +
    "ley imagen razón sien flor",
);
const MASCULINE_OTHER = words(
  "padre hombre coche nombre puente diente aceite bosque cine valle pie baile golpe parque " +
    "postre billete árbol papel hotel nivel animal hospital lápiz pez arroz reloj sol " +
    "país mes análisis énfasis paréntesis éxtasis apocalipsis",
);
// Greek nouns in -sis and medical ones in -itis: feminine, the same in both numbers.
const INVARIANT_FEMININE = /(?:[^l]sis|itis)$/u;

function nounGender(word: string): Gender | null {
  if (EITHER.has(word)) return null;
  if (FEMININE_OTHER.has(word)) return "f";
  if (MASCULINE_OTHER.has(word)) return "m";
  if (FEMININE_ENDING.test(word)) return "f";
  if (MASCULINE_A.has(word) || /grama$/u.test(word)) return "m";
  if (FEMININE_MA.has(word) || FEMININE_O.has(word) || FEMININE_OR.has(word)) return "f";
  if (EITHER_ENDING.test(word) || /ma$/u.test(word)) return null;
  if (/a$/u.test(word)) return "f";
  // "-ior" comparatives ("la anterior", "el superior") take either gender.
  if (/(?:o|aje|[^i]or)$/u.test(word) && word !== "multicolor") return "m";
  return null;
}

// ------------------------------------------------------------------ noun number

const ACUTE: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };
const VOWEL_GROUP = /[aeiouáéíóúü]+/gu;

/** The written accent the singular takes back: "camion" -> "camión", "ingles" -> "inglés". */
function accentLast(stem: string): string {
  const m = /([aeiou])([ns])$/u.exec(stem);
  return m ? `${stem.slice(0, m.index)}${ACUTE[m[1]]}${m[2]}` : stem;
}

/** The singulars a plural may come from, most likely first. */
function singulars(word: string): string[] {
  const out: string[] = [];
  if (word.endsWith("ces")) out.push(`${word.slice(0, -3)}z`);
  out.push(word.slice(0, -1));
  if (word.endsWith("es")) {
    const stem = word.slice(0, -2);
    out.push(stem, accentLast(stem), plain(stem));
  }
  return out;
}

/** The plural of a singular noun or adjective: "silla" -> "sillas", "camión" -> "camiones". */
export function pluralOf(word: string): string | null {
  if (/[aeoáéó]$/u.test(word) || /[íú]$/u.test(word)) return `${word}s`;
  if (word.endsWith("z")) return `${word.slice(0, -1)}ces`;
  if (/s$|x$/u.test(word)) return null;
  // "camión" -> "camiones": the accent moves off the last syllable.
  if (/[áéíóú][ns]$/u.test(word)) return `${plain(word)}es`;
  // "joven" -> "jóvenes", "examen" -> "exámenes": the stressed syllable gets its accent.
  if (/n$/u.test(word) && !/[áéíóú]/u.test(word)) {
    const groups = [...word.matchAll(VOWEL_GROUP)];
    if (groups.length >= 2) {
      const group = groups[groups.length - 2];
      const strong = group[0].search(/[aeo]/u);
      const at = group.index + (strong >= 0 ? strong : group[0].length - 1);
      return `${word.slice(0, at)}${ACUTE[word[at]] ?? word[at]}${word.slice(at + 1)}es`;
    }
  }
  // "árbol" -> "árboles", "reloj" -> "relojes"; "club" -> "clubs", "tic" -> "tics".
  return /[dljnry]$/u.test(word) ? `${word}es` : `${word}s`;
}

export type Noun = {
  plural: boolean;
  gender: Gender | null;
  /** -o/-a pairs ("niño", "española"): the form shows the gender. */
  paired: boolean;
  singular: string;
  /** "tesis", "crisis": the same form in both numbers. */
  invariant?: boolean;
};

function pairedForm(word: string): Noun | null {
  const form = genderedForm(word);
  if (!form) return null;
  return {
    plural: form.plural,
    gender: form.feminine ? "f" : "m",
    paired: true,
    singular: form.plural ? (singulars(word).find((s) => genderedForm(s)) ?? word) : word,
  };
}

// Singular nouns in -s whose stem is another noun ("la pelvis", "el marcapasos"). Others in -s
// ("crisis", "lunes", "virus") have no noun under them and read as no plural.
const INVARIANT_S = words(
  "mies pelvis marcapasos sosias vals catavinos lunes martes miércoles jueves viernes",
);

// Nouns that are also adverbs, pronouns or prepositions: "los bien pagados", "las medio
// dormidas", "unos frente a otros", "sus cerca de veinte", "un antes y un después".
const NOT_NOUNS = words(
  "bien mal medio poco mucho demasiado tanto bastante mejor peor mayor menor recién solo " +
    "sólo frente cerca encima debajo delante detrás antes después además mientras menos más " +
    "apenas quizás atrás jamás demás entonces ambos ambas todo toda todos todas eso esto " +
    "aquello ello cada gracias mayores menores mejores peores pocos pocas muchos muchas tantos " +
    "tantas bastantes demasiados demasiadas tic ong",
);

/** A noun's number and gender, read from the dictionary, or null for anything else. */
export function readNoun(word: string): Noun | null {
  if (!/^\p{Ll}+$/u.test(word) || word.length < 3) return null;
  if (NUMBER_WORDS.has(word) || NOT_NOUNS.has(word) || isInfinitive(word)) return null;
  const noun = readForm(word);
  if (noun && EITHER.has(noun.singular)) noun.gender = null;
  return noun;
}

function readForm(word: string): Noun | null {
  if (word.endsWith("s")) {
    if (INVARIANT_S.has(word)) return null;
    // "la tesis", "las crisis": one form for both numbers; the determiner says which.
    if (INVARIANT_FEMININE.test(word) && word.length >= 5)
      return {
        plural: false,
        gender: MASCULINE_OTHER.has(word) ? "m" : "f",
        paired: false,
        singular: word,
        invariant: true,
      };
    // "ingles" is "inglés" without its accent before it is the plural of "ingle".
    const accented = accentLast(word);
    if (accented !== word && (isNounEntry(accented) || isGenderedEntry(accented))) return null;
    for (const singular of singulars(word)) {
      // "ves" is no plural of the letter "ve", nor "noventas" of a number.
      if (singular.length < 3 || NUMBER_WORDS.has(singular)) return null;
      if (isNounEntry(singular))
        return { plural: true, gender: nounGender(singular), paired: false, singular };
    }
    const paired = pairedForm(word);
    return paired?.plural ? paired : null;
  }
  const paired = pairedForm(word);
  if (paired && /[oa]$/u.test(word)) return paired;
  if (isNounEntry(word))
    return { plural: false, gender: nounGender(word), paired: false, singular: word };
  return paired;
}

/** The other gender's form of a paired noun: "médica" -> "médico", "españolas" -> "españoles". */
function otherGender(noun: Noun, word: string): string | null {
  if (noun.gender !== "f") return null;
  const stem = word.replace(/as?$/u, "");
  const plural = noun.plural ? "s" : "";
  if (isGenderedEntry(`${stem}o`)) return `${stem}o${plural}`;
  if (isGenderedEntry(stem)) return noun.plural ? pluralOf(stem) : stem;
  return null;
}

// ------------------------------------------------------------------ verbs in disguise

/** The word may be a verb the determiner is the subject or object of: "este cuenta", "la cuentas". */
function verbReading(det: string, word: string): boolean {
  if (CLITIC.has(det) || det === "tu") return finiteVerb(word) || secondPersonVerb(word);
  if (!STANDALONE.has(det)) return false;
  const plural = DETERMINER.get(det)!.slot >= 2;
  // The subject's own person: "estos cuentan", "este cuenta", "estas son".
  const third = plural ? /n$/u.test(word) : /[aeéó]$/u.test(word) || word === "es";
  return third && (finiteVerb(word) || subjunctiveLike(word));
}

const QUANTIFIERS = words("todos todas ambos ambas");
// Words before a clitic that are no verb: "uno las mira", "si no las ve".
const SUBJECT_WORDS = words(
  "yo tú él ella usted nosotros nosotras vosotros vosotras ellos ellas ustedes no ya nunca " +
    "también tampoco siempre que quien si como cuando donde",
);

/**
 * Around "la casa", what rules the verb reading out: a preposition or a verb before ("de la
 * casa", "ordenamos las silla"), or a finite verb right after ("la cosas mejoran").
 */
function nounFrame(tokens: Token[], i: number): boolean {
  const at = new Around(tokens, i);
  const prev = at.prev();
  if (PREPOSITIONS.has(prev) || QUANTIFIERS.has(prev)) return true;
  const verbBefore =
    !!prev &&
    !CLITICS.has(prev) &&
    !SUBJECT_WORDS.has(prev) &&
    !NUMBER_WORDS.has(prev) &&
    (isInfinitive(prev) || isGerund(prev) || finiteVerb(prev));
  if (verbBefore) return !/^\p{Lu}/u.test(tokens[i - 1].text) || new Around(tokens, i - 1).starts;
  // A third-person verb after: "la cosas mejoran"; "si no las rechazo pierdo" starts a clause.
  const next = at.next(2);
  return (
    !!next &&
    (/(?:[aeéó]|n)$/u.test(next) || next === "es") &&
    finiteVerb(next) &&
    !readNoun(next) &&
    !CLITICS.has(next) &&
    !PREPOSITIONS.has(next) &&
    !CONJUNCTIONS.has(next)
  );
}

// ------------------------------------------------------------------ findings

function span(ctx: DetectContext, first: Token, last: Token): Token {
  return { ...first, end: last.end, text: ctx.text.slice(first.start, last.end) };
}

/** Determiner + noun: the two forms that agree, the determiner's first. */
function determinerNoun(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const detToken = tokens[i];
  const nounToken = tokens[i + 1];
  if (!nounToken?.word || nounToken.broken) return null;
  const det = DETERMINER.get(detToken.lower);
  if (!det) return null;
  const prev = new Around(tokens, i).prev();
  // "sean estos montañas": a pronoun before its predicate.
  if (SER.has(prev)) return null;
  // "tanto hombres como mujeres": the correlative, not a determiner.
  if (/^(?:tant|cuant|cuánt)/u.test(detToken.lower)) {
    if ([2, 3, 4].some((k) => new Around(tokens, i).next(k) === "como")) return null;
    if (prev === "en" || prev === "por") return null;
  }
  // "un tanto apretados", "un poco cansadas": the adverb "somewhat".
  if (prev === "un" && /^(?:tanto|poco)$/u.test(detToken.lower)) return null;
  // "treinta y un años", "ciento un días": the numeral "un" counts.
  if (detToken.lower === "un" && (prev === "y" || NUMBER_WORDS.has(prev))) return null;
  // "la ex-ministra", "los e-mails": a compound.
  if (tokens[i + 2]?.text === "-") return null;
  const word = nounToken.lower;
  if (ctx.dictionary.has(word)) return null;
  const noun = readNoun(word);
  if (!noun || (verbReading(detToken.lower, word) && !nounFrame(tokens, i))) return null;
  // An adjective after a word that also stands alone: "salir de esta vivos" (pronoun),
  // "otras nostálgica" (otras veces), "demasiado pequeña" (adverb), "las hechas" (clitic).
  // "vivos" is a noun too, but its gender forms make it an adjective here.
  const adjective = noun.paired || isGenderedEntry(noun.singular);
  if (adjective && ADJECTIVE_BLOCKERS.has(detToken.lower)) {
    // "aquellos médicas", "esos enfermeras": these stand alone only before a word that agrees
    // with them ("aquellos interesados"); "esta"/"estas" may still be "está"/"estás".
    const detPlural = DETERMINER.get(detToken.lower)!.slot >= 2;
    const detFeminine = DETERMINER.get(detToken.lower)!.slot % 2 === 1;
    const clash = detPlural !== noun.plural || detFeminine !== (noun.gender === "f");
    if (!clash || !/^(?:aquel|aquell|esos|esas)/u.test(detToken.lower)) return null;
  }
  if (noun.paired && CLITIC.has(detToken.lower) && participle(word)) return null;
  // "Esta situado": "está" before a participle.
  if (/^(?:esta|estas|este)$/u.test(detToken.lower) && participle(word)) return null;
  // "de unos recompensa", "otras cultural": a pronoun before a verb or an adjective.
  if (ELLIPTIC.has(detToken.lower) && (finiteVerb(word) || !noun.gender)) return null;
  // "el mano a mano", "el boca a boca": a fixed pair.
  if (tokens[i + 3]?.lower === word && /^(?:a|con|por)$/u.test(tokens[i + 2]?.lower ?? ""))
    return null;
  const detPlural = det.slot >= 2;
  const detGender: Gender | null = genderless(det) ? null : det.slot % 2 ? "f" : "m";
  // "un foto reportaje", "la auto regulación", "un pasa tiempo": the determiner agrees with
  // the next noun, so the word between is a split prefix or a misplaced adjective.
  const after = new Around(tokens, i + 1).next();
  const afterNoun = after ? readNoun(after) : null;
  if (
    afterNoun &&
    !afterNoun.paired &&
    afterNoun.plural === detPlural &&
    (!detGender || afterNoun.gender === detGender)
  )
    return null;
  // "un saca leches", "un lanza misiles": a verb and its object written apart.
  if (afterNoun && /[ae]$/u.test(word) && finiteVerb(word)) return null;
  const numberClash = !noun.invariant && detPlural !== noun.plural;
  let genderClash = !!detGender && !!noun.gender && detGender !== noun.gender;
  if (genderClash) {
    // "la médico", "la modelo": a feminine determiner before a masculine form names a woman;
    // in the plural the feminine form is used ("las españoles" is "las españolas").
    if (noun.paired && detGender === "f" && !noun.plural) genderClash = false;
    // "el agua", "un hacha": a feminine noun starting with a stressed a- takes "el"/"un".
    if (BEFORE_STRESSED_A.has(detToken.lower) && /^h?[aá]/u.test(word)) genderClash = false;
    if (ELLIPTIC.has(detToken.lower)) genderClash = false;
  }
  if (!numberClash && !genderClash) return null;
  const gender = noun.gender ?? detGender ?? "m";
  const stressedA = BEFORE_STRESSED_A.has(det.forms[0]) && /^h?[aá]/u.test(word);
  const detFor = (plural: boolean) =>
    det.forms[(gender === "f" && (plural || !stressedA) ? 1 : 0) + (plural ? 2 : 0)];
  const alternatives: string[] = [];
  if (numberClash) {
    const nounForm = noun.plural ? noun.singular : pluralOf(word);
    alternatives.push(`${detFor(noun.plural)} ${word}`);
    if (nounForm) alternatives.push(`${detFor(!noun.plural)} ${nounForm}`);
  } else {
    alternatives.push(`${detFor(noun.plural)} ${word}`);
    const masculine = noun.paired ? otherGender(noun, word) : null;
    if (masculine) alternatives.push(`${detToken.lower} ${masculine}`);
  }
  return replaceToken(ctx, span(ctx, detToken, nounToken), alternatives, RULE, MESSAGE);
}

// "uno de las casas", "muchos de ellas": a pronoun takes the gender of the group it picks from.
// A feminine one may pick a woman from a mixed group ("una de nosotros"), so only the
// masculine is read.
const PICKERS = [
  "uno una unos unas",
  "alguno alguna algunos algunas",
  "ninguno ninguna ningunos ningunas",
  "muchos muchas muchos muchas",
  "pocos pocas pocos pocas",
  "varios varias varios varias",
  "cuántos cuántas cuántos cuántas",
  ...["dos", "tres", "cuatro", "quinien", "seis", "sete", "ocho", "nove"].map((head) => {
    const stem = head === "quinien" ? "quinient" : `${head}cient`;
    return `${stem}os ${stem}as ${stem}os ${stem}as`;
  }),
].map((line) => line.split(" "));
const PICKER = new Map<string, { forms: string[]; slot: number }>();
for (const forms of PICKERS) forms.forEach((form, slot) => PICKER.set(form, { forms, slot }));
const GROUP_GENDER: Record<string, Gender> = {};
for (const word of "los estos esos aquellos ellos nosotros vosotros nuestros vuestros".split(" "))
  GROUP_GENDER[word] = "m";
for (const word of "las estas esas aquellas ellas nosotras vosotras nuestras vuestras".split(" "))
  GROUP_GENDER[word] = "f";

const DEFINITE_GROUP = words(
  "los las estos estas esos esas aquellos aquellas sus mis tus nuestros nuestras vuestros vuestras",
);

function pickerGroup(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const picker = PICKER.get(tokens[i].lower);
  if (!picker) return null;
  const at = new Around(tokens, i);
  if (at.next() !== "de") return null;
  // "la una de la tarde", "los unos de los otros": not a pick from a group.
  // "número uno de las listas": a numeral.
  const prev = at.prev();
  if (/^(?:la|las|los|el|lo)$/u.test(prev) || (prev && readNoun(prev))) return null;
  const word = at.next(2);
  const det = DETERMINER.get(word);
  // The group's noun, past one adjective: "de sus casas", "de sus mayores riquezas".
  const nounAt = readNoun(at.next(3)) ? 3 : readNoun(at.next(4)) ? 4 : 0;
  const noun = nounAt ? readNoun(at.next(nounAt)) : null;
  let group: Gender | null = GROUP_GENDER[word] ?? null;
  // A partitive group is definite: "uno de sus casas", but "un año de muchas novedades".
  if (det && DEFINITE_GROUP.has(word) && noun?.plural) {
    if (EITHER.has(noun.singular)) return null;
    const detGender = genderless(det) ? null : det.slot % 2 ? "f" : "m";
    if (detGender && noun.gender && detGender !== noun.gender) return null;
    group = detGender ?? noun.gender;
  } else if (!GROUP_GENDER[word] || (noun && !noun.plural)) return null;
  if (!group) return null;
  const feminine = picker.slot % 2 === 1;
  if (feminine === (group === "f")) return null;
  // "una de nosotros", "una de mis hermanos": a woman picked from a mixed group of people.
  if (feminine && (!noun || noun.paired || noun.gender !== "m")) return null;
  const fix = picker.forms[(feminine ? 0 : 1) + (picker.slot >= 2 ? 2 : 0)];
  return replaceToken(ctx, tokens[i], [fix], RULE, MESSAGE, tokens[i + 2]);
}

// "la primer vez" -> "primera"; "el primero ministro" -> "primer".
const ORDINALS: Record<string, [string, string]> = {
  primer: ["primer", "primera"],
  tercer: ["tercer", "tercera"],
  primero: ["primer", "primera"],
  tercero: ["tercer", "tercera"],
};
const FEMININE_BEFORE = words("la una esta esa aquella nuestra vuestra otra");
const MASCULINE_BEFORE = words("el un este ese aquel nuestro vuestro otro del al");

function ordinal(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const forms = ORDINALS[tokens[i].lower];
  if (!forms) return null;
  const at = new Around(tokens, i);
  const prev = at.prev();
  const next = at.next();
  const noun = next ? readNoun(next) : null;
  const apocope = !tokens[i].lower.endsWith("o");
  if (apocope) {
    const feminine =
      FEMININE_BEFORE.has(prev) ||
      (!noun?.paired && noun?.gender === "f" && !noun.plural && !MASCULINE_BEFORE.has(prev));
    return feminine ? replaceToken(ctx, tokens[i], [forms[1]], RULE, MESSAGE) : null;
  }
  const before = MASCULINE_BEFORE.has(prev) || /^(?:mi|tu|su)$/u.test(prev);
  if (!before || !noun || noun.plural || noun.gender !== "m") return null;
  // "El primero paso de decirlo": the first one passes on saying it.
  if (at.next(2) === "de" && isInfinitive(at.next(3))) return null;
  return replaceToken(ctx, tokens[i], [forms[0]], RULE, MESSAGE, tokens[i + 1]);
}

// "dos perro", "cincuenta casa": a cardinal above one before a singular noun.
const CARDINALS = new Set(
  [...NUMBER_WORDS].filter((word) => !/^(?:cero|uno|mil|ciento)$/u.test(word)),
);

function cardinalNoun(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  if (!CARDINALS.has(tokens[i].lower)) return null;
  const at = new Around(tokens, i);
  const nounToken = tokens[i + 1];
  if (!nounToken?.word || nounToken.broken) return null;
  // "capítulo dos página tres", "el veinte aniversario", "el puesto cincuenta y siete": a
  // numeral used as a label.
  let k = 1;
  while (NUMBER_WORDS.has(at.prev(k)) || at.prev(k) === "y") k++;
  const prev = at.prev(k);
  const det = DETERMINER.get(prev);
  if ((prev && readNoun(prev) && !verbLike(prev)) || (det && det.slot < 2)) return null;
  // "cien por cien seguro": a percentage grading the word after.
  if (prev === "por" && CARDINALS.has(at.prev(k + 1))) return null;
  // "dos punto cero", "tres coma cinco".
  const after = at.next(2);
  if (after && (NUMBER_WORDS.has(after) || /^\p{N}/u.test(tokens[i + 2]?.text ?? ""))) return null;
  const word = nounToken.lower;
  if (ctx.dictionary.has(word)) return null;
  const noun = readNoun(word);
  if (!noun || noun.plural || verbLike(word) || subjunctiveLike(word)) return null;
  // "siete debido a su limitada": a participle starting a phrase of its own.
  if (participle(word) && PREPOSITIONS.has(at.next(2))) return null;
  const plural = pluralOf(word);
  return plural ? replaceToken(ctx, nounToken, [plural], RULE, MESSAGE, tokens[i]) : null;
}

// ------------------------------------------------------------------ adjectives after the noun

// Time nouns and their gender: "el domingo pasado", "la semana próxima".
const TIME_GENDER: Record<string, Gender> = {};
for (const word of (
  "lunes martes miércoles jueves viernes sábado domingo día mes año siglo verano invierno " +
  "otoño trimestre semestre curso periodo período fin lustro milenio"
).split(" "))
  TIME_GENDER[word] = "m";
for (const word of "semana primavera noche tarde mañana década temporada vez jornada".split(" "))
  TIME_GENDER[word] = "f";
const TIME_ADJECTIVE = /^(pasad|próxim|venider)(o|a|os|as)$/u;

/** "el domingo pasada" -> "pasado", "los tres trimestres próximo" -> "próximos". */
function timeAdjective(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  const noun = tokens[i].lower;
  const singular = noun.endsWith("es") && TIME_GENDER[noun.slice(0, -2)] ? noun.slice(0, -2) : noun;
  const base = TIME_GENDER[singular] ? singular : noun.endsWith("s") ? noun.slice(0, -1) : noun;
  const gender = TIME_GENDER[base];
  const m = TIME_ADJECTIVE.exec(at.next());
  if (!gender || !m || tokens[i + 1].broken) return null;
  // "una vez pasados los nervios": an absolute participle agreeing with the noun after it.
  if (DETERMINER.has(at.next(2))) return null;
  // "lunes" and "martes" are both numbers: the determiner tells.
  const det = DETERMINER.get(at.prev()) ?? DETERMINER.get(at.prev(2));
  const plural = /^(?:lunes|martes|miércoles|jueves|viernes)$/u.test(noun)
    ? det
      ? det.slot >= 2
      : null
    : base !== noun;
  if (plural === null) return null;
  const [, stem, ending] = m;
  const want = `${gender === "f" ? "a" : "o"}${plural ? "s" : ""}`;
  if (ending === want) return null;
  return replaceToken(ctx, tokens[i + 1], [`${stem}${want}`], RULE, MESSAGE, tokens[i]);
}

// Adjectives that also work as adverbs: "tomó la curva más rápido", "lo dijo más claro".
const ADVERBIAL = words(
  "rápido lento claro alto bajo fuerte duro directo fijo seguro barato caro recto derecho " +
    "limpio justo hondo ligero despacio temprano tarde pronto mismo",
);

/**
 * "la serie más seguido" -> "seguida": a determiner, its noun, "más"/"menos" and an adjective
 * that must agree with both. Only where the noun phrase is no preposition's object, since
 * "volvió de las vacaciones más relajado" describes the subject.
 */
function superlativeAdjective(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const det = DETERMINER.get(tokens[i].lower);
  if (!det || genderless(det) || /^(?:del|al)$/u.test(tokens[i].lower)) return null;
  const at = new Around(tokens, i);
  const prev = at.prev();
  const subject = at.starts || prev === "que";
  if (PREPOSITIONS.has(prev) || (CONJUNCTIONS.has(prev) && !subject) || SER.has(prev)) return null;
  // After a verb, "terminó la carrera más cansado" may describe the subject; only a passive
  // agent ("la serie más seguido por el público") ties the adjective to the noun there.
  if (!subject && at.next(4) !== "por") return null;
  const nounWord = at.next();
  const degree = at.next(2);
  const adjective = at.next(3);
  if (!/^(?:más|menos)$/u.test(degree) || !adjective || tokens[i + 3].broken) return null;
  const noun = readNoun(nounWord);
  const form = participle(adjective) ?? genderedForm(adjective);
  if (!noun || !form || ADVERBIAL.has(adjective)) return null;
  const plural = det.slot >= 2;
  const feminine = det.slot % 2 === 1;
  if (noun.plural !== plural || (noun.gender && (noun.gender === "f") !== feminine)) return null;
  if (EITHER.has(noun.singular)) return null;
  if (form.plural === plural && form.feminine === feminine) return null;
  const masculine = adjective.replace(/(?:o|a|os|as)$/u, "o");
  if (!isGenderedEntry(masculine) && !participle(masculine)) return null;
  const fix = `${masculine.slice(0, -1)}${feminine ? "a" : "o"}${plural ? "s" : ""}`;
  return replaceToken(ctx, tokens[i + 3], [fix], RULE, MESSAGE, tokens[i + 1]);
}

// Words between a noun and its adjective: "una torre bien alta", "una casa muy bonita".
const ADJECTIVE_DEGREE = words("muy tan bien bastante demasiado más menos poco");
// -o/-a words that work as adverbs or prepositions after a noun: "la casa junto al río", "las
// chicas solo quieren", "la mesa medio rota", "la reunión debido a la lluvia".
const NOT_POSTPONED = words(
  "junto debido dado puesto solo mismo medio todo tanto cuanto demasiado poco mucho bastante " +
    "recién contrario relativo tocante referente rumbo comparado visto",
);
// Nouns in -ble that are no adjectives.
const NOUNS_IN_BLE = words("mueble muebles inmueble inmuebles cable cables roble robles sable");

type AdjectiveForms = {
  feminine: boolean | null;
  plural: boolean;
  form: (feminine: boolean, plural: boolean) => string;
};

/** An adjective's forms: "rojas" -> feminine plural of rojo/roja; "posible" by number only. */
function adjectiveForms(word: string): AdjectiveForms | null {
  if (NOT_POSTPONED.has(word) || NOT_NOUNS.has(word)) return null;
  const m = /^(\p{L}+?)(o|a|os|as)$/u.exec(word);
  if (m) {
    const stem = m[1];
    // "la mujer piloto", "el testigo": a noun of either gender in apposition.
    if (EITHER.has(`${stem}o`) || EITHER.has(`${stem}a`)) return null;
    // "el pez espada" puts a noun after a noun; only -o/-a pairs and participles agree.
    const read = isGenderedEntry(`${stem}o`) ? genderedForm(word) : participle(word);
    if (!read) return null;
    return { ...read, form: (f, pl) => `${stem}${f ? "a" : "o"}${pl ? "s" : ""}` };
  }
  // "-ble" adjectives have one form per number: "posible", "increíbles".
  const ble = /^(\p{L}+ble)(s?)$/u.exec(word);
  if (!ble || NOUNS_IN_BLE.has(word)) return null;
  return { feminine: null, plural: ble[2] === "s", form: (_f, pl) => `${ble[1]}${pl ? "s" : ""}` };
}

// Nouns a bare noun or an adverbial may follow: "la mayoría niños", "una vez dormida".
const NOT_HEADS = words(
  "vez rato momento mayoría minoría mitad resto parte grupo montón multitud cantidad número " +
    "serie conjunto totalidad tanto poco",
);

/**
 * "Son casas rojos" -> "rojas", "Las sillas blancos son…" -> "blancas": an adjective right after
 * the noun of a subject opening its clause, or of an attribute after "ser". Elsewhere the
 * adjective may describe the subject ("Juan dejó la casa cansado"), so it is left alone.
 */
function postponedAdjective(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  const afterSer = SER.has(at.prev());
  if (!at.starts && !afterSer) return null;
  const det = DETERMINER.get(tokens[i].lower);
  if (det && /^(?:del|al)$/u.test(tokens[i].lower)) return null;
  if (!det && !afterSer) return null;
  const n = det ? i + 1 : i;
  const nounToken = tokens[n];
  if (!nounToken?.word || nounToken.broken || ctx.dictionary.has(nounToken.lower)) return null;
  const noun = readNoun(nounToken.lower);
  // "la mayoría niños", "el domingo corrida de toros": a collective or a time before a noun.
  if (!noun || (!det && noun.paired) || NOT_HEADS.has(noun.singular) || TIME_GENDER[noun.singular])
    return null;
  let gender = noun.gender;
  let plural = noun.plural;
  if (det) {
    const detPlural = det.slot >= 2;
    if (noun.invariant) plural = detPlural;
    else if (detPlural !== plural) return null;
    const detGender: Gender | null = genderless(det) ? null : det.slot % 2 ? "f" : "m";
    const stressedA = BEFORE_STRESSED_A.has(tokens[i].lower) && /^h?[aá]/u.test(nounToken.lower);
    // "un cabeza rapada", "el guía": a noun of either gender keeps its own reading.
    if (!gender && !stressedA && !EITHER.has(noun.singular)) gender = detGender;
    else if (gender && detGender && gender !== detGender && !stressedA) return null;
  }
  let k = n + 1;
  const between = tokens[k]?.lower ?? "";
  if (ADJECTIVE_DEGREE.has(between) || /mente$/u.test(between)) k++;
  const adjToken = tokens[k];
  if (!adjToken?.word || adjToken.broken || tokens[n + 1]?.broken) return null;
  if (!/^\p{Ll}/u.test(adjToken.text) || ctx.dictionary.has(adjToken.lower)) return null;
  const forms = adjectiveForms(adjToken.lower);
  // "El sistema valida la zona": a verb, not an adjective.
  if (!forms || finiteVerb(adjToken.lower)) return null;
  // The adjective closes the noun phrase: "una camisa blanco y negro" names a colour pair.
  const close = new Around(tokens, k);
  const after = close.next();
  if (!close.endsAfter() && /^(?:y|e|o|u|ni)$/u.test(after)) return null;
  // "económico-sociales": the first part of a compound stays masculine singular.
  if (tokens[k + 1]?.text === "-") return null;
  // "física, emocional y cognitivamente": adverbs sharing one "-mente".
  if (tokens[k + 1]?.text === "," && [2, 3, 4].some((m) => /\p{L}{3,}mente$/u.test(close.next(m))))
    return null;
  if (after && readNoun(after) && !finiteVerb(after) && !PREPOSITIONS.has(after)) return null;
  const genderClash = !!gender && forms.feminine !== null && forms.feminine !== (gender === "f");
  const numberClash = forms.plural !== plural;
  if (!genderClash && !numberClash) return null;
  const fix = forms.form(gender ? gender === "f" : !!forms.feminine, plural);
  return replaceToken(ctx, adjToken, [fix], RULE, MESSAGE, nounToken);
}

/** "la más rojo" -> "roja": an article, "más" or "menos" and the adjective standing for its noun. */
function articleSuperlative(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const det = DETERMINER.get(tokens[i].lower);
  if (!det || !/^(?:el|la|los|las|del|al)$/u.test(tokens[i].lower)) return null;
  const at = new Around(tokens, i);
  if (!/^(?:más|menos)$/u.test(at.next()) || !at.next(2)) return null;
  const adjToken = tokens[i + 2];
  if (!/^\p{Ll}/u.test(adjToken.text) || ctx.dictionary.has(adjToken.lower)) return null;
  const forms = adjectiveForms(adjToken.lower);
  // "el más allá", "las más de las veces": no adjective; "la más rojo de todas" closes after it.
  if (!forms || forms.feminine === null) return null;
  const close = new Around(tokens, i + 2);
  if (!close.endsAfter() && !/^(?:de|del|que|en|entre|para)$/u.test(close.next())) return null;
  const plural = det.slot >= 2;
  const feminine = det.slot % 2 === 1;
  if (forms.plural === plural && forms.feminine === feminine) return null;
  return replaceToken(ctx, adjToken, [forms.form(feminine, plural)], RULE, MESSAGE, tokens[i]);
}

// "dar por hecho", "dar por sentado": the participle agrees with the object after it.
const DAR_FORMS = words(
  "doy das da damos dais dan di diste dio dimos disteis dieron daba dabas dábamos daban daré " +
    "darás dará daremos darán daría darías daríamos darían dé des demos den diera dieran " +
    "dado dando dar darlo",
);
const DAR_POR = /^(?:hech|supuest|sentad|terminad|concluid|perdid|cerrad|zanjad)(?:o|a|os|as)$/u;

/** "Se da por hecho la reforma" -> "hecha": "dar por" + participle + the object it describes. */
function darPorParticiple(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  if (!DAR_FORMS.has(tokens[i].lower) || at.next() !== "por" || !DAR_POR.test(at.next(2)))
    return null;
  // "Eso lo da por hecho el ministro": the clitic is the object and the noun phrase the subject.
  if (/^(?:lo|la|los|las)$/u.test(at.prev())) return null;
  const det = DETERMINER.get(at.next(3));
  const nounWord = at.next(4);
  if (!det || genderless(det) || det.forms[0].includes(" ") || !nounWord) return null;
  const noun = readNoun(nounWord);
  const plural = det.slot >= 2;
  const feminine = det.slot % 2 === 1;
  if (!noun || (!noun.invariant && noun.plural !== plural)) return null;
  if (noun.gender && (noun.gender === "f") !== feminine) return null;
  const participleToken = tokens[i + 2];
  const stem = participleToken.lower.replace(/(?:o|a|os|as)$/u, "");
  const fix = `${stem}${feminine ? "a" : "o"}${plural ? "s" : ""}`;
  if (fix === participleToken.lower) return null;
  return replaceToken(ctx, participleToken, [fix], RULE, MESSAGE, tokens[i + 4]);
}

// "esto"/"eso"/"aquello" stand alone; before a noun the determiner is este/ese/aquel.
const NEUTER: Record<string, string[]> = {
  esto: ["este", "esta", "estos", "estas"],
  eso: ["ese", "esa", "esos", "esas"],
  aquello: ["aquel", "aquella", "aquellos", "aquellas"],
};
// Nouns that also work as adverbs of time: "Haz eso mañana", "Termina esto hoy".
const TIME_ADVERBS = words("mañana tarde noche hoy ayer anoche siempre ahora");

/** "en esto momento" -> "este momento", "por eso motivo" -> "ese motivo". */
function neuterDemonstrative(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const forms = NEUTER[tokens[i].lower];
  const nounToken = tokens[i + 1];
  if (!forms || !nounToken?.word || nounToken.broken || !/^\p{Ll}/u.test(nounToken.text))
    return null;
  const word = nounToken.lower;
  if (ctx.dictionary.has(word) || TIME_ADVERBS.has(word)) return null;
  const noun = readNoun(word);
  // "Por eso médicos y enfermeras protestan": a bare plural may be the next clause's subject.
  if (!noun || noun.paired || !noun.gender || noun.plural) return null;
  // "Esto cuenta mucho", "Por eso trabajo", "Por eso vino Jesús": a verb after the pronoun.
  if (finiteVerb(word) || /^(?:vino|fue|dio|hizo|puso|tuvo|cuanto|cuanta)$/u.test(word))
    return null;
  // "¿Es eso intrusismo?": the pronoun is the subject of "ser" and the noun its attribute.
  if (SER.has(new Around(tokens, i).prev())) return null;
  const fix = forms[(noun.gender === "f" ? 1 : 0) + (noun.plural ? 2 : 0)];
  return replaceToken(ctx, tokens[i], [fix], RULE, MESSAGE, nounToken);
}

// Adjectives with one form for both genders that often stand before the noun.
const GENDERLESS_BEFORE = words(
  "gran grandes principal principales mejor mejores peor peores mayor mayores menor menores " +
    "suave suaves fuerte fuertes breve breves enorme enormes simple simples importante " +
    "importantes excelente excelentes interesante interesantes increíble increíbles posible " +
    "posibles útil útiles difícil difíciles fácil fáciles feliz felices triste tristes",
);

/**
 * "el suave corriente" -> "la suave corriente", "los principales impresiones" -> "las": an
 * adjective of either gender between the determiner and the noun leaves the noun's gender to
 * the determiner.
 */
function determinerAdjectiveNoun(
  ctx: DetectContext,
  tokens: Token[],
  i: number,
): RawFinding | null {
  const det = DETERMINER.get(tokens[i].lower);
  const adjective = tokens[i + 1];
  const nounToken = tokens[i + 2];
  if (!det || genderless(det) || !adjective || !GENDERLESS_BEFORE.has(adjective.lower)) return null;
  if (!nounToken?.word || nounToken.broken || adjective.broken || det.forms[0].includes(" "))
    return null;
  if (ctx.dictionary.has(nounToken.lower) || /^\p{Lu}/u.test(nounToken.text)) return null;
  const noun = readNoun(nounToken.lower);
  if (!noun || noun.paired || !noun.gender || EITHER.has(noun.singular)) return null;
  const plural = det.slot >= 2;
  const adjectivePlural = /s$/u.test(adjective.lower);
  if (noun.plural !== plural || adjectivePlural !== plural) return null;
  const detGender: Gender = det.slot % 2 ? "f" : "m";
  if (detGender === noun.gender) return null;
  // "el gran hacha", "un gran águila": a stressed a- noun takes the masculine article.
  if (BEFORE_STRESSED_A.has(tokens[i].lower) && /^h?[aá]/u.test(nounToken.lower)) return null;
  // "la mejor parte", but "lo mejor": only nouns the gender lexicon reads surely.
  const fix = det.forms[(noun.gender === "f" ? 1 : 0) + (plural ? 2 : 0)];
  return replaceToken(ctx, tokens[i], [fix], RULE, MESSAGE, nounToken);
}

const DEGREE_WORDS = words("mucho poco demasiado tanto cuanto cuánto");
// Determiners that never stand alone before a number: "las tres reglas", "estos dos libros".
const NUMBERED = words("el este ese aquel nuestro vuestro del al");
// Prenominal words that agree with the noun after them: "otras cosas", "pocas semanas".
const AGREEING_BEFORE =
  /^(?:otr|poc|much|mism|nuev|viej|únic|últim|propi|verdader|antigu|pequeñ)(?:o|a|os|as)$/u;

/**
 * "muchos otras cosas" -> "muchas", "una pocas semanas" -> "unas", "la tres reglas" -> "las":
 * the word between agrees with the noun, so the determiner is the odd one out.
 */
function determinerAcross(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const det = DETERMINER.get(tokens[i].lower);
  const middle = tokens[i + 1];
  const nounToken = tokens[i + 2];
  if (!det || genderless(det) || !middle?.word || middle.broken) return null;
  if (!nounToken?.word || nounToken.broken || /^\p{Lu}/u.test(nounToken.text)) return null;
  if (ctx.dictionary.has(nounToken.lower) || ctx.dictionary.has(middle.lower)) return null;
  const noun = readNoun(nounToken.lower);
  if (!noun?.gender || noun.invariant || EITHER.has(noun.singular)) return null;
  let gender: Gender = noun.gender;
  // "demasiado pocas respuestas", "mucho mejores notas": the adverb, not the determiner.
  if (det.slot === 0 && DEGREE_WORDS.has(tokens[i].lower)) return null;
  if (CARDINALS.has(middle.lower)) {
    // "la tres veces campeona": a count of times, not of the noun. "una tres meses y otra
    // cuatro" are pronouns, and "con el cuatro películas" may be "él".
    if (!noun.plural || nounToken.lower === "veces" || !NUMBERED.has(det.forms[0])) return null;
    if (tokens[i].lower === "el") return null;
    // "la tres reglas": the noun's gender is surer only when the determiner's is wrong too.
    if (det.slot >= 2) {
      if ((det.slot % 2 ? "f" : "m") === gender || noun.paired) return null;
    }
  } else {
    const adjective = AGREEING_BEFORE.test(middle.lower) ? genderedForm(middle.lower) : null;
    if (!adjective || adjective.plural !== noun.plural) return null;
    if ((adjective.feminine ? "f" : "m") !== gender) return null;
    gender = adjective.feminine ? "f" : "m";
  }
  const fix = det.forms[(gender === "f" ? 1 : 0) + (noun.plural ? 2 : 0)];
  if (fix === tokens[i].lower) return null;
  // "el agua", "un hacha": a stressed a- noun right after the article.
  if (BEFORE_STRESSED_A.has(tokens[i].lower) && /^h?[aá]/u.test(middle.lower)) return null;
  return replaceToken(ctx, tokens[i], [fix], RULE, MESSAGE, nounToken);
}

/**
 * "a favor de lo acreedores", "Lo pequeños roedores" -> "los": the neuter "lo" takes a
 * singular adjective and the clitic a verb; a plural in -os after it wants the article.
 */
function neuterBeforePlural(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  if (tokens[i].lower !== "lo") return null;
  const next = tokens[i + 1];
  if (!next?.word || next.broken || !/^\p{Ll}/u.test(next.text) || ctx.dictionary.has(next.lower))
    return null;
  const word = next.lower;
  // "lo hacemos", "lo vimos", "lo comes": verbs end in -os and -es too.
  if (!/[oe]s$/u.test(word) || /mos$/u.test(word) || finiteVerb(word)) return null;
  if (secondPersonVerb(word)) return null;
  const read = readNoun(word);
  if (!(read?.plural || attribute(word)?.plural) || NUMBER_WORDS.has(word)) return null;
  // "Lo pequeños que son": how small they are.
  if (new Around(tokens, i + 1).next() === "que") return null;
  return replaceToken(ctx, tokens[i], ["los"], RULE, MESSAGE, next);
}

// Words before a noun that are determiners or adverbs rather than adjectives: "solo hombres",
// "todo hombre", "medio día".
const NOT_PRENOMINAL =
  /^(?:tod|much|poc|otr|mism|tant|cuant|vari|cierto|ciert|demasiad|medi|sol|ambos|ambas|cual|dich|propi|semejant)/u;
const APOCOPE: Record<string, string> = {
  buen: "bueno",
  mal: "malo",
  primer: "primero",
  tercer: "tercero",
};

/**
 * "Con magníficos cucharas", "Buen amigos." -> "magníficas", "Buenos": an adjective opening a
 * noun phrase with no determiner, after a preposition or at the sentence start, agrees with
 * the noun right after it.
 */
function bareAdjectiveNoun(ctx: DetectContext, tokens: Token[], i: number): RawFinding | null {
  const at = new Around(tokens, i);
  if (!at.starts && !PREPOSITIONS.has(at.prev())) return null;
  const adjToken = tokens[i];
  const nounToken = tokens[i + 1];
  if (!nounToken?.word || nounToken.broken || /^\p{Lu}/u.test(nounToken.text)) return null;
  if (ctx.dictionary.has(adjToken.lower) || ctx.dictionary.has(nounToken.lower)) return null;
  const typed = adjToken.lower;
  if (NOT_PRENOMINAL.test(typed) || DETERMINER.has(typed)) return null;
  const base = APOCOPE[typed];
  const forms = adjectiveForms(base ?? typed);
  if (!forms || forms.feminine === null || isNoun(typed) || verbLike(typed)) return null;
  if (finiteVerb(typed) || SER.has(typed)) return null;
  const noun = readNoun(nounToken.lower);
  if (!noun?.gender || noun.invariant || EITHER.has(noun.singular)) return null;
  if (verbLike(nounToken.lower) || participle(nounToken.lower)) return null;
  // The phrase closes after the noun or goes on with a preposition or a verb.
  const after = new Around(tokens, i + 1);
  if (!after.endsAfter() && !PREPOSITIONS.has(after.next()) && !CONJUNCTIONS.has(after.next()))
    return null;
  const feminine = noun.gender === "f";
  const plural = base ? false : forms.plural;
  if (feminine === forms.feminine && plural === noun.plural) return null;
  const fix = forms.form(feminine, noun.plural);
  return replaceToken(ctx, adjToken, [fix], RULE, MESSAGE, nounToken);
}

function agreement(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "es") return [];
  const tokens = tokenize(ctx);
  const findings: RawFinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.word || token.start < ctx.from || token.start >= ctx.to) continue;
    const finding =
      timeAdjective(ctx, tokens, i) ??
      superlativeAdjective(ctx, tokens, i) ??
      determinerNoun(ctx, tokens, i) ??
      determinerAdjectiveNoun(ctx, tokens, i) ??
      determinerAcross(ctx, tokens, i) ??
      neuterBeforePlural(ctx, tokens, i) ??
      bareAdjectiveNoun(ctx, tokens, i) ??
      postponedAdjective(ctx, tokens, i) ??
      articleSuperlative(ctx, tokens, i) ??
      darPorParticiple(ctx, tokens, i) ??
      neuterDemonstrative(ctx, tokens, i) ??
      pickerGroup(ctx, tokens, i) ??
      ordinal(ctx, tokens, i) ??
      cardinalNoun(ctx, tokens, i);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: agreement }];
