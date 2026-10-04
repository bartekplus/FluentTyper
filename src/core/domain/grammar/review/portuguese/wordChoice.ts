import { SPACE as S, WORD_END as W } from "../phraseTemplates";
import type { Frame } from "./confusions";

/**
 * Words that look or sound like the word the frame needs: a knife is sharpened (afiar), not
 * made ugly (afear); medicine is taken (tomar), not eaten; advice is a "conselho", a council
 * area a "concelho". Each frame names the words that select the meaning.
 */

const DET = `(?:(?:[oa]s?|um|uma|uns|umas|meus?|minhas?|seus?|suas?|nossos?|nossas?|esses?|essas?|estes?|estas?)${S}){0,2}`;
/** Swaps the stem `from` of the typed word for `to`: "afeou" -> "afiou". */
const restem = (from: string, to: string) => (typed: string) => [
  typed.replace(new RegExp(`^${from}`, "iu"), to),
];
const table = (map: Record<string, string>) => (typed: string) => [map[typed.toLowerCase()]];

const EAT_TO_TAKE: Record<string, string> = {
  comer: "tomar",
  como: "tomo",
  come: "toma",
  comemos: "tomamos",
  comem: "tomam",
  comi: "tomei",
  comeu: "tomou",
  comeram: "tomaram",
  comia: "tomava",
  comiam: "tomavam",
  comendo: "tomando",
  comido: "tomado",
};
const TAKE_PLACE: Record<string, string> = {
  toma: "tem",
  tomam: "têm",
  tomou: "teve",
  tomaram: "tiveram",
  tomará: "terá",
  tomarão: "terão",
  tomaria: "teria",
  tomariam: "teriam",
  tomava: "tinha",
  tomavam: "tinham",
  tomasse: "tivesse",
  tomassem: "tivessem",
};
const HAD_TO: Record<string, string> = {
  estive: "tive",
  esteve: "teve",
  estivemos: "tivemos",
  estiveram: "tiveram",
};
// Nouns in -r after "estar de": "estar de azar", "estar de mau humor".
const NOT_INFINITIVE =
  "azar|mar|lugar|par|bar|amor|calor|favor|humor|cor|dor|pior|melhor|maior|menor";
const EVENT =
  "eventos?|reuni(?:ão|ões)|encontros?|cerimônias?|festas?|conferências?|congressos?|jogos?|partidas?|shows?|concertos?|casamentos?|julgamentos?|eleiç(?:ão|ões)|votaç(?:ão|ões)|debates?|exposiç(?:ão|ões)|feiras?|competiç(?:ão|ões)|torneios?|batalhas?|ataques?|acidentes?";
const PLACE_NEXT =
  "em|no|na|nos|nas|entre|durante|amanhã|hoje|ontem|às|neste|nesta|nesse|nessa|naquele|naquela";
const GIVE_ADVICE =
  "pedir|peço|pede|pedem|pediu|pedi|pediram|dar|dou|dá|dão|deu|dei|deram|seguir|sigo|segue|seguem|seguiu|segui|ouvir|ouço|ouve|ouviu|ouvi|aceitar|aceito|aceita|aceitou|aceitei";
const ASSIST =
  "assistir|assisto|assiste|assistimos|assistem|assisti|assistiu|assistiram|assistia|assistiam";
const GO = "vou|vai|vamos|vão|fui|foi|fomos|foram|ir|ia|iam";
const SHOW =
  "arte|artes|cinema|filmes|fotografia|fotografias|teatro|dança|design|pintura|escultura";
const LOSS =
  "\\d|tempo|dinheiro|energia|peso|sangue|memória|vidas?|receitas?|produção|calor|carga|água|dados|qualidade|valor|empregos?|clientes";

