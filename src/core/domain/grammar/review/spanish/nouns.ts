// Spanish nouns and determiners: the gender and number of a noun, read from the dictionary, its
// plural, and the forms of the determiners. The rule library (library/spanish.ts) exports them.
import { wordTable } from "../wordTable";
import { memoize } from "../../implementations/helpers/GenericRuleShared";
import { isInfinitive, words } from "./common";
import {
  accentLast,
  genderedForm,
  isGenderedEntry,
  isInvariantEntry,
  isNounEntry,
  plain,
} from "./lexicon";

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

export type Determiner = { forms: string[]; slot: number };
export const DETERMINER = new Map<string, Determiner>();
for (const forms of PARADIGMS)
  forms.forEach((form, slot) => {
    if (!form.includes(" ") && !DETERMINER.has(form)) DETERMINER.set(form, { forms, slot });
  });
export const genderless = (det: Determiner) => det.forms[0] === det.forms[1];

export const NUMBER_WORDS = words(
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
    "sarcoma reuma mantra mediodía",
);
// Nouns in -ma that are feminine (most learned -ma nouns are masculine, so -ma decides nothing).
const FEMININE_MA = words(
  "cama forma reforma plataforma norma horma fama llama rama trama dama escama mama goma " +
    "broma loma paloma pluma espuma bruma suma crema yema gema flema diadema cima lima rima " +
    "víctima tarima estima esgrima calma palma firma",
);
// Nouns in -o that are feminine.
const FEMININE_O = words(
  "mano foto moto libido seo nao dinamo dínamo polio demo expo info porno quimio crono " +
    "eco macro",
);
const FEMININE_OR = words("flor labor coliflor sor");
// Either gender: a person noun ("el/la atleta", "el/la testigo"), a colour ("el rosa"), or
// a pair with two meanings ("el/la cometa", "el/la cura", "el/la guía").
export const EITHER = words(
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
export const EITHER_ENDING = /(?:ista|asta|crata|iatra|auta|cida|arca|ita|ota)$/u;

/** The gender a singular noun without -o/-a forms takes, or null where its ending can't tell. */
// Nouns in -e (or another ending that decides nothing) with a fixed gender.
const FEMININE_OTHER = words(
  "madre mujer gente calle noche tarde leche muerte suerte fuente mente llave nave " +
    "clase nieve sangre torre carne sucursal cárcel miel señal catedral sal col " +
    "credencial luz voz paz vez nariz raíz nuez interfaz tez hoz red pared sed merced " +
    "ley imagen razón sien flor fase frase serie especie superficie sede nube fiebre catástrofe " +
    "hélice índole pirámide perdiz lombriz codorniz",
);
const MASCULINE_OTHER = words(
  "padre hombre coche nombre puente diente aceite bosque cine valle pie baile golpe parque " +
    "postre billete árbol papel hotel nivel animal hospital lápiz pez arroz reloj sol " +
    "país mes análisis énfasis paréntesis éxtasis apocalipsis tren pan jardín camión avión " +
    "ratón balcón corazón lugar hogar collar altar cráter carácter club robot chip pastel " +
    "cartel túnel perfil autobús interés revés ciprés ajedrez maíz disfraz tapiz césped ataúd " +
    "cohete paquete juguete tomate chocolate accidente desastre alambre cable menú champú " +
    "café sofá tsunami taxi esquí rubí safari",
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
  // "español", "francés", "alemán", "bribón": the consonant form of an -a pair is masculine.
  if (/(?:ol|és|án|ón|ín)$/u.test(word) && isGenderedEntry(word)) return "m";
  return null;
}

// ------------------------------------------------------------------ noun number

const ACUTE: Record<string, string> = wordTable({ a: "á", e: "é", i: "í", o: "ó", u: "ú" });
const VOWEL_GROUP = /[aeiouáéíóúü]+/gu;

/** The singulars a plural may come from, most likely first. */
export function singulars(word: string): string[] {
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

type Noun = {
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
export const NOT_NOUNS = words(
  "bien mal medio poco mucho demasiado tanto bastante mejor peor mayor menor recién solo " +
    "sólo frente cerca encima debajo delante detrás antes después además mientras menos más " +
    "apenas quizás atrás jamás demás entonces ambos ambas todo toda todos todas eso esto " +
    "aquello ello cada gracias mayores menores mejores peores pocos pocas muchos muchas tantos " +
    "tantas bastantes demasiados demasiadas tic ong",
);

// The checks read the same words many times in a chunk. Keep the recent readings.
const readCached = memoize(readWord, 4096);

/** A noun's number and gender, read from the dictionary, or null for anything else. */
export function readNoun(word: string): Noun | null {
  const noun = readCached(word);
  // A copy: the caller can change it.
  return noun && { ...noun };
}

// "los interesante": an adjective with one form for both genders still shows its number.
const nominalEntry = (word: string) => isNounEntry(word) || isInvariantEntry(word);

function readWord(word: string): Noun | null {
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
    if (accented !== word && (nominalEntry(accented) || isGenderedEntry(accented))) return null;
    for (const singular of singulars(word)) {
      // "ves" is no plural of the letter "ve", nor "noventas" of a number.
      if (singular.length < 3 || NUMBER_WORDS.has(singular)) return null;
      if (nominalEntry(singular))
        return { plural: true, gender: nounGender(singular), paired: false, singular };
    }
    const paired = pairedForm(word);
    return paired?.plural ? paired : null;
  }
  const paired = pairedForm(word);
  if (paired && /[oa]$/u.test(word)) return paired;
  if (nominalEntry(word))
    return { plural: false, gender: nounGender(word), paired: false, singular: word };
  return paired;
}

/** The other gender's form of a paired noun: "médica" -> "médico", "españolas" -> "españoles". */
export function otherGender(noun: Noun, word: string): string | null {
  if (noun.gender !== "f") return null;
  const stem = word.replace(/as?$/u, "");
  const plural = noun.plural ? "s" : "";
  if (isGenderedEntry(`${stem}o`)) return `${stem}o${plural}`;
  if (isGenderedEntry(stem)) return noun.plural ? pluralOf(stem) : stem;
  return null;
}
