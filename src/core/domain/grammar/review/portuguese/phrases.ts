import type { PhraseRow } from "../englishPhraseTables";
import { PORTUGUESE_STYLE_EXTRA } from "./style";

/**
 * Portuguese fixed frames for the `pt` phrase table (englishPhraseCorrections):
 * each typed form is wrong wherever it appears. Context-dependent confusions
 * live in confusions.ts.
 */

/** One row per word: `${from} ${word}` becomes `${to} ${word}`. */
const swap = (from: string, to: string, words: string[]): PhraseRow[] =>
  words.map((word) => [`${from} ${word}`, `${to} ${word}`]);
/** One row per typed phrase, all with the same replacement. */
const all = (typed: string[], replacement: string): PhraseRow[] =>
  typed.map((form) => [form, replacement]);

/**
 * Feminines built by rule on nouns whose feminine is another word, atora (atriz), genra
 * (nora), príncipa (princesa), and their misspellings. The pt `words` table
 * (englishPhraseCorrections).
 */
export const PORTUGUESE_WORDS: PhraseRow[] = [
  ["atora", "atriz"],
  ["atoras", "atrizes"],
  ["genra", "nora"],
  ["genras", "noras"],
  ["heróia", "heroína"],
  ["heróias", "heroínas"],
  ["príncipa", "princesa"],
  ["príncipas", "princesas"],
  ["sacerdota", "sacerdotisa"],
  ["sacerdotas", "sacerdotisas"],
  ["czara", "czarina"],
  ["réua", "ré"],
  ["réuas", "rés"],
  ["ateua", "ateia"],
  ["ateuas", "ateias"],
  ["europeua", "europeia"],
  ["judeua", "judia"],
  ["plebeua", "plebeia"],
  ["hebreua", "hebreia"],
  ["pigmeua", "pigmeia"],
  ["leã", "leoa"],
  ["leãs", "leoas"],
  ["padrasta", "madrasta"],
  ["padrastas", "madrastas"],
  ["compadra", "comadre"],
  ["compadras", "comadres"],
  ["princeza", "princesa"],
  ["duqueza", "duquesa"],
  // Verbs whose only participle is the short one.
  ["fazido", "feito"],
  ["fazidos", "feitos"],
  ["dizido", "dito"],
  ["escrevido", "escrito"],
  ["escrevidos", "escritos"],
  ["abrido", "aberto"],
  ["cobrido", "coberto"],
  ["descobrido", "descoberto"],
  ["ponhado", "posto"],
  // Accents that only these words lack.
  ["apos", "após"],
  ["atras", "atrás"],
];

/**
 * "melhor educado" -> "mais bem-educado", "pior humorados" -> "mais mal-humorados": before an
 * adjective compounded with bem- or mal-, the comparative keeps "mais" and the compound.
 */
const COMPARED_COMPOUNDS: PhraseRow[] = (
  [
    ["melhor", "bem-", ["educad", "humorad", "sucedid", "intencionad", "comportad"]],
    ["pior", "mal-", ["educad", "humorad", "intencionad", "comportad"]],
    ["pior", "mal", ["sucedid"]],
  ] as Array<[string, string, string[]]>
).flatMap(([comparative, prefix, stems]) =>
  stems.flatMap((stem) =>
    ["o", "a", "os", "as"].flatMap((ending): PhraseRow[] => {
      const word = `${stem}${ending}`;
      const typed = ending.length > 1 ? [comparative, `${comparative}es`] : [comparative];
      return typed.flatMap((form): PhraseRow[] => [
        [`${form} ${word}`, `mais ${prefix}${word}`],
        [`${form}-${word}`, `mais ${prefix}${word}`],
      ]);
    }),
  ),
);

