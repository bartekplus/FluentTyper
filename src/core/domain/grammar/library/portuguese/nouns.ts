// The rule library (library.ts): Portuguese nouns. What the spelling of a noun tells about its
// gender and number, and the words that are no noun.
import { graphWords } from "../../review/wordGraph";
import type * as Paronyms from "../../review/portuguese/paronyms.generated";
import type * as Data from "../../review/portuguese/verbs.generated";
import { reviewData } from "../../review/reviewLanguageData";

// Words after a determiner that are no noun of their own: pronouns, numbers, adverbs.
export const PT_NOT_NOUNS: ReadonlySet<string> = new Set(
  `a o as os um uma uns umas de do da dos das em no na nos nas que se e ou mas por para pra com
  sem sobre entre até após como onde quando qual quais quem cujo cuja mesmo mesma mesmos mesmas
  próprio própria próprios próprias tal tais qualquer quaisquer cada demais mais menos muito
  muita muitos muitas pouco pouca poucos poucas tanto tanta tantos tantas quanto quanta quantos
  quantas todo toda todos todas tudo nada algo ninguém alguém outro outra outros outras ambos
  ambas vários várias certo certa certos certas agora ainda embora fora cerca contra dentro
  perto longe logo cedo apenas antes depois através atrás jamais sempre nunca também talvez
  aqui ali lá cá isso isto aquilo ele ela eles elas dele dela deles delas nele nela neles nelas
  me te lhe lhes nós vós você vocês si sim não primeiro primeira segundo segunda último última
  dois duas três quatro cinco seis sete oito nove dez onze doze treze catorze quatorze quinze
  dezesseis dezessete dezoito dezenove vinte trinta quarenta cinquenta sessenta setenta oitenta
  noventa cem cento duzentos duzentas trezentos trezentas mil meio meia for fosse era seria
  deste desta destes destas desse dessa desses dessas daquele daquela daqueles daquelas este
  esta estes estas esse essa esses essas aquele aquela aqueles aquelas meu minha meus minhas
  teu tua teus tuas seu sua seus suas nosso nossa nossos nossas vosso vossa vossos vossas
  porém pois portanto contudo todavia senão assim bem mal tão quase só sequer afinal enfim
  pelo pela pelos pelas ao aos num numa nuns numas dum duma duns dumas algum alguma alguns
  algumas nenhum nenhuma vezes tinha vinha estava ia havia fazia podia sabia queria dizia ficava
  teria faria poderia deveria iria viria daria estaria haveria tenha venha seja esteja faça diga
  possa deva queira saiba haja vá dá está há vivo comes`.split(/\s+/),
);

