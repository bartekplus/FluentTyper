import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { graphWords } from "../wordGraph";
import { PORTUGUESE_FINITE_LOOKALIKES } from "./verbs.generated";

/**
 * Gender and number agreement inside a noun phrase: "uma problema" -> "um", "os casas" ->
 * "as", "o nossa equipe" -> "a", "dos pai" -> "do pai" or "dos pais", "a política econômico"
 * -> "econômica". Only nouns whose gender is certain take part:
 * - an ending that fixes it ("-ção", "-dade", "-agem", "-ância", "-eza" feminine; "-mento",
 *   "-ismo", "-ume", "-or" masculine), with the few exceptions listed below;
 * - otherwise "-a" feminine and "-o" masculine, minus the listed exceptions (o dia, o
 *   problema, a foto) and two-gender nouns (o/a artista, o/a modelo). These defaults are only
 *   trusted after a determiner that is never an object pronoun: "o", "a", "os", "as" and
 *   "nos" also stand for "him", "her", "them", "us" before a verb ("ele o ajuda", "eu as
 *   alimento"), so after those only an ending no verb has counts, or the start of a sentence
 *   or a preposition before them.
 */

const S = SPACE;
const W = WORD_END;

// Rows: masculine singular, feminine singular, masculine plural, feminine plural.
const DETERMINER_ROWS = [
  "o a os as",
  "um uma uns umas",
  "do da dos das",
  "no na nos nas",
  "pelo pela pelos pelas",
  "ao à aos às",
  "num numa nuns numas",
  "dum duma duns dumas",
  "este esta estes estas",
  "esse essa esses essas",
  "aquele aquela aqueles aquelas",
  "deste desta destes destas",
  "desse dessa desses dessas",
  "daquele daquela daqueles daquelas",
  "neste nesta nestes nestas",
  "nesse nessa nesses nessas",
  "naquele naquela naqueles naquelas",
  "meu minha meus minhas",
  "teu tua teus tuas",
  "seu sua seus suas",
  "nosso nossa nossos nossas",
  "vosso vossa vossos vossas",
  "algum alguma alguns algumas",
  "nenhum nenhuma nenhuns nenhumas",
  "outro outra outros outras",
  "todo toda todos todas",
  "- muita muitos muitas",
  "- pouca poucos poucas",
  "- - vários várias",
  "- - diversos diversas",
  "- - tantos tantas",
  "- - certos certas",
  "cujo cuja cujos cujas",
].map((row) => row.split(" "));
type Cell = { row: string[]; index: number };
const DETERMINERS = new Map<string, Cell>();
for (const row of DETERMINER_ROWS)
  row.forEach((word, index) => word !== "-" && DETERMINERS.set(word, { row, index }));
// "a" is also the preposition ("a pé", "a meu ver"); "à/às" are portugueseConfusions' crase.
const NOT_LEADING = new Set(["a", "à", "às"]);
// Determiners that may be an object pronoun before a verb.
const PRONOUN_LIKE = new Set(["o", "a", "os", "as", "nos"]);
// Demonstratives and quantifiers also stand alone ("estes são", "por muitos considerada", "de
// todo verdade"): they only count before a noun whose ending no verb or adjective has.
const STANDALONE = new Set([
  ...DETERMINER_ROWS.slice(8, 17).flat(),
  // The last row, "cujo", only ever stands before its noun.
  ...DETERMINER_ROWS.slice(23, -1).flat(),
]);
const POSSESSIVE_DETERMINERS = new Set(DETERMINER_ROWS.slice(17, 22).flat());
// Possessives and the like agree with the article before them: "o nosso", "as mesmas".
const POSSESSIVE_ROWS = [
  "meu minha meus minhas",
  "teu tua teus tuas",
  "seu sua seus suas",
  "nosso nossa nossos nossas",
  "vosso vossa vossos vossas",
  "outro outra outros outras",
  "mesmo mesma mesmos mesmas",
].map((row) => row.split(" "));
const POSSESSIVES = new Map<string, Cell>();
for (const row of POSSESSIVE_ROWS)
  row.forEach((word, index) => POSSESSIVES.set(word, { row, index }));