export const PORTUGUESE_PHRASES: PhraseRow[] = [
  ...COMPARED_COMPOUNDS,
  // No crase before a masculine noun, a pronoun or a verb: "a pé", "a mim", "a esta", "a partir".
  ...swap("à", "a", [
    "pé",
    "cavalo",
    "bordo",
    "vapor",
    "prazo",
    "lápis",
    "óleo",
    "gás",
    "nado",
    "jato",
    "granel",
    "rigor",
    "respeito",
    "favor",
    "caminho",
    "princípio",
    "partir",
    "fim de",
    "menos que",
    "seguir",
    "mim",
    "ti",
    "você",
    "vocês",
    "ele",
    "ela",
    "eles",
    "elas",
    "nós",
    "vós",
    "todos",
    "todas",
    "um",
    "esta",
    "este",
    "estas",
    "estes",
    "essa",
    "esse",
    "essas",
    "esses",
    "isto",
    "isso",
    "quem",
    "cada",
    "qualquer",
    "alguém",
    "ninguém",
    "algum",
    "alguma",
    "nenhum",
    "nenhuma",
    "seu",
    "seus",
    "meu",
    "meus",
    "teu",
    "nosso",
  ]),
  // "a nível de" is itself a calque (see the style table).
  ["à nível de", ["em nível de", "ao nível de"]],
  // A repeated noun joins with a bare "a": "dia a dia", "passo a passo".
  ...[
    "dia",
    "cara",
    "frente",
    "lado",
    "passo",
    "gota",
    "porta",
    "corpo",
    "ponta",
    "pouco",
    "boca",
    "um",
    "uma",
  ].map((word): PhraseRow => [`${word} à ${word}`, `${word} a ${word}`]),
  // Feminine adverbial phrases that do take the crase.
  ...swap("a", "à", ["medida que", "toa", "custa de", "beça"]),
  ...swap("as", "às", ["custas de", "pressas", "escondidas"]),
  ["daqui há", "daqui a"],
  // "à disposição", "à venda", "hoje à noite": the feminine noun takes the article.
  ...["estou", "estamos", "fico", "ficamos", "estará", "estarei", "estaremos"].flatMap(
    (verb): PhraseRow[] => [
      [`${verb} a disposição`, `${verb} à disposição`],
      [`${verb} a sua disposição`, `${verb} à sua disposição`],
      [`${verb} a inteira disposição`, `${verb} à inteira disposição`],
    ],
  ),
  ...["está", "estão", "estava", "estavam", "colocar", "colocou", "pôs", "pôr"].map(
    (verb): PhraseRow => [`${verb} a venda`, `${verb} à venda`],
  ),
  ...["hoje", "amanhã", "ontem", "logo"].flatMap((day): PhraseRow[] => [
    [`${day} a noite`, `${day} à noite`],
    [`${day} a tarde`, `${day} à tarde`],
  ]),
  // "por que" asks about a noun ("por que motivo"); "porque" explains; "porquê" is the noun.
  ...["motivo", "motivos", "razão", "razões"].flatMap((noun) =>
    all([`porque ${noun}`, `porquê ${noun}`, `por quê ${noun}`], `por que ${noun}`),
  ),
  ["o por quê", "o porquê"],
  ...["até", "só", "é", "apenas"].map((word): PhraseRow => [`${word} porquê`, `${word} porque`]),
  // "ter a ver com": "haver" is another verb.
  ...["tem", "tenho", "tinha", "têm", "tinham"].map((verb): PhraseRow => [
    `${verb} haver com`,
    `${verb} a ver com`,
  ]),
  ["nada haver", "nada a ver"],
  // Existential "haver" stays singular in every tense: "havia muitos", "haverá alguns".
  ...[
    ["haviam", "havia"],
    ["haverão", "haverá"],
    ["haveriam", "haveria"],
    ["houvessem", "houvesse"],
    ["houverem", "houver"],
    ["hajam", "haja"],
  ].flatMap(([plural, singular]) =>
    [
      "muitos",
      "muitas",
      "vários",
      "várias",
      "alguns",
      "algumas",
      "poucos",
      "poucas",
      "diversos",
      "diversas",
      "inúmeros",
      "inúmeras",
      "tantos",
      "tantas",
      "uns",
      "umas",
    ].map((word): PhraseRow => [`${plural} ${word}`, `${singular} ${word}`]),
  ),
  ["até por que", "até porque"],
  ...["razão", "motivo"].flatMap((noun) =>
    all([`${noun} porquê`, `${noun} por quê`], `${noun} por que`),
  ),
  ["sera que", "será que"],
  ["a traves", "através"],
  ["em case de", "em caso de"],
  // The participles of "chegar" and "trazer" are "chegado" and "trazido".
  ...[
    "tinha",
    "tinham",
    "tínhamos",
    "tenho",
    "tem",
    "têm",
    "temos",
    "havia",
    "haviam",
    "teria",
    "teriam",
    "terá",
    "tenha",
    "tenham",
    "tivesse",
    "tivessem",
    "ter",
    "tendo",
  ].flatMap((verb): PhraseRow[] => [
    [`${verb} chego`, `${verb} chegado`],
    [`${verb} trago`, `${verb} trazido`],
  ]),
  ...["é", "ser", "foi", "seja", "era"].map((verb): PhraseRow => [
    `${verb} capas de`,
    `${verb} capaz de`,
  ]),
  ["asserto de contas", "acerto de contas"],
  ["melhores comprimentos", "melhores cumprimentos"],
  ["meus comprimentos", "meus cumprimentos"],
  ["nos somos", "nós somos"],
  ...["cruzado", "sem fundos", "sem fundo", "em branco", "sem cobertura", "visado"].map(
    (rest): PhraseRow => [`xeque ${rest}`, `cheque ${rest}`],
  ),
  ...["cruzados", "sem fundos", "sem fundo", "em branco", "sem cobertura", "visados"].map(
    (rest): PhraseRow => [`xeques ${rest}`, `cheques ${rest}`],
  ),
  ...["não", "eu", "mal"].map((word): PhraseRow => [`${word} poço`, `${word} posso`]),
  ...swap("ate", "até", [
    "logo",
    "amanhã",
    "breve",
    "então",
    "agora",
    "hoje",
    "mesmo",
    "que enfim",
  ]),
  ...swap("meia", "meio", ["cheia", "vazia", "cansada", "confusa", "perdida"]),
  ["não vez que", "não vês que"],
  // "mau" qualifies nouns; "mal" qualifies verbs and participles.
  ...swap("mal", "mau", [
    "humor",
    "cheiro",
    "hálito",
    "agouro",
    "exemplo",
    "caráter",
    "funcionamento",
    "uso",
    "comportamento",
    "desempenho",
  ]),
  // "mal-humorado" is always hyphenated; "mal educado" can also be a participle phrase.
  ...["humorado", "humorada", "humorados", "humoradas"].map((form): PhraseRow => [
    [`mau ${form}`, `mal ${form}`],
    `mal-${form}`,
  ]),
  ...["educado", "educados", "entendido", "entendidos"].map((form): PhraseRow => [
    `mau ${form}`,
    `mal-${form}`,
  ]),
  ["má educada", "mal-educada"],
  ["más educadas", "mal-educadas"],
  ["mau sucedido", "malsucedido"],
  ["mau criado", "malcriado"],
  ...swap("mau", "mal", ["servido", "pago", "resolvido", "interpretado", "feito"]),
  // "mal" before a participle, in every gender and number: "má servida" -> "mal servida".
  ...[
    "servid",
    "resolvid",
    "interpretad",
    "aconselhad",
    "acondicionad",
    "conservad",
    "explicad",
    "informad",
    "remunerad",
    "preparad",
    "planejad",
    "tratad",
    "cuidad",
    "alimentad",
    "dormid",
    "aproveitad",
    "executad",
    "acabad",
    "lavad",
  ].flatMap((stem): PhraseRow[] => [
    [`má ${stem}a`, `mal ${stem}a`],
    [`maus ${stem}os`, `mal ${stem}os`],
    [`más ${stem}as`, `mal ${stem}as`],
    ...(["servid", "resolvid", "interpretad", "cuidad"].includes(stem)
      ? []
      : [[`mau ${stem}o`, `mal ${stem}o`] as PhraseRow]),
  ]),
  // "mau" before a noun: "mal exemplo" -> "mau exemplo", "mal conselhos" -> "maus conselhos".
  ...swap("mal", "mau", ["princípio", "conselho", "hábito", "negócio", "sinal", "presságio"]),
  ...["exemplos", "conselhos", "hábitos", "negócios", "momentos", "resultados", "pensamentos"].map(
    (noun): PhraseRow => [`mal ${noun}`, `maus ${noun}`],
  ),
  ["de mal gosto", "de mau gosto"],
  ["em mal estado", "em mau estado"],
  ["mal-olhado", "mau-olhado"],
  ["mal olhado", "mau-olhado"],
  ["de mal grado", "de mau grado"],
  ["mal tratos", "maus-tratos"],
  // "dar à luz" (to give birth) takes the crase.
  ...["deu", "dar", "deram", "dá", "dará", "dando", "dei", "dera", "desse"].flatMap(
    (verb): PhraseRow[] =>
      ["a", "ao", "um", "uma", "gêmeos", "trigêmeos"].map((next): PhraseRow => [
        `${verb} a luz ${next}`,
        `${verb} à luz ${next}`,
      ]),
  ),
  // "desde" split in two.
  ...["o", "a", "os", "as", "aquela", "aquele", "essa", "esse", "esta", "este", "então"].map(
    (next): PhraseRow => [`des d${next === "então" ? "e então" : next}`, `desde ${next}`],
  ),
  ...["saiu", "saíram", "sair", "saem", "sai", "saía", "saíam", "saímos", "foram", "vão"].map(
    (verb): PhraseRow => [`${verb} as ruas`, `${verb} às ruas`],
  ),
  ["meio-dia e meio", "meio-dia e meia"],
  ["meia-noite e meio", "meia-noite e meia"],
  ["quaisquer que seja", "qualquer que seja"],
  ["qualquer que sejam", ["quaisquer que sejam", "qualquer que seja"]],
  // "cujo" takes no article and agrees with what follows it.
  ["cujo o", "cujo"],
  ["cuja a", "cuja"],
  ["cujos os", "cujos"],
  ["cujas as", "cujas"],
  ["cujo a", "cuja"],
  ["cujo os", "cujos"],
  ["cujo as", "cujas"],
  ["cuja o", "cujo"],
  // "em anexo" does not vary.
  ["em anexos", "em anexo"],
  ["em anexa", "em anexo"],
  ["em anexas", "em anexo"],
  // "melhor" and "pior" before a participle are adverbs: "os mais bem colocados".
  ...[
    "colocad",
    "classificad",
    "qualificad",
    "preparad",
    "avaliad",
    "remunerad",
    "posicionad",
    "equipad",
    "informad",
    "treinad",
    "cotad",
    "conservad",
    "dotad",
    "organizad",
  ].flatMap((stem): PhraseRow[] =>
    ["os", "as"].flatMap((ending): PhraseRow[] => [
      [`melhores ${stem}${ending}`, [`mais bem ${stem}${ending}`, `melhor ${stem}${ending}`]],
      [`piores ${stem}${ending}`, [`mais mal ${stem}${ending}`, `pior ${stem}${ending}`]],
    ]),
  ),
  // "senso" is judgement, "censo" a count of the population.
  ["bom censo", "bom senso"],
  ["censo comum", "senso comum"],
  ["censo crítico", "senso crítico"],
  ["censo de humor", "senso de humor"],
  ["censo de justiça", "senso de justiça"],
  ["censo de responsabilidade", "senso de responsabilidade"],
  ["censo de direção", "senso de direção"],
  ["senso demográfico", "censo demográfico"],
  ["sensos demográficos", "censos demográficos"],
  ["senso populacional", "censo populacional"],
  ["senso escolar", "censo escolar"],
  ["senso do IBGE", "censo do IBGE"],
  // "mandado" is a court order, "mandato" a term of office.
  ...["captura", "prisão", "busca", "segurança", "injunção", "despejo", "penhora"].flatMap(
    (what): PhraseRow[] => [
      [`mandato de ${what}`, `mandado de ${what}`],
      [`mandatos de ${what}`, `mandados de ${what}`],
    ],
  ),
  ["mandato judicial", "mandado judicial"],
  ["mandatos judiciais", "mandados judiciais"],
  ...["parlamentar", "presidencial", "eletivo", "legislativo"].flatMap((kind): PhraseRow[] => [
    [`mandado ${kind}`, `mandato ${kind}`],
  ]),
  ["mandados parlamentares", "mandatos parlamentares"],
  // "ás" is the card or the champion; "às" fuses "a" with "as".
  ["um às", "um ás"],
  ["às na manga", "ás na manga"],
  ["ás vezes", "às vezes"],
  // Shoes are "calçados", clothes "vestidos".
  ...[
    ["vestir", "calçar"],
    ["veste", "calça"],
    ["vestiu", "calçou"],
    ["vesti", "calcei"],
    ["vestia", "calçava"],
    ["vista", "calce"],
  ].flatMap(([dress, shoe]): PhraseRow[] =>
    [
      "os sapatos",
      "o sapato",
      "as meias",
      "os tênis",
      "as botas",
      "as sandálias",
      "os chinelos",
    ].map((item): PhraseRow => [`${dress} ${item}`, `${shoe} ${item}`]),
  ),
  ...[
    ["calçar", "vestir"],
    ["calçou", "vestiu"],
    ["calcei", "vesti"],
  ].flatMap(([shoe, dress]): PhraseRow[] =>
    ["a camisa", "o casaco", "o blusão", "a blusa", "o vestido", "a jaqueta", "o paletó"].map(
      (item): PhraseRow => [`${shoe} ${item}`, `${dress} ${item}`],
    ),
  ),
  // "mais" (more) where "mas" (but) was written, and back.
  ["mas ou menos", "mais ou menos"],
  ["cada vez mas", "cada vez mais"],
  ["sem mas nem menos", "sem mais nem menos"],
  ["nunca mas", "nunca mais"],
  ...["das", "nas", "pelas", "várias", "todas as"].map((word): PhraseRow => [
    `${word} fazes`,
    `${word} fases`,
  ]),
  ...["estrada", "mundo", "vida", "porta", "noite"].map((word): PhraseRow => [
    `${word} a fora`,
    `${word} afora`,
  ]),
  // "aonde" asks where to; being somewhere is "onde".
  ...swap("aonde", "onde", [
    "mora",
    "moras",
    "moram",
    "fica",
    "ficam",
    "está",
    "estão",
    "trabalha",
    "trabalham",
    "vive",
    "vivem",
  ]),
];