// Nouns in -a that are masculine, and in -o that are feminine.
const MASCULINE_A = new Set(
  `dia mapa clima planeta cometa profeta poeta papa tapa samba alerta gorila panda puma coala
  enigma estigma paradigma dogma magma carisma prisma sofisma aneurisma trauma drama panorama
  pijama melodrama fantasma plasma miasma idioma diploma aroma axioma sintoma genoma
  carcinoma glaucoma hematoma mantra`.split(/\s+/),
);
const FEMININE_O = new Set("tribo foto moto libido virago bio demo promo expo".split(" "));
// Nouns of both genders, or whose spelling is also a word of the other gender.
const BOTH = new Set(
  `colega atleta camarada hipócrita idiota patriota compatriota cosmopolita jesuíta eremita
  israelita parasita levita xiita sunita guia guarda caixa cabeça cara cura capital grama lama
  gama coma cisma crisma diadema lhama águia besta mala anta banana pamonha canalha babaca pateta
  careta caipira jeca rosa laranja violeta cinza turquesa prata cereja oliva lavanda vinho longa
  personagem selvagem modelo piloto membro soprano contralto rádio metro micro macro
  maior menor melhor pior superior inferior exterior interior anterior posterior ulterior major
  júnior sênior sénior prior color bicolor tricolor multicolor incolor sóror vice trouxa sacana
  coringa polícia policia âncora celta primata pirata extra`.split(/\s+/),
);
// Everyday nouns whose ending tells no gender, or the wrong one. Those of CERTAIN_GENDER are no
// verb form; those of GENDER may be one ("filme": que eu o filme).
const CERTAIN_GENDER = new Map<string, boolean>([
  ...`dor cor flor mão lei fé mulher noite morte arte fonte febre árvore chave fase crise tese
  hipótese síntese rede paz voz raiz nuvem ordem fome frase classe ponte gente carne parede
  questão gestão sugestão digestão opinião região religião união reunião legião ocasião razão
  goma redoma broma ema alfazema seriema siriema apostema postema`
    .split(/\s+/)
    .map((word) => [word, true] as const),
  ...`coração tição cação tesão talismã ímã afã divã clã sutiã islã ecrã imã satã rabecã xadrez leite
  dente pente nome
  homem jardim fim pai boi sol mês país papel hotel jornal hospital nariz rapaz arroz café pé
  chá sofá trem som tom lugar mar cão pão chão avião caminhão feijão irmão algodão botão
  cartão limão salão balcão padrão sabão colchão portão pulmão índice cálice ápice vértice`
    .split(/\s+/)
    .map((word) => [word, false] as const),
]);
const GENDER = new Map<string, boolean>([
  ...["filme", "parque", "verão", "time", "golpe", "amanhã"].map((word) => [word, false] as const),
  // Feminine nouns in -ema and -oma, which are also verb forms ("ele soma", "que eu gema").
  ...["soma", "gema", "algema", "toma", "retoma", "doma"].map((word) => [word, true] as const),
]);
// Endings that make a person noun of either gender: o/a jornalista, pediatra, terapeuta.
const TWO_GENDER_ENDING = /(?:[ií]sta|iatra|euta|nauta|crata|pata|icida|ícola|ígena)$/;
const FEMININE_ENDING =
  /(?:ície|écie|érie|árie|ção|ssão|[aeiloun]são|dade|tude|[aiu]gem|ância|ência|eza|idão|idez|vez|atez|ã)$/;
// "-ice" without a written accent: tolice, velhice (but índice, cálice).
const FEMININE_ICE = /^[a-zç]+ice$/;
// "-ema" and "-oma" are masculine ("o tema", "o idioma") except the feminine nouns listed in
// CERTAIN_GENDER and GENDER ("a soma", "a gema", "a goma", "a algema").
const MASCULINE_ENDING = /(?:mento|ismo|ume|or|[eo]ma|grama)$/;
// "compor", "propor": an infinitive after a pronoun "o/os".
const PUT_VERB = /p[oô]r$/;

let lookalikes: Set<string> | undefined;
/** A finite verb form spelled like a noun or adjective whose ending tells its gender. */
export const ptFiniteLookalike = (word: string): boolean =>
  (lookalikes ??= new Set(
    graphWords(reviewData<typeof Data>("pt").PORTUGUESE_FINITE_LOOKALIKES),
  )).has(word);

/** The singular of a plural noun, or null when `word` is no regular plural. */
export function ptSingular(word: string): string | null {
  // "mães" is the plural of "mãe"; the other plurals in -ães are of nouns in -ão ("pães").
  if (word === "mães") return "mãe";
  if (/(?:ões|ães|ãos)$/.test(word)) return `${word.slice(0, -3)}ão`;
  // "anzóis" -> "anzol", "papéis" -> "papel" ("heróis" is the plural of "herói").
  if (/[^r]óis$|éis$/.test(word)) return `${word.slice(0, -3)}${word.at(-3) === "ó" ? "o" : "e"}l`;
  if (/ns$/.test(word)) return `${word.slice(0, -2)}m`;
  // "valores" -> "valor", but "árvores" -> "árvore": a written accent marks the latter.
  if (/[aeiou]res$/.test(word)) return /[áéíóúâêô]/.test(word) ? null : word.slice(0, -2);
  if (/[aeiou]zes$/.test(word)) return word.slice(0, -2);
  if (/ais$/.test(word)) return `${word.slice(0, -2)}l`;
  if (
    /[^áéíóúâêôãõ]{2}[aeo]s$/.test(word) ||
    /^[^áéíóúâêôãõ]*[áéíóúâêô][^áéíóúâêôãõ]*[aeo]s$/.test(word)
  )
    return word.slice(0, -1);
  return null;
}

