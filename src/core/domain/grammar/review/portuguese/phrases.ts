import type { PhraseRow } from "../englishPhraseTables";

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

export const PORTUGUESE_PHRASES: PhraseRow[] = [
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
    "nível de",
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
  ["a traves", "através"],
  ["em case de", "em caso de"],
  // The participle of "chegar" is "chegado".
  ...["tinha", "tinham", "tenho", "tem", "havia"].map((verb): PhraseRow => [
    `${verb} chego`,
    `${verb} chegado`,
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