/** Optional wording advice for the `pt` style table (stylePhrasing): shorter equivalents. */
/** Infinitive, present (3sg, 3pl), preterite (1sg, 3sg, 3pl) and gerund of a regular verb. */
function regular(infinitive: string): string[] {
  const stem = infinitive.slice(0, -2);
  const ending = infinitive.slice(-2);
  if (ending === "ar")
    return [
      infinitive,
      `${stem}a`,
      `${stem}am`,
      `${stem.replace(/c$/, "qu").replace(/g$/, "gu").replace(/ç$/, "c")}ei`,
      `${stem}ou`,
      `${stem}aram`,
      `${stem}ando`,
    ];
  const vowel = ending[0];
  return [
    infinitive,
    `${stem}e`,
    `${stem}em`,
    `${stem}i`,
    `${stem}${vowel}u`,
    `${stem}${vowel}ram`,
    `${stem}${vowel}ndo`,
  ];
}
/** Each form of `verb` (regular, or a list of forms) followed by `tail` drops the tail. */
const verbTail = (verb: string | string[], tails: string[]): PhraseRow[] =>
  (typeof verb === "string" ? regular(verb) : verb).flatMap((form) =>
    tails.map((tail): PhraseRow => [`${form} ${tail}`, form]),
  );
/**
 * Pleonasms: the second part says again what the first already does ("recuar para trás",
 * "hemorragia de sangue"). Opt-in wording advice (stylePhrasing).
 */
