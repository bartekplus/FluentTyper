import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import {
  frameMatches,
  isLang,
  SPACE,
  SPACE as S,
  WORD_END,
  WORD_END as W,
} from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { ReviewMessageKey } from "../types";
import { analyze } from "./nounAgreement";
import { WORD_CHOICE_FRAMES } from "./wordChoice";

/**
 * Portuguese words that sound alike or differ by one accent, told apart by the
 * words around them: crase (à/a/há), por que/porque/por quê/porquê, é/e,
 * está/esta, dá/da, dê/de, houve/ouve, pôr/por. Every frame names its evidence.
 */

export type Frame = {
  /** Compiled by frameMatches (WORD_START, `gidu`); `target` is replaced. */
  pattern: string;
  /** Replacements, or a function of the typed target. */
  alternatives: string[] | ((typed: string) => string[]);
  messageKey: ReviewMessageKey;
  /** Starts a sentence (or follows a line break). */
  clauseStart?: true;
  /** The target is typed with a capital: frames match ignoring case. */
  capitalized?: true;
};

const words = (list: string) => `(?:${list})${W}`;

// Infinitives look like these nouns and adjectives, which can follow a crase ("à mulher").
const FEMININE_R = new Set(
  "mulher colher militar titular auxiliar familiar circular similar celular escolar popular particular exemplar singular regular preliminar complementar lunar solar polar nuclear secular vulgar peculiar hospitalar curricular disciplinar".split(
    " ",
  ),
);
const SPAN = words("anos|meses|semanas|dias|séculos|décadas|minutos|segundos");
const AMOUNT = `(?:(?:quase|aproximadamente|uns|umas|alguns|algumas|muitos|muitas|poucos|poucas|vários|várias|cerca${S}de|mais${S}de|menos${S}de|\\d+|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta|cem)${W}${S})`;
const WEEKDAY = "(?:segunda|terça|quarta|quinta|sexta)(?:-feira)?|sábado|domingo";
const MONTH =
  "janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";
const CLITIC = "(?:me|te|lhe|lhes)";
const CLOCK_WORDS = `(?:duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte(?:${S}e${S}(?:uma|duas|três))?)`;
const SUBJECT =
  "(?:ele|ela|você|eles|elas|vocês|isso|isto|tudo|não|nunca|já|ainda|quem|onde|como|ninguém|alguém|também|sempre|assim)";
// Plural subjects; after a preposition ("para eles tem sido") they are no subject.
const PLURAL_SUBJECT =
  "(?<!(?:de|para|com|sem|entre|a|por|sobre|contra|até|em|perante)[ \\t\\u00a0]{1,8})(?:eles|elas|vocês|uns|ambos|ambas|todos|todas|muitos|muitas|alguns|algumas|poucos|poucas)";
const SUBJECT_ADVERB = `(?:(?:não|já|também|ainda|nunca|sempre|só|apenas|realmente)${WORD_END}${SPACE}){0,2}`;
// "tem/vem" and their compounds take a circumflex in the plural: têm, vêm, contêm, intervêm.
const TER_VIR =
  "(?:con|de|man|ob|re|abs|sus|en|entre)?t[eé]m|(?:con|pro|inter|ad|sobre|pro)?v[eé]m";
const INFINITIVE_AHEAD = `\\p{L}*[aeiô]r(?:em|mos|es)?${WORD_END}`;
const IMPERSONAL: Record<string, string> = {
  fazem: "faz",
  faziam: "fazia",
  fizeram: "fez",
  farão: "fará",
  fariam: "faria",
  vão: "vai",
  iam: "ia",
  irão: "irá",
  podem: "pode",
  deviam: "devia",
  devem: "deve",
  costumam: "costuma",
};
const SPAN_NOUN = `(?:anos|meses|semanas|dias|horas|minutos|séculos|décadas|tempo|bastante${SPACE}tempo|muito${SPACE}tempo)`;
const MODAL =
  "(?:pode|posso|podemos|podem|podia|quero|queremos|quer|queria|deve|devemos|devem|deveria|preciso|precisamos|precisa|precisam|para|sem|(?:tenho|temos|tem|têm|tens|tinha|tinham)" +
  `${S}(?:que|de)|(?:há|hei)${S}de)`;
const OCCURRENCE =
  "(?:problemas?|erros?|necessidade|mudanças?|complicaç(?:ão|ões)|aumento|alteraç(?:ão|ões)|falhas?|acidentes?|tempo|motivos?|casos?|vítimas|mortos|feridos|reclamaç(?:ão|ões)|atrasos?|dificuldades?|confusão|chance)";
const OCCURRENCE_MODIFIER =
  "(?:algum|alguma|alguns|algumas|nenhum|nenhuma|muitos|muitas|vários|várias|um|uma|novos|novas|outros|outras|sérios|sérias|graves|pequenos|pequenas|grandes|poucos|poucas|tantos|tantas|\\d+|dois|duas|três|trinta)";
const IS_ADJECTIVE =
  "(?:melhor|pior|possível|impossível|verdade|necessário|necessária|preciso|fácil|difícil|bom|boa|certo|errado|claro|importante|normal|obrigatório)";
const STATE =
  "(?:bem|mal|certo|certa|errado|errada|pronto|pronta|ótimo|ótima|cheio|cheia|cansado|cansada|feliz|triste|doente|ocupado|ocupada|com|sem|em|no|na|nos|nas|muito|tão|sendo|quase|perto|longe|frio|quente|melhor|pior|confus[oa]s?|\\p{L}{3,}(?:ad|id)[oa]s?)";

const NUMBER_WORD = `(?:\\d+|uns|umas|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|cem|duzentos|duzentas|trezentos|quinhentos|mil|meia|mei[oa]${S}hora)`;
const HAVER_SINGULAR: Record<string, string> = {
  haviam: "havia",
  haverão: "haverá",
  haveriam: "haveria",
  houvessem: "houvesse",
  houverem: "houver",
  hajam: "haja",
  haverem: "haver",
};
// Long participle stem -> short participle stem (gender and number follow).
const SHORT_PARTICIPLE: Record<string, string> = {
  gast: "gast",
  pag: "pag",
  ganh: "ganh",
  aceit: "aceit",
  eleg: "eleit",
  prend: "pres",
  acend: "aces",
  suspend: "suspens",
  expuls: "expuls",
  imprim: "impress",
  limp: "limp",
  salv: "salv",
  solt: "solt",
  morr: "mort",
  benz: "bent",
  enxug: "enxut",
  extingu: "extint",
};
/** "gastadas" -> "gastas", "imprimido" -> "impresso". */
function shortParticiple(long: string): string {
  const m = /^(\p{Ll}+?)[ai]d([oa]s?)$/u.exec(long)!;
  return `${SHORT_PARTICIPLE[m[1]]}${m[2]}`;
}

// "a" fused with the article that follows it.
const WITH_A: Record<string, string> = { o: "ao", a: "à", os: "aos", as: "às" };
const SHOWS =
  "filmes?|jogos?|programas?|shows?|espetáculos?|aulas?|novelas?|séries?|vídeos?|partidas?|apresentaç(?:ão|ões)|peças?|concertos?|palestras?|missas?|desfiles?|televisão|tv|telejornal|final|finais|corrida|luta|treino|ensaio";
// After these "a" is the bare preposition ("assistir a uma aula", "obedecer a
// leis"), or the crase is optional ("obedecer a sua mãe"); "o" and "os" are always the article.
const NOT_ARTICLE_NEXT =
  "(?!\\p{L}+s(?![\\p{L}]))(?!(?:um|uma|uns|umas|est[ea]s?|ess[ea]s?|aquel[ea]s?|tod[oa]s?|cada|qualquer|nenhum|nenhuma|cert[oa]s?|vári[oa]s|muit[oa]s?|pouc[oa]s?|dois|duas|três|seus?|suas?|meus?|minhas?|teus?|tuas?|nossos?|nossas?)(?![\\p{L}]))";
const ASSISTIR =
  "assist(?:o|e|es|imos|em|i|iu|iram|ia|iam|ir|indo|irei|irá|iremos|irão|iria|iriam|a|am)";
const OBEDECER =
  "(?:des)?obedec(?:e|em|emos|i|eu|eram|ia|iam|er|endo|erei|erá|eremos|erão|eria|eriam)|(?:des)?obedeço|(?:des)?obedeça|(?:des)?obedeçam";