const ARTICLES = new Set(DETERMINER_ROWS.slice(0, 8).flat());
// A plural verb right after the noun phrase that opens a sentence.
const PLURAL_VERB_AFTER =
  /^[ \t\u00a0]+(?:são|estão|foram|eram|estavam|têm|tinham|vão|iam|ficaram|ficam|parecem|serão)(?![\p{L}])/u;
// "muita/pouca/tanta" are never the adverb: before a plural they disagree ("muita coisas").
const QUANTIFIERS = new Set(["muita", "pouca", "tanta"]);
const NAMED_TASK = /^[ \t\u00a0]+a[ \t\u00a0]+\p{Ll}+[aei]r(?![\p{L}])/u;
const CONTRACTED = new Set(
  DETERMINER_ROWS.slice(2, 8)
    .flat()
    .filter((word) => !/^(?:a|à|às|ao|aos)$/.test(word)),
);

// Two-gender adjectives that come before a noun: "um grande erupção" -> "uma grande".
const PRENOMINAL =
  "grandes?|enormes?|fortes?|breves?|leves?|tristes?|simples|principa(?:l|is)|excelentes?|importantes?|recentes?|\\p{Ll}{3,}(?:vel|veis)";
// "a" leads only for the adjective after its noun ("a política econômica").
const LEAD = [...DETERMINERS.keys()]
  .filter((word) => word === "a" || !NOT_LEADING.has(word))
  .join("|");
const PATTERN = `(?<target>${LEAD})(?=${S}(?:(?<modifier>(?:(?:mais|menos|tão)${S})?(?:${PRENOMINAL}))${S})?(?<noun>\\p{L}+)${W}(?!-))`;