const PLEONASMS: PhraseRow[] = [
  ...verbTail("recuar", ["para trás"]),
  ...verbTail("retornar", ["de novo", "novamente"]),
  ...verbTail("recomeçar", ["de novo", "novamente"]),
  ...verbTail("reiniciar", ["de novo", "novamente"]),
  ...verbTail("reconsiderar", ["de novo", "novamente"]),
  ...verbTail("repetir", ["de novo", "novamente"]),
  ...verbTail(
    ["refazer", "refaz", "refazem", "refiz", "refez", "refizeram", "refazendo"],
    ["de novo", "novamente"],
  ),
  ...verbTail(
    ["reler", "relê", "releem", "reli", "releu", "releram", "relendo"],
    ["de novo", "novamente"],
  ),
  ...verbTail("adiar", ["para depois", "para mais tarde"]),
  ...verbTail("prevenir", ["antes", "de antemão"]),
  ...verbTail(
    ["prever", "prevê", "preveem", "previ", "previu", "previram", "prevendo"],
    ["antes", "de antemão", "antecipadamente"],
  ),
  ...verbTail("preparar", ["de antemão"]),
  ...verbTail("planejar", ["com antecedência"]),
  ...verbTail("planear", ["antecipadamente", "com antecedência"]),
  ...verbTail("enfrentar", ["de frente"]),
  ...verbTail("anexar", ["junto"]),
  ...verbTail("introduzir", ["dentro"]),
  ...verbTail("pisar", ["com os pés"]),
  ...verbTail("cheirar", ["com o nariz"]),
  ...verbTail("lamber", ["com a língua"]),
  ...verbTail("morder", ["com os dentes"]),
  ...verbTail("decapitar", ["a cabeça"]),
  ...verbTail("degolar", ["a cabeça", "o pescoço"]),
  ...verbTail("arder", ["em chamas"]),
  ...verbTail("ganhar", ["de graça"]),
  ...verbTail("exultar", ["de alegria"]),
  ...verbTail("projetar", ["para o futuro"]),
  ...verbTail("avançar", ["para a frente", "para frente"]),
  ...verbTail("estrear", ["pela primeira vez"]),
  ...verbTail(["estreia", "estreiam"], ["pela primeira vez"]),
  // A noun with a modifier that only repeats it.
  ...([
    ["hemorragia de sangue", "hemorragia"],
    ["multidão de gente", "multidão"],
    ["inesperada surpresa", "surpresa"],
    ["conclusão final", "conclusão"],
    ["abertura inaugural", "abertura"],
    ["erário público", "erário"],
    ["panorama geral", "panorama"],
    ["detalhes minuciosos", "detalhes"],
    ["unanimidade de todos", "unanimidade"],
    ["unânime de todos", "unânime"],
    ["fato verídico", "fato"],
    ["facto verídico", "facto"],
    ["facto real", "facto"],
    ["metades iguais", "metades"],
    ["cardume de peixes", "cardume"],
    ["enxame de abelhas", "enxame"],
    ["goteira no teto", "goteira"],
    ["goteiras no teto", "goteiras"],
    ["almirante da marinha", "almirante"],
    ["general do exército", "general"],
    ["viúva do falecido", "viúva"],
    ["viúva da falecida", "viúva"],
    ["sorriso nos lábios", "sorriso"],
    ["superávit positivo", "superávit"],
    ["déficit negativo", "déficit"],
    ["cego dos olhos", "cego"],
    ["surdo dos ouvidos", "surdo"],
    ["própria autobiografia", "autobiografia"],
    ["plebiscito popular", "plebiscito"],
    ["escolha opcional", "escolha"],
    ["monocultura exclusiva", "monocultura"],
    ["demente mental", "demente"],
    ["defunto morto", "defunto"],
    ["segredo secreto", "segredo"],
    ["possivelmente poderá", "poderá"],
    ["possivelmente poderia", "poderia"],
    ["amanhecer do dia", "amanhecer"],
  ] as PhraseRow[]),
];