const PREFERIR =
  "prefiro|prefere|preferes|preferimos|preferem|preferia|preferiam|preferiria|preferiríamos|preferi|preferiu|preferiram|preferir|preferível";

// Places one goes to: "vou a escola" -> "à escola". "foi" and "fui" also mean "was".
const GOES = "vou|vais|vai|vamos|vão|ia|iam|irei|irás|irá|iremos|irão|iria|iríamos|iriam|ir|indo";
const DESTINATIONS =
  "escola|praia|festa|igreja|missa|feira|academia|farmácia|padaria|faculdade|universidade|reunião|aula|piscina|fazenda|praça|loja|biblioteca|delegacia|prefeitura|cidade|capital|cozinha|sala|janela|rodoviária|lavanderia|oficina|creche|cerimônia|consulta|sessão|exposição";
// "Como está indo na escola?" asks how it is going there.
const GOES_NOT_INDO = GOES.replace("|indo", "");
const MALE_DESTINATIONS =
  "cinema|teatro|shopping|mercado|supermercado|médico|dentista|banco|hospital|parque|clube|estádio|restaurante|escritório|museu|zoológico|show|jogo|aeroporto|centro|correio|cartório";
const MODAL_SINGULAR: Record<string, string> = {
  devem: "deve",
  deviam: "devia",
  deveriam: "deveria",
  deverão: "deverá",
  podem: "pode",
  podiam: "podia",
  poderiam: "poderia",
  poderão: "poderá",
  vão: "vai",
  iam: "ia",
  irão: "irá",
  costumam: "costuma",
  começam: "começa",
  continuam: "continua",
};

// Verb forms typed for the noun that sounds the same: after a determiner only the noun fits.
const NOUN_TWIN: Record<string, string> = {
  viajem: "viagem",
  viajens: "viagens",
  extirpe: "estirpe",
  extirpes: "estirpes",
  profetiza: "profetisa",
  profetizas: "profetisas",
  poetiza: "poetisa",
  poetizas: "poetisas",
  sinto: "cinto",
  sintos: "cintos",
  sinta: "cinta",
  sintas: "cintas",
  asso: "aço",
  assos: "aços",
  cerra: "serra",
  cerras: "serras",
};
// Prepositions and determiners never come right before a finite verb; bare o/a/os/as could
// be its object pronoun, so they count only where a sentence opens.
const NOUN_LEAD =
  "(?:de|em|com|sem|um|uma|uns|umas|d[oa]s?|n[oa]|nas|pel[oa]s?|num|numa|dum|duma|est[ae]s?|ess[ae]s?|sua|suas|seu|seus|minha|minhas|meu|meus|nossa|nossas|nosso|nossos|cada|outra|outras|outro|outros|toda|longa|longas|nova|novas|boa|boas|primeira|última)";
const NOUN_TWINS = Object.keys(NOUN_TWIN).join("|");

// Verbs and adverbs after "a gente" ("we"), which no noun "agente" takes bare.
const AGENTE_VERB = words(
  "vai|vamos|foi|fomos|pode|podia|tem|tinha|está|estava|fica|ficou|sabe|sabia|quer|queria|precisa|gosta|faz|fez|vê|viu|se|nunca|sempre|não|já|ainda|só",
);