/** The plural of a singular noun, or null when it cannot be told ("cão": cães or cãos). */
export function ptPlural(word: string): string | null {
  if (/ão$/.test(word)) return null;
  if (/[aeiouãéêóô]$/.test(word)) return `${word}s`;
  if (/m$/.test(word)) return `${word.slice(0, -1)}ns`;
  if (/[rz]$/.test(word)) return `${word}es`;
  if (/al$/.test(word)) return `${word.slice(0, -1)}is`;
  return null;
}

// Singular nouns ending like a plural.
// "pais" is mostly "país" without its accent.
export const PT_SINGULAR_IN_S: ReadonlySet<string> = new Set(
  "atlas pires ourives alferes simples caos cosmos ethos pathos logos óculos férias pais".split(
    " ",
  ),
);

/** A noun: its gender (null: either), its number, and whether its ending fixes the gender. */
export type PtNoun = { feminine: boolean | null; plural: boolean; certain: boolean };

/** What the spelling of a noun tells about it, or null when it may be no noun. */
export function ptNoun(word: string): PtNoun | null {
  if (PT_NOT_NOUNS.has(word) || PT_SINGULAR_IN_S.has(word) || word.length < 3) return null;
  const one = /s$/.test(word) ? ptSingular(word) : word;
  const isPlural = one !== word;
  if (!one || PT_NOT_NOUNS.has(one)) return null;
  const known = CERTAIN_GENDER.get(one);
  if (known !== undefined) return { feminine: known, plural: isPlural, certain: true };
  if (BOTH.has(one) || TWO_GENDER_ENDING.test(one) || /(?:ndo|[aei]r)$/.test(one)) return null;
  const listed = GENDER.get(one);
  if (listed !== undefined) return { feminine: listed, plural: isPlural, certain: false };
  if (FEMININE_ENDING.test(one) || FEMININE_ICE.test(one))
    return { feminine: true, plural: isPlural, certain: true };
  if (MASCULINE_ENDING.test(one) && !PUT_VERB.test(one))
    return { feminine: false, plural: isPlural, certain: true };
  if (MASCULINE_A.has(one)) return { feminine: false, plural: isPlural, certain: false };
  if (FEMININE_O.has(one)) return { feminine: true, plural: isPlural, certain: false };
  if (/a$/.test(one)) return { feminine: true, plural: isPlural, certain: false };
  if (/[^ã]o$/.test(one)) return { feminine: false, plural: isPlural, certain: false };
  // "o frase", "dos pai": the number shows even when the gender does not.
  // Not "-i", "-u", "-ei" or "-ou": those end the preterite ("comi", "retornou", "falei").
  if (/(?:[^aeiou]e|ão|[lz]|éu|[éêóíú])$/.test(one))
    return { feminine: null, plural: isPlural, certain: false };
  return null;
}

// -------------------------------------------------------------- accent paronyms

const PLAIN_VOWEL: Record<string, string> = {
  á: "a",
  â: "a",
  é: "e",
  ê: "e",
  í: "i",
  ó: "o",
  ô: "o",
  ú: "u",
};
/** The word without the written accents of its vowels ("cópia" -> "copia"). */
export const ptPlainVowels = (word: string): string =>
  word.replace(/[áâéêíóôú]/g, (vowel) => PLAIN_VOWEL[vowel]);

let twins: Map<string, string[]> | undefined;
let accented: Set<string> | undefined;
/** The unaccented verb form of an accented noun or adjective twin ("cópia" -> "copia"). */
export function ptVerbTwin(word: string): string | undefined {
  accented ??= new Set(
    graphWords(reviewData<typeof Paronyms>("pt").PORTUGUESE_PARONYMS).flatMap((row) =>
      row.split("|"),
    ),
  );
  return accented.has(word) ? ptPlainVowels(word) : undefined;
}
/** The accented noun or adjective twins of an unaccented verb form ("copia" -> ["cópia"]). */
export function ptAccentedTwins(word: string): string[] | undefined {
  twins ??= new Map(
    graphWords(reviewData<typeof Paronyms>("pt").PORTUGUESE_PARONYMS).map((row) => {
      const forms = row.split("|");
      return [ptPlainVowels(forms[0]), forms];
    }),
  );
  return twins.get(word);
}