const STYLE: PhraseRow[] = [
  ["subir para cima", "subir"],
  ["descer para baixo", "descer"],
  ["entrar para dentro", "entrar"],
  ["sair para fora", "sair"],
  ["elo de ligação", "elo"],
  ["encarar de frente", "encarar"],
  ["há anos atrás", ["há anos", "anos atrás"]],
  ...["considerado", "considerada", "considerados", "consideradas"].flatMap((form): PhraseRow[] => [
    [`${form} como sendo`, form],
    [`${form} como`, form],
  ]),
  ["fazer uso de", ["usar", "recorrer a"]],
  ["fazer uso do", ["usar o", "recorrer ao"]],
  ["fazer uso da", ["usar a", "recorrer à"]],
  ["fazer uso dos", ["usar os", "recorrer aos"]],
  ["fazer uso das", ["usar as", "recorrer às"]],
  ["tomar uma decisão", "decidir"],
  ["tomou uma decisão", "decidiu"],
  ["tomamos uma decisão", "decidimos"],
  ["fazer uma suposição", "supor"],
  ["fazer uma aquisição", "adquirir"],
  ["fazer referência a", "referir-se a"],
  ["faz referência a", "refere-se a"],
  ["ter a capacidade de", ["conseguir", "poder"]],
  ["tem a capacidade de", ["consegue", "pode"]],
  ["estar em posição de", "poder"],
  ["dar uma indicação de", "indicar"],
  ["ter um efeito sobre", ["afetar", "influenciar"]],
  ["levar em consideração", "considerar"],
  ["eliminar completamente", "eliminar"],
  ["eliminar totalmente", "eliminar"],
  ["desaparecer da vista", "desaparecer"],
  ["testemunhar em primeira mão", "testemunhar"],
  ["como forma de", ["para", "como meio de"]],
  ["de forma a que", "para que"],
  ["de modo a que", "para que"],
  ["durante o curso de", "durante"],
  ["para efeitos de", "para"],
  ["em virtude de", ["por", "devido a"]],
  ["no dia de hoje", "hoje"],
  ["o dia de hoje", "hoje"],
  ["nos dias de hoje", ["hoje", "atualmente"]],
  ["torna as coisas melhores", "melhora as coisas"],
  ["torna as coisas piores", "piora as coisas"],
  ["tornou a situação melhor", "melhorou a situação"],
  ["tornou a situação pior", "piorou a situação"],
  ["duas vezes mais", "o dobro"],
  ["três vezes mais", "o triplo"],
  ["a grande maioria", "a maioria"],
  ["planejar antecipadamente", "planejar"],
  ["voltar atrás", "voltar"],
  ["surpresa inesperada", "surpresa"],
  ["acabamento final", "acabamento"],
  ["certeza absoluta", "certeza"],
  ["consenso geral", "consenso"],
  ["monopólio exclusivo", "monopólio"],
  ["fato real", "fato"],
  ["outra alternativa", "alternativa"],
  ["empréstimo temporário", "empréstimo"],
  ["ganhar grátis", "ganhar"],
  // Spoken contractions in formal writing.
  ["pra", ["para", "para a"]],
  ["pras", "para as"],
  ["pros", "para os"],
  ["tô", "estou"],
  ["né", "não é"],
  ["conviver junto", "conviver"],
  // "a nível de" is a calque; "em nível de" for a level, otherwise "quanto a" or "em".
  ["a nível de", ["em nível de", "quanto a"]],
  ["a nível do", ["em nível do", "quanto ao"]],
  ["a nível da", ["em nível da", "quanto à"]],
  ["a nível dos", ["em nível dos", "quanto aos"]],
  ["a nível das", ["em nível das", "quanto às"]],
  // A verb hidden in a noun: "fazer uma análise de" -> "analisar".
  ["levar em conta", "considerar"],
  ["leva em conta", "considera"],
  ["levou em conta", "considerou"],
  ["fazer uma análise de", "analisar"],
  ["fez uma análise de", "analisou"],
  ["realizar uma análise de", "analisar"],
  ["fazer uma visita a", "visitar"],
  ["fazer a entrega de", "entregar"],
  ["efetuar o pagamento de", "pagar"],
  ["efetuar o pagamento", "pagar"],
  ["realizar o pagamento", "pagar"],
  ["efetuar a compra de", "comprar"],
  ["fazer a limpeza de", "limpar"],
  ["dar uma resposta", "responder"],
  ["deu uma resposta", "respondeu"],
  ["fazer contato com", "contatar"],
  ["fazer contacto com", "contactar"],
  ["no presente momento", "agora"],
  ["neste exato momento", "agora"],
  ["no atual momento", "agora"],
  ["com o objetivo de", "para"],
  ["com a finalidade de", "para"],
  ["apesar do fato de que", "embora"],
  ["devido ao fato de que", "porque"],
  ["em função do fato de que", "porque"],
  // English verbs dressed as Portuguese, and loanwords with a Portuguese twin.
  ["deletar", "apagar"],
  ["deletou", "apagou"],
  ["deletado", "apagado"],
  ["deletada", "apagada"],
  ["startar", "iniciar"],
  ["startou", "iniciou"],
  ["deadline", "prazo"],
  ["budget", "orçamento"],
  ["meeting", "reunião"],
  ...PLEONASMS,
  // Chat shorthand in running prose. Two-letter forms that are also symbols or units
  // (TB, Tb, abs) stay out.
  ["vc", "você"],
  ["vcs", "vocês"],
  ["hj", "hoje"],
  ["tbm", "também"],
  ["blz", "beleza"],
  ["msg", "mensagem"],
  ["msgs", "mensagens"],
  ["qnd", "quando"],
  ["qdo", "quando"],
  ["pfv", "por favor"],
  ["pfvr", "por favor"],
  ["bjs", "beijos"],
  ["bjo", "beijo"],
  ["bjos", "beijos"],
  ["qm", "quem"],
  ["cmg", "comigo"],
  ["ctg", "contigo"],
  ["mto", "muito"],
  ["mta", "muita"],
  ["mtos", "muitos"],
  ["mtas", "muitas"],
  ["vdd", "verdade"],
  ["dps", "depois"],
  ["agr", "agora"],
  ["obg", ["obrigado", "obrigada"]],
  ["pq", ["porque", "por que", "por quê"]],
];

const listed = new Set(
  [...PORTUGUESE_WORDS, ...PORTUGUESE_PHRASES, ...STYLE].flatMap(([typed]) =>
    [typed].flat().map((form) => form.toLowerCase()),
  ),
);
/** Optional wording advice for the `pt` style table (stylePhrasing). */
export const PORTUGUESE_STYLE: PhraseRow[] = [
  ...STYLE,
  ...PORTUGUESE_STYLE_EXTRA.filter(([typed]) => !listed.has([typed].flat()[0].toLowerCase())),
];