const FRAMES: Frame[] = [
  // "uma viajem longa" -> "viagem", "do asso" -> "aço".
  {
    pattern: `${NOUN_LEAD}${S}(?<target>${NOUN_TWINS})${W}(?!-)`,
    alternatives: (typed) => [NOUN_TWIN[typed.toLowerCase()]],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?<![\\p{L}][ \\t\\u00a0]{0,8})[oa]s?${S}(?<target>${NOUN_TWINS})${W}(?!-)`,
    alternatives: (typed) => [NOUN_TWIN[typed.toLowerCase()]],
    messageKey: "review_msg_pt_homophone",
    clauseStart: true,
  },
  // "que eles viagem" -> "viajem", "Não viagem sem seguro": the subjunctive is spelled with j.
  {
    pattern: `(?:(?:que|embora|caso)${S}(?:eles|elas|vocês)|(?<!uma${S})não)${S}(?<target>viagem)${W}(?!${S}(?:é|foi|era|será)${W})`,
    alternatives: ["viajem"],
    messageKey: "review_msg_pt_homophone",
  },
  // "assistir ao filme" (to watch); "assistir o paciente" (to help) keeps its object.
  {
    pattern: `${ASSISTIR}${S}(?<target>os?|as?(?=${S}${NOT_ARTICLE_NEXT}))${S}(?=(?:\\p{L}+${S})?(?:${SHOWS})${W})`,
    alternatives: (typed) => [WITH_A[typed.toLowerCase()]],
    messageKey: "review_msg_pt_regency",
  },
  // "obedecer aos pais", "desobedecer à lei".
  {
    pattern: `(?:${OBEDECER})${S}(?<target>os?|as?(?=${S}${NOT_ARTICLE_NEXT}))${S}(?=\\p{L}{2,})`,
    alternatives: (typed) => [WITH_A[typed.toLowerCase()]],
    messageKey: "review_msg_pt_regency",
  },
  // "prefiro chá a café", not "do que café".
  {
    pattern: `(?:${PREFERIR})${S}(?:[^\\s.,;:!?]+${S}){1,5}(?<!(?:mais|menos|melhor|pior|maior|menor|antes|tanto)${S})(?<target>do${S}que(?:${S}(?:o|a|os|as)(?=${S}))?)${W}`,
    alternatives: (typed) => {
      const article = /\s(o|a|os|as)$/i.exec(typed)?.[1].toLowerCase();
      return [article ? WITH_A[article] : "a"];
    },
    messageKey: "review_msg_pt_regency",
  },
  // "eles tem" -> "eles têm", "elas contém" -> "elas contêm".
  {
    pattern: `${PLURAL_SUBJECT}${SPACE}${SUBJECT_ADVERB}(?<target>${TER_VIR})${W}`,
    alternatives: (typed) => [typed.replace(/[eé]m$/i, "êm")],
    messageKey: "review_msg_pt_homophone",
  },
  // "Faz dez anos que", "fazia meses que": "fazer" for elapsed time has no subject.
  {
    pattern: `(?<target>fazem|faziam|fizeram|farão|fariam)${S}${AMOUNT}?${SPAN_NOUN}${S}(?:que|desde)${W}`,
    alternatives: (typed) => [IMPERSONAL[typed.toLowerCase()]],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?<target>vão|iam|irão|podem|deviam|devem|costumam)${S}fazer${S}${AMOUNT}?${SPAN_NOUN}${S}(?:que|desde)${W}`,
    alternatives: (typed) => [IMPERSONAL[typed.toLowerCase()]],
    messageKey: "review_msg_pt_homophone",
  },
  // "está noite" -> "esta noite": the demonstrative before a part of the day.
  {
    pattern: `(?<!(?:já|ainda|lá|aqui|fora)${S})(?<target>está)${S}(?=(?:noite|semana|manhã|tarde|madrugada)${W})`,
    alternatives: ["esta"],
    messageKey: "review_msg_pt_homophone",
  },
  // "esta" before a masculine participle or adjective is the verb: "o chão esta coberto".
  {
    pattern: `(?<target>esta)${S}(?=(?:\\p{L}{2,}(?:ado|ido)|coberto|aberto|feito|morto|escrito|pronto|cheio|vazio|certo|bom|ótimo|lindo|frio|quente|limpo|sujo|seco|novo|velho)${W})`,
    alternatives: ["está"],
    messageKey: "review_msg_pt_homophone",
  },
  // "esta a fazer" is the European progressive "está a fazer": a demonstrative never stands
  // before "a" and an infinitive.
  {
    pattern: `(?<target>esta)${S}(?=a${S}\\p{L}{2,}(?:ar|er|ir|or)(?:-\\p{L}+)?${W})`,
    alternatives: ["está"],
    messageKey: "review_msg_pt_homophone",
  },
  // "poço" (well) before an infinitive or an object pronoun is "posso" (I can).
  {
    pattern: `(?<!(?:o|um|do|no|ao|pelo|esse|este|aquele|seu|meu|nosso|teu|cada|algum|nenhum|qualquer|grande|pequeno|fundo|velho)${S})(?<target>poço)${S}(?=(?:me|te|lhe|lhes|nos|vos|se|\\p{L}+[aeiô]r)${W})`,
    alternatives: ["posso"],
    messageKey: "review_msg_pt_homophone",
  },
  // "várias" (several) before a plural noun; "varias" is "you vary".
  {
    pattern: `(?<!tu${S}(?:não${S})?)(?<target>varias)${S}(?=(?!(?:os|as|nos|vos|mais|menos|vezes${S}de)${W})\\p{L}{2,}s${W})`,
    alternatives: ["várias"],
    messageKey: "review_msg_pt_homophone",
  },
  // "até" (until, even) before an article, a place or a time word; "ate" is a form of "atar".
  {
    pattern: `(?<!(?:que|se|quando|embora|talvez|caso)${S}(?:\\p{L}{1,24}${S})?)(?<target>ate)${S}(?=(?:o|a|os|as|ao|aos|à|às|aqui|ali|lá|onde|quando|minha|meu|sua|seu|nossa|nosso|\\d)${W})`,
    alternatives: ["até"],
    messageKey: "review_msg_pt_homophone",
  },
  // A preposition takes "mim" and "ti" when no infinitive follows: "para mim", "entre mim e ti".
  {
    pattern: `(?:para|sem|contra|perante|a)${S}(?<target>eu|tu)(?=[ \\t\\u00a0]{0,2}[.,;:!?)]|$)`,
    alternatives: (typed) => [typed.toLowerCase() === "eu" ? "mim" : "ti"],
    messageKey: "review_msg_pt_pronoun_case",
  },
  {
    pattern: `entre${S}(?<target>eu|tu)${S}(?=e${W})`,
    alternatives: (typed) => [typed.toLowerCase() === "eu" ? "mim" : "ti"],
    messageKey: "review_msg_pt_pronoun_case",
  },
  // "Esse livro é para mim ler": the subject of the infinitive is "eu". Opening a clause,
  // "Para mim estudar é difícil" may also mean "for me, studying is hard".
  {
    pattern: `(?:é|era|foi|será|seria|são|eram)${S}para${S}(?<target>mim|ti)${S}(?=${INFINITIVE_AHEAD})`,
    alternatives: (typed) => [typed.toLowerCase() === "mim" ? "eu" : "tu"],
    messageKey: "review_msg_pt_pronoun_case",
  },
  {
    pattern: `(?<=(?:^|[.!?;:][ \\t\\u00a0]{0,8}|\\n[ \\t\\u00a0]{0,8}))(?:para|pra)${S}(?<target>mim|ti)${S}(?=${INFINITIVE_AHEAD})`,
    alternatives: (typed) => (typed.toLowerCase() === "mim" ? ["eu", "mim,"] : ["tu", "ti,"]),
    messageKey: "review_msg_pt_pronoun_case",
  },
  // Crase: "à" before a span of time is "há" (it existed), after "daqui" plain "a".
  {
    pattern: `(?<!daqui${S})(?<target>à)${S}${AMOUNT}{0,2}${SPAN}`,
    alternatives: ["há"],
    messageKey: "review_msg_pt_crase",
  },
  {
    pattern: `(?<target>à)${S}(?:muito|pouco|bastante|algum|tanto)${S}tempo${W}`,
    alternatives: ["há"],
    messageKey: "review_msg_pt_crase",
  },
  // "Ainda à muito para fazer": "há" (there is) before an amount.
  {
    pattern: `(?<target>à)${S}(?:muito|pouco|bastante)(?=${S}(?:para|que|a${S}fazer)${W}|[ \\t\\u00a0]{0,2}[.,;!?])`,
    alternatives: ["há"],
    messageKey: "review_msg_pt_crase",
  },
  // "Não o vejo a muito tempo": time elapsed is "há"; "daqui a pouco tempo" is ahead.
  {
    pattern: `(?<!(?:daqui|dali|daí|até|de|em)${S})(?<target>a)${S}(?:muito|bastante)${S}tempo${W}`,
    alternatives: ["há"],
    messageKey: "review_msg_pt_crase",
  },
  // "dês que", "dês do mês passado": "desde". "que tu dês do teu" is "dar".
  {
    pattern: `(?<!(?:me|te|lhe|nos|lhes|tu|que|não)${S})(?<target>dês)${S}(?=que${W})`,
    alternatives: ["desde"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?<!(?:me|te|lhe|nos|lhes|tu|que|não)${S})(?<target>dês${S}d(?<article>[oa]s?|e))${W}`,
    alternatives: (typed) => {
      const article = /d([oa]s?|e)$/.exec(typed.toLowerCase())![1];
      return [article === "e" ? "desde" : `desde ${article}`];
    },
    messageKey: "review_msg_pt_homophone",
  },
  // "pôr termo a", "vou pôr em prática": the verb "pôr" keeps its accent.
  {
    pattern: `(?<target>por)${S}(?=termo${S}(?:a|ao|à|aos|às)${W})`,
    alternatives: ["pôr"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `${MODAL}${S}(?<target>por)${S}(?=em${S}(?:prática|dúvida|risco|ordem|causa|cena|votação|funcionamento)${W})`,
    alternatives: ["pôr"],
    messageKey: "review_msg_pt_homophone",
  },
  // A range "de X a Y" has no article, so no crase.
  {
    pattern: `de${S}(?:${WEEKDAY}|${MONTH}|\\d+)${W}${S}(?<target>à)${S}(?=${WEEKDAY}|${MONTH}|\\d)`,
    alternatives: ["a"],
    messageKey: "review_msg_pt_crase",
  },
  // Clock times take the crase: "às 19h30".
  {
    pattern: `(?<!(?:entre|e|de|desde|após|até|para|por|todas|sobre|com|que)${S})(?<target>as)${S}(?=\\d{1,2}(?:h\\d{0,2}|:\\d\\d)${W})`,
    alternatives: ["às"],
    messageKey: "review_msg_pt_crase",
  },
  {
    pattern: `(?<!(?:entre|e|de|desde|após|até|para|por|todas|sobre|com|que)${S})(?<target>as)${S}(?=${CLOCK_WORDS}${S}horas${W})`,
    alternatives: ["às"],
    messageKey: "review_msg_pt_crase",
  },
  // "às vezes" (sometimes); "as vezes" is the noun: "todas as vezes", "as vezes em que".
  {
    pattern: `(?<!(?:todas|algumas|muitas|poucas|várias|tantas|quantas|das|nas|pelas|com|por|de|em|contei|conto|contar|lembro|lembrar)${S})(?<target>as)${S}vezes${W}(?!${S}(?:em${S}que|que|de|do|da|dos|das|anteriores|seguintes|passadas|necessárias|certas)${W})`,
    alternatives: ["às"],
    messageKey: "review_msg_pt_crase",
  },
  // "ir às compras", "virar à direita".
  {
    pattern: `(?:vou|vai|vamos|vão|foi|fui|fomos|foram|ir|ia|iam|irei|iremos|irá)${S}(?<target>as)${S}compras${W}`,
    alternatives: ["às"],
    messageKey: "review_msg_pt_crase",
  },
  {
    pattern: `(?:vire|virar|vira|virou|dobre|dobrar|dobra|dobrou|siga|seguir|segue|fica|ficam|ficava|ficavam|fique|está|estão|estava|sentou|sentado|sentada|sente)${S}(?<target>a)${S}(?:direita|esquerda)${W}`,
    alternatives: ["à"],
    messageKey: "review_msg_pt_crase",
  },
  // A bare plural takes no article, so no crase: "à conclusões" -> "a conclusões".
  {
    pattern: `(?<target>à)${S}(?!(?:mais|menos|demais|vezes|trois)${W})\\p{L}{2,}(?:as|os|es|ns|is|ões|ães)${W}`,
    alternatives: ["a"],
    messageKey: "review_msg_pt_crase",
  },
  // "por quê" closes a question; before more words it is "por que" (or "porque").
  {
    pattern: `(?<!(?<![\\p{L}])(?:o|um|nenhum|seu|qualquer)${S})(?<target>por${S}quê)${S}(?=\\p{L})`,
    alternatives: ["por que", "porque"],
    messageKey: "review_msg_pt_por_que",
  },
  // "porque?" and "por que?" at the end of a question are "por quê?".
  {
    pattern: `(?<!(?<![\\p{L}])(?:o|um|nenhum|seu|qualquer)${S})(?<target>porque|por${S}que)(?=[ \\t\\u00a0]{0,2}\\?)`,
    alternatives: ["por quê"],
    messageKey: "review_msg_pt_por_que",
  },
  // The noun is "porquê": "o porquê de tudo", "nenhum porquê".
  {
    pattern: `(?:o|um|nenhum|seu|qualquer)${S}(?<target>porque|por${S}que|por${S}quê)(?=[ \\t\\u00a0]{0,2}[.,;:!?]|${S}(?:de|da|do|das|dos|daquel\\p{L}*|dess\\p{L}*|dest\\p{L}*|disso|disto|daquilo)${W})`,
    alternatives: ["porquê"],
    messageKey: "review_msg_pt_por_que",
  },
  // A question opened by "Porque" asks "Por que".
  {
    pattern: `(?<target>Porque)${S}(?=[^.!?\\n]{1,120}\\?)`,
    alternatives: ["Por que"],
    messageKey: "review_msg_pt_por_que",
    clauseStart: true,
  },
  // "é" (is) after a subject or question word, before what is said of it.
  {
    pattern: `${SUBJECT}${S}(?<target>e)${S}${IS_ADJECTIVE}${W}`,
    alternatives: ["é"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `que${S}(?<target>e)${S}${IS_ADJECTIVE}${W}(?=[^.!?\\n]{0,80}\\?)`,
    alternatives: ["é"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?:onde|qual|quando|quanto|como|quem|o${S}que|por${S}que)${S}(?<target>e)${S}(?:o|a|os|as|um|uma)${W}${S}(?!que${W})(?=[^.!?\\n]{0,80}\\?)`,
    alternatives: ["é"],
    messageKey: "review_msg_pt_homophone",
    clauseStart: true,
  },
  // "está": before a gerund, a state or a place, or closing "onde/como ... ?".
  {
    pattern: `(?<target>esta)${S}(?!segundo${W})(?=\\p{L}+[aei]ndo${W})`,
    alternatives: ["está"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `${SUBJECT}${S}(?<target>esta)${S}${STATE}${W}`,
    alternatives: ["está"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?:onde|quem|aqui|ali|lá|cá|já)${S}(?<target>esta)(?=[ \\t\\u00a0]{0,2}[?!.])`,
    alternatives: ["está"],
    messageKey: "review_msg_pt_homophone",
  },
  // "como esta." compares ("uma situação como esta"); only the question is "como está?".
  {
    pattern: `como${S}(?<target>esta)(?=[ \\t\\u00a0]{0,2}\\?)`,
    alternatives: ["está"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `tu${S}(?<target>estas)${W}`,
    alternatives: ["estás"],
    messageKey: "review_msg_pt_homophone",
  },
  // "dá" and "dê" after an object pronoun, or "não da" closing an exclamation.
  {
    pattern: `${CLITIC}${S}(?<target>da)${S}(?=\\p{L})`,
    alternatives: ["dá"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `${SUBJECT}${S}(?<target>da)${S}(?:certo|errado|pra|para|tempo|conta|medo|raiva|vontade|sono|fome|sede|trabalho|aula|aulas|bola|resultado|jeito|resposta|chance|impressão|voltas|ouvidos|valor|importância|atenção)${W}`,
    alternatives: ["dá"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `${SUBJECT}${S}se${S}(?<target>da)${S}conta${W}`,
    alternatives: ["dá"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `não${S}(?<target>da)(?=[ \\t\\u00a0]{0,2}[!.])`,
    alternatives: ["dá"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `${CLITIC}${S}(?<target>de)${S}(?:um|uma|o|a|os|as|mais|licença|atenção|razão|tempo|notícias|crédito|valor|importância|chance|trabalho|espaço|confiança)${W}`,
    alternatives: ["dê"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `que${S}(?:você|ele|ela|eles|elas|vocês|o${S}\\p{L}+|a${S}\\p{L}+)${S}(?<target>de)${S}(?:mais${S}|uma${S}(?=(?:chance|dica|olhada|mão|força|ajuda|resposta|oportunidade)${W}))?(?:crédito|atenção|valor|importância|licença|chance|razão|confiança|ouvidos|sorte|dica|olhada|mão|força|ajuda|resposta|oportunidade)${W}`,
    alternatives: ["dê"],
    messageKey: "review_msg_pt_homophone",
  },
  // "houve" (there was) before something that happened: "ouve problemas" -> "houve problemas".
  {
    pattern: `(?<target>ouve)(?:${S}${OCCURRENCE_MODIFIER}${W}){0,2}${S}${OCCURRENCE}${W}`,
    alternatives: ["houve"],
    messageKey: "review_msg_pt_homophone",
  },
  // "em cima" (on top) is two words; the verb "encimar" takes no "de" and ends no clause.
  {
    pattern: `(?<target>encima)${S}(?:de|da|do|das|dos|dele|dela|deles|delas|disso|disto|daquel\\p{L}*)${W}`,
    alternatives: ["em cima"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?:aqui|ali|lá|cá|aí|está|estava|ficou|pôs|caiu|subiu)${S}(?<target>encima)(?=[ \\t\\u00a0]{0,2}[.,;!?])`,
    alternatives: ["em cima"],
    messageKey: "review_msg_pt_homophone",
  },
  // "porquê" is the noun; before a clause it is "porque" (because) or "por que" (why).
  {
    pattern: `(?<!(?<![\\p{L}])(?:o|um|nenhum|seu|teu|meu|nosso|vosso|qualquer|cada|esse|este|aquele|sem|do|no|ao|pelo|dum|num|grande|verdadeiro|próprio)${S})(?<target>porquê)${S}(?=\\p{L}{2,}${W})(?!(?:de|da|do|das|dos)${W})`,
    alternatives: ["porque", "por que"],
    messageKey: "review_msg_pt_por_que",
  },
  // "a fim de" (in order to); "afim" is the adjective "related".
  {
    pattern: `(?<target>afim)${S}(?=de${S}(?:que${W}|\\p{L}+[aeiô]r(?:em|mos)?${W}))`,
    alternatives: ["a fim"],
    messageKey: "review_msg_pt_homophone",
  },
  // "acerca de" means "about a subject"; before an amount of time it is "há cerca de" (ago) or
  // "a cerca de" (ahead), before a distance "a cerca de", before a count "cerca de".
  {
    pattern: `(?<target>acerca)${S}(?=de${S}${NUMBER_WORD}${S}(?:anos|meses|dias|horas|minutos|semanas|segundos|décadas|séculos|ano|mês|dia|hora|minuto|semana)${W})`,
    alternatives: ["há cerca", "a cerca"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?<target>acerca)${S}(?=de${S}${NUMBER_WORD}${S}(?:km|quilômetros?|metros?|milhas?|léguas?|quadras?)${W})`,
    alternatives: ["a cerca"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?<target>acerca)${S}(?=de${S}${NUMBER_WORD}${S}(?:pessoas|alunos|reais|dólares|euros|quilos|kg|toneladas|litros|casos|mortos|vítimas|participantes|habitantes|exemplares)${W})`,
    alternatives: ["cerca"],
    messageKey: "review_msg_pt_homophone",
  },
  // "aonde" asks where to; with a verb of being somewhere it is "onde".
  {
    pattern: `(?<target>aonde)${S}(?=(?:(?:você|vocês|ele|ela|eles|elas|eu|nós|tu|a${S}gente)${S})?(?:(?:não|já|ainda)${S})?(?:mora|moras|moram|moro|moramos|morava|moravam|fica|ficam|ficava|ficavam|está|estão|estava|estavam|estou|estás|trabalha|trabalham|trabalho|trabalhava|vive|vivem|vivo|vivia|estuda|estudam|estudo|nasceu|nasceram|nasci|reside|residem|se${S}encontra|se${S}encontram|fica)${W})`,
    alternatives: ["onde"],
    messageKey: "review_msg_pt_homophone",
  },
  // "se não" (if not) before a subjunctive: "senão fosse por ele" -> "se não fosse".
  {
    pattern: `(?<target>senão)${S}(?=(?:(?:me|te|se|lhe|nos|o|a)${S})?(?:fosse|fossem|for|forem|fores|tivesse|tivessem|tiver|tiverem|houvesse|houver|puder|puderem|pudesse|quiser|quiserem|quisesse|estiver|estiverem|estivesse|fizer|fizerem|fizesse|der|derem|desse|vier|vierem|viesse|souber|soubesse|disser|dissesse|\\p{L}{2,}(?:asse|esse|isse)m?|\\p{L}{2,}[aei]rem)${W})`,
    alternatives: ["se não"],
    messageKey: "review_msg_pt_homophone",
  },
  // "não só ... mas também": the second half is "mas" (but).
  {
    pattern: `não${S}(?:só|somente|apenas)${S}[^.!?;\\n]{1,80}?(?<target>mais)(?=,?${S}também${W})`,
    alternatives: ["mas"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Dá pra mim fazer", "é pra mim ir": the subject of the infinitive is "eu".
  {
    pattern: `(?:dá|dava|deu|dar|daria|dará|é|era|foi|será|seria)${S}(?:para|pra)${S}(?<target>mim)${S}(?=${INFINITIVE_AHEAD})`,
    alternatives: ["eu"],
    messageKey: "review_msg_pt_pronoun_case",
  },
  // "Já fazem dois anos": elapsed-time "fazer" has no subject.
  {
    pattern: `já${S}(?<target>fazem|faziam|fizeram|farão|fariam)${S}${AMOUNT}${SPAN_NOUN}${W}`,
    alternatives: (typed) => [IMPERSONAL[typed.toLowerCase()]],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?<target>fazem|faziam|fizeram|farão|fariam)${S}já${S}${AMOUNT}${SPAN_NOUN}${S}(?:que|desde)${W}`,
    alternatives: (typed) => [IMPERSONAL[typed.toLowerCase()]],
    messageKey: "review_msg_pt_homophone",
  },
  // Existential "haver" stays singular before a bare plural: "Enquanto houverem erros".
  {
    pattern: `(?<target>haviam|haverão|haveriam|houvessem|houverem|hajam|haverem)${S}(?=(?!(?:todos|todas|ambos|ambas|mesmos|mesmas|próprios|próprias|nos|vos|os|as|los|las|já|sido|estado|ele|elas|eles)${W})\\p{L}{3,}s${W})`,
    alternatives: (typed) => [HAVER_SINGULAR[typed.toLowerCase()]],
    messageKey: "review_msg_pt_homophone",
  },
  // "Caso" (in case) opening a conditional; "Case" is a form of "casar".
  {
    pattern: `(?<target>case)${S}(?=(?:eles|elas|ele|ela|você|vocês|eu|nós|alguém|algo|ninguém|nada|tudo|não|os|as|boas|bons|muitos|muitas|haja|seja|tenha|queira|precise|precisem)${W})`,
    alternatives: ["caso"],
    messageKey: "review_msg_pt_homophone",
    clauseStart: true,
  },
  // Verbs whose short participle goes with "ser" and "estar": "foi gastado" -> "foi gasto".
  {
    pattern: `(?:é|são|foi|foram|era|eram|será|serão|seria|seriam|seja|sejam|fosse|fossem|sido|ser|está|estão|estava|estavam|estar|esteja|estejam|ficou|ficaram|fica|ficam)${S}(?:(?:já|não|todo|toda|todos|todas|bem)${S})?(?<target>(?:${Object.keys(SHORT_PARTICIPLE).join("|")})[ai]d[oa]s?)${W}`,
    alternatives: (typed) => [shortParticiple(typed.toLowerCase())],
    messageKey: "review_msg_pt_participle",
  },
  // "às" before a clock time; "ás" is the card.
  {
    pattern: `(?<target>ás)${S}(?=(?:\\d{1,2}(?:h|:\\d\\d|${S}horas)|${CLOCK_WORDS}${S}horas|meia-noite|uma${S}hora)${W})`,
    alternatives: ["às"],
    messageKey: "review_msg_pt_crase",
  },
  // "Dê uma olhada", "Não dê ouvidos": the imperative of "dar".
  {
    pattern: `(?<target>de)${S}(?=(?:uma${S}(?:olhada|chance|mão|força|ajuda|passada|lida|conferida|espiada)|atenção|importância|ouvidos|licença|um${S}jeito|um${S}tempo|notícias)${W})`,
    alternatives: ["dê"],
    messageKey: "review_msg_pt_homophone",
    clauseStart: true,
  },
  {
    pattern: `não${S}(?<target>de)${S}(?=(?:confiança|atenção|importância|ouvidos|bola|trela|moleza|bobeira|chance|mole)${W})`,
    alternatives: ["dê"],
    messageKey: "review_msg_pt_homophone",
  },
  // "está de saída", "está de acordo": "esta" is the demonstrative.
  {
    pattern: `(?<target>esta)${S}(?=de${S}(?:saída|folga|férias|plantão|parabéns|luto|acordo|volta|passagem|brincadeira|castigo|dieta|cama|pé|olho|prontidão|mudança|licença|serviço|bem|mal)${W})`,
    alternatives: ["está"],
    messageKey: "review_msg_pt_homophone",
  },
  // "ir à praia", "ir ao cinema": going somewhere takes "a", not "em".
  {
    pattern: `(?:${GOES_NOT_INDO})${S}(?<target>na|nas)${S}(?=(?:${DESTINATIONS})s?${W})`,
    alternatives: (typed) => [typed.toLowerCase() === "nas" ? "às" : "à"],
    messageKey: "review_msg_pt_regency",
  },
  {
    pattern: `(?:${GOES_NOT_INDO})${S}(?<target>no|nos)${S}(?=(?:${MALE_DESTINATIONS})${W})`,
    alternatives: (typed) => [typed.toLowerCase() === "nos" ? "aos" : "ao"],
    messageKey: "review_msg_pt_regency",
  },
  // Existential "haver" after a modal keeps the modal singular: "Devem haver baratas".
  {
    pattern: `(?<target>${Object.keys(MODAL_SINGULAR).join("|")})${S}haver${S}(?!\\p{L}+[ai]d[oa]${W})(?=\\p{L})`,
    alternatives: (typed) => [MODAL_SINGULAR[typed.toLowerCase()]],
    messageKey: "review_msg_pt_homophone",
  },
  // "evitar comer", not "evitar de comer".
  {
    pattern: `(?:evito|evita|evitam|evitamos|evitar|evitou|evitei|evitava|evitem|evite)${S}(?<target>de${S})(?=${INFINITIVE_AHEAD})`,
    alternatives: [""],
    messageKey: "review_msg_pt_regency",
  },
  // "Penso de que": a verb of thinking or saying takes "que" directly.
  {
    pattern: `(?:penso|pensei|pensamos|acho|achei|achamos|creio|acredito|acreditamos|afirmo|afirmou|afirmaram|garanto|garantiu|espero|esperamos|sei|sabemos|parece|parecia|disse|disseram|imagino|suponho)${S}(?<target>de${S})(?=que${W})`,
    alternatives: [""],
    messageKey: "review_msg_pt_regency",
  },
  // "O que houve com ela?": "ouve" (hears) asked about something that happened.
  {
    pattern: `(?:o${S}que|algo|alguma${S}coisa)${S}(?<target>ouve)(?=${S}com${W}|[ \\t\\u00a0]{0,2}\\?)`,
    alternatives: ["houve"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?<target>ouve)${S}(?=(?:algo|alguma${S}coisa|algum${S}problema)${S}(?:errado${S}|estranho${S})?com${W})`,
    alternatives: ["houve"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Eu saí" (past) or "eu saio" (present): "sai" is "he leaves".
  {
    pattern: `eu${S}(?:(?:não|já|também|nunca|quase)${S})?(?<target>sai|cai|trai|atrai|distrai|contribui|possui|destrui|inclui|conclui|constrói|construi|influi|substitui|distribui|atribui|diminui)${W}(?!-)`,
    alternatives: (typed) => {
      const lower = typed.toLowerCase().replace("ó", "o");
      return [`${lower.slice(0, -1)}í`, lower.replace(/i$/, /ai$/.test(lower) ? "io" : "o")];
    },
    messageKey: "review_msg_pt_agreement",
  },
  // "tão" (so) before an adjective or adverb; "tao" is no Portuguese word outside "o Tao".
  {
    pattern: `(?<!(?:o|do|no|ao)${S})(?<target>tao)${S}(?=\\p{L}{3,}${W})`,
    alternatives: ["tão"],
    messageKey: "review_msg_pt_homophone",
  },
  // "pôr" (to put) after a modal: "por" + article would contract to "pelo".
  {
    pattern: `${MODAL}${S}(?<target>por)${S}(?:o|a|os|as|em|termo|ordem)${W}`,
    alternatives: ["pôr"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Saiu a dois dias." -> "há dois dias": time gone by closing the clause. A range ("de dois a
  // três anos"), a distance ("fica a duas horas") or a measure ("condenado a dez anos") keeps "a".
  {
    pattern: `(?<!(?<![\\p{L}])(?:daqui|dali|daí|até|de|em|para|entre|e|ou|inferior|superior|igual|iguais|equivalente|acima|abaixo|perto|próximo|cerca|\\d+|um|uma|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|anos?|meses|mês|dias?|horas?|(?:reduz|limit|aument|pass|diminu|ampli|estend|prolong|encurt|fix|restring|condena|sentencia|equival|correspond|cheg|fic|est|situ|localiz|distan|volt|mor[aeo]|ir|vou|vai|vão)\\p{L}{0,10})${S})(?<target>a)${S}${AMOUNT}{1,2}(?:anos|meses|semanas|dias|horas|séculos|décadas|minutos)${W}(?=[ \\t\\u00a0]{0,2}(?:[.;!?]|$)|${S}(?:atrás|que)${W})`,
    alternatives: ["há"],
    messageKey: "review_msg_pt_crase",
  },
  // "dá de mamar", "dá de ombros"; "nos da" after a subject; "Ele da aulas" before a plural.
  {
    pattern: `(?<target>da)${S}(?=de${S}(?:mamar|comer|beber|ombros|presente|cara${S}com|frente${S}com|graça)${W})`,
    alternatives: ["dá"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `${SUBJECT}${S}nos${S}(?<target>da)${S}(?=\\p{L})`,
    alternatives: ["dá"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?:ele|ela|você|ninguém|alguém|quem)${S}(?:(?:não|já|sempre|também|nunca|ainda)${S})?(?<target>da)${S}(?=(?:bons|boas|muitos|muitas|vários|várias|\\p{L}{3,}(?:as|os|ões|es))${W})`,
    alternatives: ["dá"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Quero esta.", "A melhor é esta.": the demonstrative standing for a noun after a verb.
  {
    pattern: `(?:prefiro|prefere|preferia|escolho|escolhi|escolheu|achei|pego|peguei|pegou|levo|levei|levou|compro|comprei|comprou|uso|usei|usou|é|era|foi|será|seria)${S}(?<target>está)(?=[ \\t\\u00a0]{0,2}(?:[.!?,;]|$))`,
    alternatives: ["esta"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Quero está." -> "esta": a sentence ending in "quero está" wants this one. "O que ele quer
  // está, no fundo, certo" makes "quer" a relative clause's verb, so a "que" before it stays.
  {
    pattern: `(?<!que${S}(?:\\p{L}+${S})?)(?:quero|queria|queremos|quer)${S}(?<target>está)(?=[ \\t\\u00a0]{0,2}(?:[.!?]|$))`,
    alternatives: ["esta"],
    messageKey: "review_msg_pt_homophone",
  },
  // "salvar a se mesmo" -> "a si mesmo": after a preposition the reflexive is "si" ("se mesmo
  // assim" is "even if").
  {
    pattern: `(?:a|para|de|por|sobre|em|entre|contra|perante)${S}(?<target>se)${S}(?=mesm[oa]s?${W}(?!${S}assim${W}))`,
    alternatives: ["si"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Temos de traduzir em inglês" -> "para": one translates into a language.
  {
    pattern: `(?:traduzir|traduz|traduzo|traduzi|traduziu|traduzimos|traduzem|traduziram|traduza|traduzam|traduzia|traduziam)${S}(?:(?:o|a|os|as|isso|isto|tudo|ele|ela|eles|elas|\\p{L}+)${S}){0,3}?(?<target>em)${S}(?=(?:inglês|português|espanhol|francês|alemão|italiano|japonês|chinês|russo|árabe|holandês|grego|polonês|sueco|coreano|latim|libras|esperanto)${W})`,
    alternatives: ["para"],
    messageKey: "review_msg_pt_regency",
  },
  // "O Rui trás o material" -> "traz": after a subject and before an object, the verb "trazer".
  {
    pattern: `(?:ele|ela|você|quem|que|sempre|também|não|nunca|já)${S}(?<target>trás)${S}(?=(?:o|a|os|as|um|uma|uns|umas|consigo|de${S}volta|sempre|muita|muito|muitos|muitas|boas|bons|novidades|notícias)${W})`,
    alternatives: ["traz"],
    messageKey: "review_msg_pt_homophone",
  },
  // "na minha ora de almoço" -> "hora": after a determiner "ora" is the noun ("de ora em diante",
  // "por ora" stay).
  {
    pattern: `(?:uma|da|na|nessa|nesta|naquela|dessa|desta|daquela|essa|esta|aquela|minha|sua|nossa|tua|cada|toda|qualquer|boa|última|primeira|mesma|pela|às|das|nas|duas|três|quatro|cinco|seis|oito|dez|doze|24|algumas|muitas|poucas)${S}(?<target>ora|oras)${W}(?!-)`,
    alternatives: (typed) => [typed.toLowerCase() === "oras" ? "horas" : "hora"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Quero ser tanto rico como ela" -> "tão": before an adjective and "como/quanto", after a
  // copula, the intensifier is "tão" ("tanto dinheiro quanto" counts a noun).
  {
    pattern: `(?:ser|é|era|foi|sou|está|estar|estava|ficar|ficou|fica|parece|parecia|andar|andares|anda|andava)${S}(?<target>tanto|tanta)${S}(?=\\p{L}{3,}(?:ad|id)[oa]${S}(?:como|quanto)${W}|(?:ric[oa]|pobre|alt[oa]|baix[oa]|bonit[oa]|fei[oa]|forte|frac[oa]|inteligente|rápid[oa]|lent[oa]|grande|pequen[oa]|bom|boa|feliz|triste|car[oa]|barat[oa]|fácil|difícil|velh[oa]|nov[oa]|gord[oa]|magr[oa]|brav[oa]|calm[oa]|famos[oa]|bel[oa]|doente)${S}(?:como|quanto)${W})`,
    alternatives: ["tão"],
    messageKey: "review_msg_pt_homophone",
  },
  // "A fruta esta podre." -> "está": a state closing the sentence.
  {
    pattern: `(?<target>esta)${S}(?=(?:podre|doente|triste|feliz|livre|disponível|ausente|contente|alegre|quente|fria|pronta|cansada|errada|certa|cheia|vazia|limpa|suja|seca|molhada|aberta|fechada|ocupada|quebrada|grávida|viva|morta|calma|tranquila|nervosa|preocupada|atrasada)[ \\t\\u00a0]{0,2}[.!?])`,
    alternatives: ["está"],
    messageKey: "review_msg_pt_homophone",
  },
  // "mais bom" -> "melhor", "mais grande" -> "maior"; "mais bom do que mau" compares qualities.
  {
    pattern: `(?<target>mais${S}(?:bom|boa|bons|boas|mau|má|maus|más|grande|grandes))(?=[ \\t\\u00a0]{0,2}(?:[.,;:!?]|$)|${S}(?:d[oa]s?|de${S}tod[oa]s)${W}|(?:${S}do)?${S}que${S}(?:(?:o|a|os|as|um|uma|eu|ele|ela|eles|elas|você|vocês|nós|isso|isto|aquilo|est[ea]s?|ess[ea]s?|aquel[ea]s?|seu|sua|seus|suas|meu|minha|nosso|nossa|antes|ontem|hoje|nunca|sempre|qualquer|todos?|todas?)${W}))`,
    alternatives: (typed) => {
      const word = typed.toLowerCase().split(/\s+/).pop()!;
      const plural = /s$/.test(word);
      const base = /^b/.test(word) ? "melhor" : /^m/.test(word) ? "pior" : "maior";
      return [plural ? `${base}es` : base];
    },
    messageKey: "review_msg_pt_comparative",
  },
  // "o apoio de que tem direito" -> "a que": "ter direito a" keeps its "a" before "que".
  {
    pattern: `(?<!(?:certeza|ideia|fato|facto|medo|receio|notícia|esperança|prova|sinal|dúvida|convicção|impressão|garantia|consciência|aviso|indício|suposição|hipótese|tese|alegação|afirmação|crença|argumento|opinião)${S})(?<target>de${S}que)${S}(?=(?:\\p{L}+${S}){0,3}(?:tem|têm|tinha|tinham|teve|tiveram|terá|terão|teria|teriam|tenho|temos|tens|tenha|tenham)${S}direito(?!${S}(?:a|à|ao|às|aos|de|\\p{L}+(?:al|ais|iv[oa]s?|ic[oa]s?|ári[oa]s?))${W}))`,
    alternatives: ["a que"],
    messageKey: "review_msg_pt_regency",
  },
  // "entre você e eu" -> "e mim": both pronouns after "entre" take the prepositional form.
  {
    pattern: `entre${S}(?:(?:o|a)${S})?\\p{L}+${S}e${S}(?<target>eu|tu)(?=[ \\t\\u00a0]{0,2}(?:[.,;:!?)]|$))`,
    alternatives: (typed) => [typed.toLowerCase() === "eu" ? "mim" : "ti"],
    messageKey: "review_msg_pt_pronoun_case",
  },
  {
    pattern: `de${S}(?<target>eu)${S}(?=para${S}(?:o|a|ti|você|ele|ela|vocês|eles|elas)${W})`,
    alternatives: ["mim"],
    messageKey: "review_msg_pt_pronoun_case",
  },
  // A statement opened by "Por que" is the cause "Porque": "Por que choveu." answers.
  {
    pattern: `(?<=(?:^|[.!?][ \\t\\u00a0]{1,8}|\\n[ \\t\\u00a0]{0,8}))(?<target>Por${S}que)${S}(?!(?:razão|motivo|causa|raios)${W})(?=[^.!?,\\n]{1,120}(?:[.!](?![.])|$))`,
    alternatives: ["Porque"],
    messageKey: "review_msg_pt_por_que",
    capitalized: true,
  },
  {
    pattern: `(?:é|foi|era)${S}(?<target>por${S}que)${S}(?=(?:o|a|os|as|ele|ela|eles|elas|eu|você|vocês|nós|não|isso|isto)${W})(?![^.!?\\n]{0,120}\\?)`,
    alternatives: ["porque"],
    messageKey: "review_msg_pt_por_que",
  },
  // "Eu cinto muito" -> "sinto": "sentir" after its subject or a pronoun.
  {
    pattern: `(?:eu|não|me|te|se|também|já|ainda|ele|ela|você)${S}(?<target>cinto|cinta|cintas|cintam)${W}(?!-)`,
    alternatives: (typed) => [`s${typed.slice(1).toLowerCase()}`],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?<target>Cinto)${S}(?=muito${W})`,
    alternatives: ["Sinto"],
    messageKey: "review_msg_pt_homophone",
    clauseStart: true,
  },
  // "Fica ao norte": cardinal points are masculine.
  {
    pattern: `(?<target>à)${S}(?=(?:norte|sul|leste|oeste|nordeste|noroeste|sudeste|sudoeste)${W})`,
    alternatives: ["ao", "a"],
    messageKey: "review_msg_pt_crase",
  },
  // "Está casa é linda" -> "Esta": the demonstrative opening a subject before its verb.
  {
    pattern: `(?<target>Está|Estás)${S}(?!(?:tudo|nada|bem|mal|certo|claro|ótimo|bom|tranquilo|difícil|fácil|aqui|ali|lá|longe|perto|tarde|cedo|frio|quente|escuro|calor|chato|feito|visto|provado|dito)${W})(?=\\p{L}{3,}(?<!ndo|[ai]do)${S}(?:é|são|foi|foram|era|eram|será|serão|tem|têm|ficou|ficaram|parece|parecem)${W})`,
    alternatives: (typed) => [typed.replace(/á/i, "a")],
    messageKey: "review_msg_pt_homophone",
    clauseStart: true,
    capitalized: true,
  },
  // ", mais não o bastante" -> "mas": after a comma, before a negation, "but".
  {
    pattern: `(?<=,)${S}(?<target>mais)${S}(?=não${W})`,
    alternatives: ["mas"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `e${S}(?<target>mas)${S}(?=(?:tarde|cedo)${W})`,
    alternatives: ["mais"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Nunca vez o Rui?" -> "vês": the verb "ver" after its subject or a negation.
  {
    pattern: `(?:tu|nunca|não|assim|o${S}que)${S}(?<target>vez)(?=${S}(?:o|a|os|as|isso|isto|aquilo|ninguém|nada|tudo|algo|alguém)${W}|[ \\t\\u00a0]{0,2}[.?!])`,
    alternatives: ["vês"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Temos sou duas fotos" -> "só": "sou" never follows another verb.
  {
    pattern: `(?:é|são|era|eram|temos|tem|têm|tenho|tinha|havia|há|faltam|restam|resta|falta)${S}(?<target>sou)${W}`,
    alternatives: ["só"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Como foi suas férias?" -> "foram": a plural subject after the verb of the question.
  {
    pattern: `(?:como|onde|quando|quanto)${S}(?<target>foi|é|era|está|estava)${S}(?=(?:as|os|suas|seus|minhas|meus|tuas|teus|nossas|nossos)${S}\\p{L}{3,}s[ \\t\\u00a0]{0,2}\\?)`,
    alternatives: (typed) => [
      { foi: "foram", é: "são", era: "eram", está: "estão", estava: "estavam" }[
        typed.toLowerCase()
      ]!,
    ],
    messageKey: "review_msg_pt_homophone",
  },
  // "É fácil de que", "Alegra-me de que": an adjective of "ser" or a verb with a dative pronoun
  // takes the clause directly; "insistir" governs "em".
  {
    pattern: `(?:é|era|foi|será|seria|parece)${S}(?:fácil|difícil|possível|impossível|provável|improvável|importante|necessário|preciso|claro|óbvio|evidente|natural|normal|justo|bom|melhor)${S}(?<target>de${S})(?=que${W})`,
    alternatives: [""],
    messageKey: "review_msg_pt_regency",
  },
  {
    pattern: `(?:alegra|agrada|convém|importa|basta|interessa|preocupa)-(?:me|te|lhe|nos|vos|lhes)${S}(?<target>de${S})(?=que${W})`,
    alternatives: [""],
    messageKey: "review_msg_pt_regency",
  },
  {
    pattern: `insist(?:o|e|es|imos|em|i|iu|iram|ia|iam|ir|a|as|am)${S}(?<target>de)${S}(?=que${W})`,
    alternatives: ["em"],
    messageKey: "review_msg_pt_regency",
  },
  // "Fui á praia" -> "à" or "a": a lone "a" takes the grave accent or none. "o á" is the letter.
  {
    pattern: `(?<!(?<![\\p{L}])(?:o|um|no|do|ao|pelo|num|dum|letra)${S})(?<target>á)${W}(?!-)`,
    alternatives: ["à", "a"],
    messageKey: "review_msg_pt_crase",
  },
  // "ele já si cansou" -> "se": "si" only comes after a preposition ("para si", "em si").
  {
    pattern: `(?:ele|ela|eles|elas|você|vocês|já|não|nunca|também|sempre|ainda)${S}(?<target>si)${S}(?!(?:mesm[oa]s?|própri[oa]s?|bemol|maior|menor|sustenido)${W})(?=\\p{L}{3,}${W})`,
    alternatives: ["se"],
    messageKey: "review_msg_pt_homophone",
  },
  // "algum de voz sabe" -> "de vós": "one of you" takes the pronoun.
  {
    pattern: `(?:um|uma|algum|alguma|nenhum|nenhuma|qual|quais|cada${S}um|cada${S}uma|alguns|algumas|muitos|muitas|todos|todas|ambos)${S}de${S}(?<target>voz)(?=[ \\t\\u00a0]{0,2}[.,;:!?)]|${S}(?:que|se|o|a|me|lhe|nos|pode|poderá|poderia|deve|vai|irá|há|é|será|tem|sabe)${W})`,
    alternatives: ["vós"],
    messageKey: "review_msg_pt_homophone",
  },
  // "Em maio tive de férias" -> "estive": one is ("estar") on holiday, not has to.
  {
    pattern: `(?<target>tive|teve|tivemos|tiveram|tinha|tínhamos|tinham)${S}(?=de${S}(?:férias|folga|licença)(?:[ \\t\\u00a0]{0,2}(?:[.,;!?]|$)|${S}(?:em|no|na|até|desde|durante|com|por|e)${W}))`,
    alternatives: (typed) => [ESTAR_FOR_TER[typed.toLowerCase()]],
    messageKey: "review_msg_contextual_grammar",
  },
  // "Apôs 1990" -> "Após": "apôs" is the verb "apor"; a year or a span follows the preposition.
  {
    pattern: `(?<target>apôs)${S}(?=\\d{4}${W}|\\d{1,3}${S}${SPAN})`,
    alternatives: ["após"],
    messageKey: "review_msg_pt_homophone",
  },
  // "agente vai" -> "a gente vai": "we" is two words; "agente" is an agent. Only where no
  // determiner can stand before the noun.
  {
    pattern: `(?<![\\p{L}][ \\t\\u00a0]{0,8})(?<target>agente)${S}(?=${AGENTE_VERB})`,
    alternatives: ["a gente"],
    messageKey: "review_msg_pt_homophone",
    clauseStart: true,
  },
  {
    pattern: `(?:que|e|mas|porque|quando|se|então|aí)${S}(?<target>agente)${S}(?=${AGENTE_VERB})`,
    alternatives: ["a gente"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?:com|para|pra|sem|entre)${S}(?<target>agente)(?=[ \\t\\u00a0]{0,2}[.,;:!?])`,
    alternatives: ["a gente"],
    messageKey: "review_msg_pt_homophone",
  },
  // "pos-graduação" -> "pós-": these prefixes are stressed and take their accent.
  {
    pattern: `(?<target>pos|recem|alem|aquem)-(?=\\p{L})`,
    alternatives: (typed) => [ACCENTED_PREFIX[typed.toLowerCase()]],
    messageKey: "review_msg_pt_homophone",
  },
  // "ela sera chamada", "você tera tempo" -> "será", "terá": the future of ser and ter has an
  // accent; "sera" and "tera" are other words.
  {
    pattern: `(?:${SUBJECT}|qual|quando|o${S}que)${S}(?<target>sera|tera)${S}(?=\\p{L})`,
    alternatives: (typed) => [FUTURE_ACCENT[typed.toLowerCase()]],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?<target>sera)${S}(?=\\p{L}{2,}(?:ad|id)[oa]s?${W})`,
    alternatives: (typed) => [FUTURE_ACCENT[typed.toLowerCase()]],
    messageKey: "review_msg_pt_homophone",
  },
];
const ALL_FRAMES = [...FRAMES, ...WORD_CHOICE_FRAMES];
const ACCENTED_PREFIX: Record<string, string> = {
  pos: "pós",
  recem: "recém",
  alem: "além",
  aquem: "aquém",
};
const ESTAR_FOR_TER: Record<string, string> = {
  tive: "estive",
  teve: "esteve",
  tivemos: "estivemos",
  tiveram: "estiveram",
  tinha: "estava",
  tínhamos: "estávamos",
  tinham: "estavam",
};
const FUTURE_ACCENT: Record<string, string> = {
  sera: "será",
  tera: "terá",
};

const INFINITIVE_CRASE = `(?<target>à)${S}(?<verb>\\p{L}+(?:ar|er|ir))${W}`;

// Words that govern "a": locutions, nouns, adjectives and verbs. Before a feminine noun the
// article fuses with it: "devido a falta" -> "à falta", "acesso as armas" -> "às armas". "quanto
// a" only opening a clause ("tanto quanto a irmã" compares).
const GOVERNS_A = [
  `devido|graças|junto|rumo|frente|face|em${S}relação|com${S}relação|em${S}direção|em${S}frente`,
  "referentes?|relativ[oa]s?|equivalentes?|superior(?:es)?|inferior(?:es)?|semelhantes?",
  "anterior(?:es)?|posterior(?:es)?|favorá(?:vel|veis)|propens[oa]s?|acesso|referência|alusão",
  "obediência|resistência|aversão|adesão|homenagem|apoio|aderir|adere|aderem|aderiu|aderiram",
  "pertencer|pertence|pertencem|pertencia|pertenciam|pertenceu|recorrer|recorre|recorrem",
  "recorreu|recorreram|equivaler|equivale|equivalem|equivalia|corresponder|corresponde",
  "correspondem|correspondia",
  "(?:referir|refere|referem|referiu|dirigir|dirige|dirigiu|dirigiram|candidatar|candidata|candidatou|candidataram)-se",
  `se${S}(?:referir|refere|referem|referiu|dirigir|dirige|dirigiu|dirigiram|candidatar|candidata|candidatou|candidataram)`,
].join("|");
const GOVERNED_ARTICLE = `(?<lead>${GOVERNS_A}|quanto)${S}(?:\\p{L}{3,16}mente${S})?(?<target>as?)${S}(?<noun>\\p{L}{3,})${W}(?!-)`;
const GOES_TO = `(?:${GOES})${S}(?<target>as?)${S}(?=(?:${DESTINATIONS})s?${W})`;
// "à Sua Excelência": forms of address take no article.
const ADDRESS = `(?<target>às?)${S}(?=(?:sua|vossa|suas|vossas)${S}(?:excelência|majestade|santidade|senhoria|alteza|eminência|magnificência|reverendíssima|excelências|majestades|santidades|senhorias|altezas|eminências|beatitudes?)${W})`;
// "à uma corrida", but "à uma hora", "à uma e meia".
const A_UMA = `(?<target>à)${S}(?=uma${W}(?!${S}(?:hora|e|da|em${S}ponto)${W}|[ \\t\\u00a0]*h))`;
// A sum of money has no article: "equivale à R$ 35".
const MONEY = `(?<target>à)${S}(?=(?:R\\$|US\\$|€|\\$))`;
const CLAUSE_BEFORE = /(?:^|[.!?:;][ \t\r\n "”»)]{0,8}|\n[ \t ]{0,8})$/;

export function confusions(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  const push = (m: RegExpExecArray, alternatives: string[], messageKey: ReviewMessageKey): void => {
    const [start, end] = m.indices!.groups!.target;
    const typed = ctx.text.slice(start, end);
    if (ctx.dictionary.has(typed.toLowerCase())) return;
    findings.push({
      ruleId: "portugueseConfusions",
      messageKey,
      range: { start, end },
      alternatives: alternatives.map((alt) => applyWordCase(alt, detectWordCase(typed))),
      context: { start: m.index, end: Math.max(end, m.index + m[0].length) },
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    });
  };
  for (const frame of ALL_FRAMES) {
    for (const m of frameMatches(ctx, frame.pattern)) {
      if (
        frame.clauseStart &&
        !CLAUSE_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))
      )
        continue;
      // Frames are matched ignoring case; a capitalized name inside one is not prose.
      if (/\s\p{Lu}/u.test(m[0])) continue;
      if (frame.capitalized && !/^\p{Lu}/u.test(m.groups!.target)) continue;
      const alternatives =
        typeof frame.alternatives === "function"
          ? frame.alternatives(m.groups!.target)
          : frame.alternatives;
      push(m, alternatives, frame.messageKey);
    }
  }
  for (const m of frameMatches(ctx, GOVERNED_ARTICLE)) {
    const { lead, target, noun } = m.groups!;
    if (
      /^quanto$/i.test(lead) &&
      !CLAUSE_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))
    )
      continue;
    if (noun !== noun.toLowerCase()) continue;
    const analysis = analyze(noun);
    if (!analysis?.feminine || analysis.plural !== (target.length === 2)) continue;
    push(m, [target.length === 2 ? "às" : "à"], "review_msg_pt_crase");
  }
  for (const m of frameMatches(ctx, GOES_TO))
    push(m, [m.groups!.target.toLowerCase() === "as" ? "às" : "à"], "review_msg_pt_crase");
  for (const pattern of [ADDRESS, A_UMA, MONEY])
    for (const m of frameMatches(ctx, pattern)) push(m, ["a"], "review_msg_pt_crase");
  for (const m of frameMatches(ctx, INFINITIVE_CRASE)) {
    if (FEMININE_R.has(m.groups!.verb) || ctx.dictionary.has(m.groups!.verb)) continue;
    push(m, ["a"], "review_msg_pt_crase");
  }
  return findings;
}