export const WORD_CHOICE_FRAMES: Frame[] = [
  // "afear a faca" (make ugly) -> "afiar" (sharpen).
  {
    pattern: `(?<target>afe(?:ar|ia|iam|ei|ou|aram|ando|ado|ados|ada|adas))${S}${DET}(?:facas?|facões|facão|lâminas?|tesouras?|machados?|navalhas?|serrotes?|foices?|enxadas?|serras?)${W}`,
    alternatives: restem("afe", "afi"),
    messageKey: "review_msg_pt_homophone",
  },
  // "arrear a bandeira" (harness) -> "arriar" (lower).
  {
    pattern: `(?<target>arre(?:ar|ia|iam|ei|ou|aram|ando|ado|ados|ada|adas))${S}${DET}(?:velas?|bandeiras?|âncoras?|calças)${W}`,
    alternatives: restem("arre", "arri"),
    messageKey: "review_msg_pt_homophone",
  },
  // "comer os remédios" -> "tomar": medicine is taken.
  {
    pattern: `(?<target>${Object.keys(EAT_TO_TAKE).join("|")})${S}${DET}(?:remédios?|medicamentos?|comprimidos?|pílulas?|antibióticos?|cápsulas?|analgésicos?|calmantes?)${W}`,
    alternatives: table(EAT_TO_TAKE),
    messageKey: "review_msg_pt_word_choice",
  },
  // "O evento tomará lugar em" -> "terá lugar": an event takes place with "ter lugar"; a
  // person "toma lugar" (takes a seat).
  {
    pattern: `(?<!(?:d[eoa]s?|n[oa]s?|aos?|às?|pel[oa]s?|para|com|sem)${S})(?:${EVENT})${W}(?:${S}(?!(?:d[eoa]s?|com|para|por|que|e)${W})[\\p{L}-]+){0,3}?${S}(?<target>${Object.keys(TAKE_PLACE).join("|")})${S}lugar${S}(?=(?:${PLACE_NEXT})${W})`,
    alternatives: table(TAKE_PLACE),
    messageKey: "review_msg_pt_word_choice",
  },
  // "pedir um concelho" -> "conselho": a "concelho" is a council area.
  {
    pattern: `(?:${GIVE_ADVICE})${S}${DET}(?:(?:bons?|bom|algum|alguns|outro|outros)${S})?(?<target>concelhos?)${W}`,
    alternatives: (typed) => [typed.replace(/nc/i, "ns")],
    messageKey: "review_msg_pt_homophone",
  },
  // "assistir a um conserto", "vou a um conserto" -> "concerto": a "conserto" is a repair
  // ("levou o carro ao conserto").
  {
    pattern: `(?:${ASSIST}${S}(?:(?:a|ao|aos)${S})?(?:(?:um|uns|o|os|esse|este|aquele)${S})?|(?:${GO})${S}a${S}(?:um|uns)${S})(?<target>consertos?)${W}(?!${S}(?:d[eoa]s?|no|na)${S}(?!(?:rock|jazz|música|orquestra|banda|samba|forró|pagode)${W}))`,
    alternatives: (typed) => [typed.replace(/ns/i, "nc")],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?<target>consertos?)${S}(?=(?:de${S}(?:rock|jazz|música|samba|forró|pagode)|da${S}(?:orquestra|banda)|sinfônicos?|ao${S}vivo)${W})`,
    alternatives: (typed) => [typed.replace(/ns/i, "nc")],
    messageKey: "review_msg_pt_homophone",
  },
  // "a amostra de arte" -> "mostra": an exhibition is a "mostra"; an "amostra" is a sample.
  {
    pattern: `(?<target>amostras?)${S}(?=(?:de|d[eoa]s?)${S}(?:${SHOW})${W})`,
    alternatives: (typed) => [typed.slice(1)],
    messageKey: "review_msg_pt_word_choice",
  },
  // "contanto com" -> "contando com": "contanto" only opens "contanto que".
  {
    pattern: `(?<target>contanto)${S}(?=com${W})`,
    alternatives: ["contando"],
    messageKey: "review_msg_pt_homophone",
  },
  // "estivemos de sair" -> "tivemos de sair": obligation is "ter de".
  {
    pattern: `(?<target>${Object.keys(HAD_TO).join("|")})${S}de${S}(?!(?:${NOT_INFINITIVE})${W})(?=\\p{L}{2,}[aeiô]r${W})`,
    alternatives: table(HAD_TO),
    messageKey: "review_msg_pt_word_choice",
  },
  // "tenho muito a preço por ele" -> "apreço" (esteem).
  {
    pattern: `(?:muito|grande|enorme|profundo|especial|imenso|sincero|meu|nosso|seu|todo${S}o)${S}(?<target>a${S}preço)${S}(?=(?:por|pel[oa]s?|a|ao|à)${W})`,
    alternatives: ["apreço"],
    messageKey: "review_msg_pt_homophone",
  },
  // "o mas rapidamente possível" -> "o mais".
  {
    pattern: `(?<![\\p{L}])o${S}(?<target>mas)${S}(?=\\p{L}+${S}possíve(?:l|is)${W})`,
    alternatives: ["mais"],
    messageKey: "review_msg_pt_homophone",
  },
  // "teve percas de 5%" -> "perdas": "perca" is the fish or a form of "perder".
  {
    pattern: `(?<target>percas?)${S}(?=(?:de|d[eoa]s?)${S}(?:${LOSS})${W})`,
    alternatives: (typed) => [typed.replace(/c/i, "d")],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?:grandes|pequenas|muitas|enormes|várias|evitar|reduzir|sofreu|sofrer|sofreram|houve|haverá)${S}(?:as${S})?(?<target>percas)${W}`,
    alternatives: ["perdas"],
    messageKey: "review_msg_pt_homophone",
  },
  // "O Rui trás o material" -> "traz": "trás" (behind) follows "para", "de", "por" or "lá".
  {
    pattern: `(?<!(?:para|pra|de|por|lá|cá|em|daí|dali|aí|ali|e|é|marcha|ré|frente|atrás)${S})(?<target>trás)${S}(?=(?:o|a|os|as|um|uma|uns|umas|seu|sua|seus|suas|meu|minha|consigo|muitos|muitas|isso|isto|tudo|sempre|novidades)${W})`,
    alternatives: ["traz"],
    messageKey: "review_msg_pt_homophone",
  },
  // "o último senso" -> "censo": a count, not a sense of something.
  {
    pattern: `(?:último|próximo|penúltimo|novo|primeiro)${S}(?<target>sensos?)${W}(?!${S}(?:de|comum|crítico|estético|moral|prático|ético|artístico)${W})`,
    alternatives: (typed) => [typed.replace(/^s/i, "c")],
    messageKey: "review_msg_pt_homophone",
  },
  // "não te peco nada" -> "peço": "pecar" (to sin) takes no object pronoun.
  {
    pattern: `(?:te|lhe|lhes|vos)${S}(?<target>peco)${W}`,
    alternatives: ["peço"],
    messageKey: "review_msg_pt_homophone",
  },
  // "vai a bordo" written as the verb "abordo": on board a ship or a plane.
  {
    pattern: `(?<target>abordo)${S}(?=(?:d[oa]s?)${S}(?:\\p{L}+${S})?(?:navios?|aviões|avião|fragatas?|barcos?|naves?|aeronaves?|embarcaç(?:ão|ões)|trens?|cruzeiros?|iates?|submarinos?|helicópteros?|ônibus|veleiros?|lanchas?|caravelas?)${W})`,
    alternatives: ["a bordo"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Se caso eles vierem" -> "Caso": "se" and "caso" both open the condition.
  {
    pattern: `(?<target>se${S}caso)${S}(?=(?:ele|ela|eles|elas|você|vocês|nós|não|haja|seja|sejam|tenha|tenham|queira|queiram|precise|precisem|ocorra|aconteça)${W})`,
    alternatives: ["caso"],
    messageKey: "review_msg_contextual_grammar",
  },
  // "pão, leite e etc." -> "pão, leite, etc.": "etc." already says "and the rest".
  {
    pattern: `\\p{L}+(?<target>,?${S}e${S}etc)(?=\\.|…|${W})`,
    alternatives: [", etc"],
    messageKey: "review_msg_contextual_grammar",
  },
  // "e.t.c." -> "etc.".
  {
    pattern: `(?<target>e\\.(?:${S})?t\\.(?:${S})?c\\.)`,
    alternatives: ["etc."],
    messageKey: "review_msg_contextual_grammar",
  },
  // "Mas o que?", "Para que?": "que" at the end of a question is stressed: "quê".
  {
    pattern: `(?<![\\p{L}])(?:o|para|pra|de|com|sem|em)${S}(?<target>que)(?=[ \\t\\u00a0]{0,2}[?])`,
    alternatives: ["quê"],
    messageKey: "review_msg_pt_homophone",
  },
];