// Words after a determiner that are no noun of their own: pronouns, numbers, adverbs.
const NOT_NOUNS = new Set(
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
  /(?:ção|ssão|[aeiloun]são|dade|tude|[aiu]gem|ância|ência|eza|idão|idez|vez|atez|ã)$/;
// "-ice" without a written accent: tolice, velhice (but índice, cálice).
const FEMININE_ICE = /^[a-zç]+ice$/;
// "-ema" and "-oma" are masculine ("o tema", "o idioma") except the feminine nouns listed in
// CERTAIN_GENDER and GENDER ("a soma", "a gema", "a goma", "a algema").
const MASCULINE_ENDING = /(?:mento|ismo|ume|or|[eo]ma|grama)$/;
// "compor", "propor": an infinitive after a pronoun "o/os".
const PUT_VERB = /p[oô]r$/;

let lookalikes: Set<string> | undefined;
const finiteLookalike = (word: string) =>
  (lookalikes ??= new Set(graphWords(PORTUGUESE_FINITE_LOOKALIKES))).has(word);

/** The singular of a plural noun, or null when `word` is no regular plural. */
function singular(word: string): string | null {
  if (/(?:ões|ães|ãos)$/.test(word)) return `${word.slice(0, -3)}ão`;
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
function plural(word: string): string | null {
  if (/ão$/.test(word)) return null;
  if (/[aeiouãéêóô]$/.test(word)) return `${word}s`;
  if (/m$/.test(word)) return `${word.slice(0, -1)}ns`;
  if (/[rz]$/.test(word)) return `${word}es`;
  if (/al$/.test(word)) return `${word.slice(0, -1)}is`;
  return null;
}

// Singular nouns ending like a plural.
// "pais" is mostly "país" without its accent.
const SINGULAR_IN_S = new Set(
  "atlas pires ourives alferes simples caos cosmos ethos pathos logos óculos férias pais".split(
    " ",
  ),
);

type Noun = { feminine: boolean | null; plural: boolean; certain: boolean };

/** What the spelling of a noun tells about it, or null when it may be no noun. */
export function analyze(word: string): Noun | null {
  if (NOT_NOUNS.has(word) || SINGULAR_IN_S.has(word) || word.length < 3) return null;
  const one = /s$/.test(word) ? singular(word) : word;
  const isPlural = one !== word;
  if (!one || NOT_NOUNS.has(one)) return null;
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

// Words before an article that leave it no pronoun: a preposition, or a sentence start.
const PREPOSITION_BEFORE =
  /(?:^|[^\p{L}])(?:para|com|sem|sobre|entre|contra|até|após|perante|desde|mediante|durante|conforme|segundo)[ \t\u00a0]+$/iu;
/** Text before a sentence or clause start: punctuation, closing marks, an opening quote. */
export const SENTENCE_START = /(?:^|[.!?;:\n]["'”’»)]*)[ \t\u00a0]*["'“‘«(]?[ \t\u00a0]*$/u;
// "cada um ajuda", "isso da trabalho" (dá), "esta cansado" (está).
const RECIPROCAL = /^[^.!?;\n]{0,80}(?<![\p{L}])outr[oa]s?(?![\p{L}])/iu;
const PRONOUN_UM = /(?:^|[^\p{L}])(?:cada|nem|qualquer|algum|nenhum|tal|o)[ \t\u00a0]+$/iu;
// "trinta e uma canetas", "mil e uma noites": a number ending in "um".
const NUMBER_AND =
  /(?:^|[^\p{L}])(?:vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|mil|\p{N}+)[ \t\u00a0]+e[ \t\u00a0]+$/iu;
const SUBJECT_BEFORE =
  /(?:^|[^\p{L}])(?:eu|tu|ele|ela|você|nós|eles|elas|vocês|isso|isto|aquilo|tudo|nada|não|que|se|quem|me|te|lhe|nos|vos)[ \t\u00a0]+$/iu;

/** Whether the determiner surely is one here, for a noun whose gender is no certainty. */
function plainDeterminer(ctx: DetectContext, det: string, start: number, typed: string): boolean {
  const before = ctx.text.slice(Math.max(0, start - 40), start);
  // "Nos vemos amanhã": a sentence may open with the pronoun "nos".
  if (det === "nos") return false;
  // After "é necessário" or "é proibido" the article opens the subject.
  if (PRONOUN_LIKE.has(det))
    return SENTENCE_START.test(before) || PREPOSITION_BEFORE.test(before) || PREDICATE.test(before);
  // "Um ajuda, o outro atrapalha": "um" as a pronoun, with "outro" later on.
  if (det === "um" || det === "uma")
    return !PRONOUN_UM.test(before) && !RECIPROCAL.test(ctx.text.slice(start, start + 80));
  // "Nossa, que susto": an interjection.
  if (det === "nossa" && typed !== det) return !SENTENCE_START.test(before);
  return !STANDALONE.has(det);
}

// "por muitos considerada", "de todo verdade", "aos outros regras": a quantifier as a pronoun.
const PREPOSITION_JUST_BEFORE =
  /(?:^|[^\p{L}])(?:por|a|de|para|entre|com|sem|aos|dos|das|às)[ \t\u00a0]+$/iu;
// "o pelo do gato": a noun, after an article or a possessive.
const NOUN_PELO = /(?:^|[^\p{L}])(?:o|os|um|seu|meu|teu|nosso|do|no|pelo)[ \t\u00a0]+$/iu;

/** Context that makes the word no determiner whatever noun follows. */
function notDeterminer(det: string, before: string): boolean {
  // "Ela te da oportunidades": the verb "dá" without its accent.
  if ((det === "da" || det === "das") && SUBJECT_BEFORE.test(before)) return true;
  if (/^pel[oa]s?$/.test(det) && NOUN_PELO.test(before)) return true;
  if (/^um/.test(det) && NUMBER_AND.test(before)) return true;
  return (STANDALONE.has(det) || /^algu/.test(det)) && PREPOSITION_JUST_BEFORE.test(before);
}

const NUMBER_WORD =
  /^(?:dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|mil)$/;
// "no porta malas", "um escalda rabos", "o camisa 10", "um extra três semanas": a compound
// written without its hyphen, or a shirt number.
function compoundAfter(ctx: DetectContext, end: number, noun: Noun): boolean {
  const next = /^[ \t\u00a0]+([\p{L}\p{N}]+)/u.exec(ctx.text.slice(end, end + 40))?.[1];
  if (!next) return false;
  if (/^\p{N}/u.test(next) || NUMBER_WORD.test(next)) return true;
  return !noun.plural && /^\p{Ll}{3,}s$/u.test(next) && !!singular(next) && !NOT_NOUNS.has(next);
}

/** "O" alone reads as a capital, not as uppercase. */
const caseOf = (typed: string) =>
  typed.length === 1 ? (typed === typed.toLowerCase() ? "lower" : "title") : detectWordCase(typed);

function finding(
  start: number,
  end: number,
  typed: string,
  alternatives: string[],
  context: { start: number; end: number },
): RawFinding {
  const style = caseOf(typed);
  return {
    ruleId: "portugueseAgreement",
    messageKey: "review_msg_pt_noun_agreement",
    range: { start, end },
    alternatives: alternatives.map((alternative) => applyWordCase(alternative, style)),
    context,
    ...(alternatives.length > 1 && { requiresChoice: true }),
  };
}

/** The noun right after `end`: its analysis, or only its number. */
function nextNoun(ctx: DetectContext, end: number): Noun | null {
  const next = /^[ \t\u00a0]+(\p{Ll}+)(?![\p{L}-])/u.exec(ctx.text.slice(end, end + 40))?.[1];
  if (!next || NOT_NOUNS.has(next)) return null;
  const info = analyze(next);
  if (info) return info;
  return /s$/.test(next) && !SINGULAR_IN_S.has(next) && singular(next)
    ? { feminine: null, plural: true, certain: false }
    : null;
}

/** "o nossa equipe" -> "a nossa", "os outro caras" -> "outros": an article and a possessive. */
function possessiveAgreement(
  ctx: DetectContext,
  m: RegExpExecArray,
  cell: Cell,
  possessive: Cell,
): RawFinding | null {
  if (possessive.index === cell.index || cell.row[possessive.index] === "-") return null;
  const typed = m.groups!.target;
  const word = m.groups!.noun;
  const [start] = m.indices!.groups!.target;
  const [wordStart, wordEnd] = m.indices!.groups!.noun;
  const context = { start, end: wordEnd };
  const next = nextNoun(ctx, wordEnd);
  const fits = (index: number) =>
    !!next &&
    next.plural === index > 1 &&
    (next.feminine === null || next.feminine === (index % 2 === 1));
  // The noun after shows which of the two is wrong ("o mesma dia" -> "mesmo").
  if (next && fits(cell.index) && !fits(possessive.index))
    return finding(wordStart, wordEnd, word, [possessive.row[cell.index]], context);
  // No noun, or one of either gender ("da seu espécie"): either word may be the wrong one.
  const ownForm = possessive.row[cell.index];
  if ((!next || fits(cell.index)) && ownForm !== "-") {
    const between = ctx.text.slice(start + typed.length, wordStart);
    return finding(
      start,
      wordEnd,
      typed,
      [
        `${cell.row[possessive.index]}${between}${word}`,
        `${typed.toLowerCase()}${between}${ownForm}`,
      ],
      context,
    );
  }
  return finding(start, start + typed.length, typed, [cell.row[possessive.index]], context);
}

const TODO = /^(?<todo>tod[oa]s?)[ \t\u00a0]+(?<article>[oa]s?)$/iu;

// Adjectives of kind, which say what something is, not how someone felt ("voltou da viagem
// cansado"): "-ico" with a written accent, nationalities in "-ês", "-eiro" and "-ário".
// "mesa" and "meses" are nouns, so only "-ês" and longer "-eses" count.
const RELATIONAL =
  /^(?:\p{Ll}*[áéíóúâêô]\p{Ll}*ic[oa]s?|\p{Ll}+ês|\p{Ll}{4,}eses|\p{Ll}+eir[oa]s?|\p{Ll}+ári[oa]s?)$/u;
// Nouns that name a word, color or kind before another word: "a palavra brasileiro".
const NAMING = new Set(
  "palavra palavras termo termos nome nomes expressão verbo adjetivo cor tom estilo tipo marca".split(
    " ",
  ),
);
const AFTER_ADJECTIVE = new RegExp(
  `^(?:[ \\t\\u00a0]{0,2}(?:[.,;:!?)]|$)|${S}(?:e|ou|que|de|do|da|dos|das|em|no|na|nos|nas|para|com|por|pelo|pela)${W})`,
  "u",
);

/** "a política econômico" -> "econômica": the adjective right after an agreeing noun phrase. */
function adjectiveAgreement(
  ctx: DetectContext,
  nounEnd: number,
  feminine: boolean,
  plural: boolean,
  noun: string,
  subject: boolean,
): RawFinding | null {
  const m = /^[ \t\u00a0]+(\p{Ll}+)(?![\p{L}\p{N}-])/u.exec(ctx.text.slice(nounEnd, nounEnd + 40));
  if (!m || NAMING.has(noun)) return null;
  const adjective = m[1];
  if (!RELATIONAL.test(adjective) || finiteLookalike(adjective) || ctx.dictionary.has(adjective))
    return null;
  const start = nounEnd + m[0].length - adjective.length;
  const end = start + adjective.length;
  // A verb may follow when the phrase opens the sentence; elsewhere a bare subject may follow
  // the phrase ("Na empresa brasileiro trabalha muito").
  if (!subject && !AFTER_ADJECTIVE.test(ctx.text.slice(end, end + 12))) return null;
  const nationality = /(?:ês|eses)$/.test(adjective);
  const isPlural = nationality ? /eses$/.test(adjective) : /s$/.test(adjective);
  const isFeminine = !nationality && /as?$/.test(adjective);
  const stem = adjective.replace(nationality ? /(?:ês|eses)$/ : /[oa]s?$/, "");
  if (isFeminine === feminine && isPlural === plural) return null;
  // "-ês" adjectives of two genders in the singular are rare; "português" takes "-esa".
  const wanted = nationality
    ? `${stem}${feminine ? (plural ? "esas" : "esa") : plural ? "eses" : "ês"}`
    : `${stem}${feminine ? "a" : "o"}${plural ? "s" : ""}`;
  return finding(start, end, adjective, [wanted], { start: nounEnd - noun.length, end });
}

// "É necessário uma festa" -> "necessária", "É proibido as cartas" -> "São proibidas": with a
// determiner, the subject after "ser" + adjective makes both agree.
const PREDICATE =
  /(?:^|[^\p{L}])(?<verb>é|são|foi|foram|era|eram|será|serão|seria|seriam|fosse|fossem|for|forem|seja|sejam)(?<gap>[ \t\u00a0]+(?:(?:realmente|muito|bem|bastante|absolutamente|totalmente|extremamente)[ \t\u00a0]+)?)(?<adjective>(?<stem>necessári|proibid|permitid|obrigatóri|bonit)[oa]s?|louváve(?:l|is))[ \t\u00a0]+$/diu;
const VERB_NUMBER: Record<string, string> = {
  é: "são",
  foi: "foram",
  era: "eram",
  será: "serão",
  seria: "seriam",
  fosse: "fossem",
  for: "forem",
  seja: "sejam",
};
const VERB_SINGULAR = Object.fromEntries(Object.entries(VERB_NUMBER).map(([a, b]) => [b, a]));

function predicateAgreement(
  ctx: DetectContext,
  detStart: number,
  nounEnd: number,
  feminine: boolean,
  plural: boolean,
): RawFinding | null {
  const offset = Math.max(0, detStart - 60);
  const m = PREDICATE.exec(ctx.text.slice(offset, detStart));
  if (!m) return null;
  // "É necessário os alunos estudarem": the noun opens an infinitive clause.
  if (
    /^[ \t\u00a0]+\p{Ll}+(?:r|rem|res|rmos)(?![\p{L}])/u.test(ctx.text.slice(nounEnd, nounEnd + 30))
  )
    return null;
  const { verb, gap, adjective, stem } = m.groups!;
  const wantedAdjective = stem
    ? `${stem}${feminine ? "a" : "o"}${plural ? "s" : ""}`
    : plural
      ? "louváveis"
      : "louvável";
  const lowerVerb = verb.toLowerCase();
  const verbPlural = lowerVerb in VERB_SINGULAR;
  const wantedVerb =
    verbPlural === plural
      ? verb
      : applyWordCase(
          plural ? VERB_NUMBER[lowerVerb] : VERB_SINGULAR[lowerVerb],
          detectWordCase(verb),
        );
  if (wantedVerb === verb && wantedAdjective === adjective.toLowerCase()) return null;
  const adjectiveStart = offset + m.indices!.groups!.adjective[0];
  const start = wantedVerb === verb ? adjectiveStart : offset + m.indices!.groups!.verb[0];
  const end = adjectiveStart + adjective.length;
  const typed = ctx.text.slice(start, end);
  return {
    ruleId: "portugueseAgreement",
    messageKey: "review_msg_pt_noun_agreement",
    range: { start, end },
    alternatives: [
      wantedVerb === verb ? wantedAdjective : `${wantedVerb}${gap}${wantedAdjective}`,
    ].map((alternative) => applyWordCase(alternative, caseOf(typed.split(/\s/)[0]))),
    context: { start, end: nounEnd },
  };
}

export function nounAgreement(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PATTERN)) {
    const typed = m.groups!.target;
    const det = typed.toLowerCase();
    const noun = m.groups!.noun;
    const modifier = m.groups!.modifier;
    if (modifier && modifier !== modifier.toLowerCase()) continue;
    const [start] = m.indices!.groups!.target;
    const [nounStart, nounEnd] = m.indices!.groups!.noun;
    // The user's own word on either side ("um Zeca", "uma ota") is theirs to agree.
    if (noun !== noun.toLowerCase() || ctx.dictionary.has(noun) || ctx.dictionary.has(det))
      continue;
    // "uma empres...": a word cut short.
    if (/^(?:\.\.|…)/.test(ctx.text.slice(nounEnd, nounEnd + 2))) continue;
    if (typed !== det && !/^\p{Lu}\p{Ll}*$/u.test(typed)) continue;
    const cell = DETERMINERS.get(det)!;
    const context = { start, end: nounEnd };
    const possessive = POSSESSIVES.get(noun);
    if (possessive && ARTICLES.has(det) && det !== "a" && !m.groups!.modifier) {
      const found = possessiveAgreement(ctx, m, cell, possessive);
      if (found) findings.push(found);
      continue;
    }
    // "Todo os erros" -> "Todos os", "toda as soluções" -> "todas as".
    const todo = TODO.exec(`${typed} ${noun}`);
    if (todo && !m.groups!.modifier) {
      const article = DETERMINERS.get(noun)!;
      const next = nextNoun(ctx, nounEnd);
      if (article.index === cell.index || !next || next.plural !== article.index > 1) continue;
      if (next.feminine !== null && next.feminine !== (article.index % 2 === 1)) continue;
      // "o mundo todo a admira": after a noun, "todo" may close it and "a" be a pronoun.
      const before = ctx.text.slice(Math.max(0, start - 40), start);
      if (!next.certain && !SENTENCE_START.test(before) && !PREPOSITION_BEFORE.test(before))
        continue;
      findings.push(
        finding(start, start + typed.length, typed, [cell.row[article.index]], context),
      );
      continue;
    }
    // "sou todo ouvidos", "de todo verdade": "todo" only agrees with an article after it.
    if (/^tod[oa]s?$/.test(det)) continue;
    const info = analyze(noun);
    if (!info) continue;
    const before = ctx.text.slice(Math.max(0, start - 40), start);
    if (notDeterminer(det, before)) continue;
    // An ending no verb or adjective has, or a determiner that surely is one.
    const verbProof = info.certain && !finiteLookalike(noun);
    // "Este gatos estão", "Um canecas são": a plural verb right after shows a plural subject.
    const pluralSubject =
      info.plural &&
      SENTENCE_START.test(before) &&
      PLURAL_VERB_AFTER.test(ctx.text.slice(nounEnd, nounEnd + 16));
    if (
      !verbProof &&
      !pluralSubject &&
      !(QUANTIFIERS.has(det) && info.plural) &&
      (!plainDeterminer(ctx, det, start, typed) || compoundAfter(ctx, nounEnd, info))
    )
      continue;
    // "colegas meus são": a possessive after its noun, before a verb.
    if (POSSESSIVE_DETERMINERS.has(det) && info.feminine === null) continue;
    const detFeminine = cell.index % 2 === 1;
    const detPlural = cell.index > 1;
    const genderClash = info.feminine !== null && info.feminine !== detFeminine;
    // "ao termos", "pelo fazermos": a personal infinitive, not the plural of "termo".
    const numberClash = info.plural !== detPlural && !(info.plural && /[aeio]rmos$/.test(noun));
    if (!genderClash && !numberClash) {
      // Determiner and noun agree: an adjective of kind after them must too.
      if (info.feminine !== null) {
        const subject = /^(?:[oa]s?|um|uma|uns|umas)$/.test(det) && SENTENCE_START.test(before);
        const found = adjectiveAgreement(ctx, nounEnd, info.feminine, info.plural, noun, subject);
        if (found) findings.push(found);
        const predicate = predicateAgreement(ctx, start, nounEnd, info.feminine, info.plural);
        if (predicate) findings.push(predicate);
      }
      continue;
    }
    // "a" is also the preposition: "a pé", "a cavalo".
    if (det === "a" && !pluralSubject) continue;
    // "no euromilhões", "uma Libertadores", "no Contas a Pagar": a plural that agrees with a
    // singular determiner in nothing is mostly a name.
    // A contracted preposition still shows the phrase: "na termos" -> "nos termos", but not
    // before a name like "no Contas a Pagar" written in lowercase.
    if (
      info.plural &&
      !detPlural &&
      !pluralSubject &&
      ((genderClash &&
        (!CONTRACTED.has(det) || NAMED_TASK.test(ctx.text.slice(nounEnd, nounEnd + 24)))) ||
        (!info.certain && info.feminine === null))
    )
      continue;
    const wanted = cell.row[(info.plural ? 2 : 0) + ((info.feminine ?? detFeminine) ? 1 : 0)];
    if (wanted === "-") continue;
    // A number clash may also be the noun's: "os carro" -> "o carro" or "os carros".
    const nounFix = genderClash || pluralSubject ? null : detPlural ? plural(noun) : singular(noun);
    if (nounFix) {
      const between = ctx.text.slice(start + typed.length, nounStart);
      findings.push(
        finding(
          start,
          nounEnd,
          typed,
          [`${wanted}${between}${noun}`, `${det}${between}${nounFix}`],
          context,
        ),
      );
    } else findings.push(finding(start, start + typed.length, typed, [wanted], context));
  }
  return findings;
}
