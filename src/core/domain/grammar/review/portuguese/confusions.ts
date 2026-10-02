import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { ReviewMessageKey } from "../types";

/**
 * Portuguese words that sound alike or differ by one accent, told apart by the
 * words around them: crase (à/a/há), por que/porque/por quê/porquê, é/e,
 * está/esta, dá/da, dê/de, houve/ouve, pôr/por. Every frame names its evidence.
 */

type Frame = {
  /** Compiled by frameMatches (WORD_START, `gidu`); `target` is replaced. */
  pattern: string;
  /** Replacements, or a function of the typed target. */
  alternatives: string[] | ((typed: string) => string[]);
  messageKey: ReviewMessageKey;
  /** Starts a sentence (or follows a line break). */
  clauseStart?: true;
};

const W = WORD_END;
const S = SPACE;
const words = (list: string) => `(?:${list})${W}`;

// Infinitives look like these nouns and adjectives, which can follow a crase ("à mulher").
const FEMININE_R = new Set(
  "mulher colher militar titular auxiliar familiar circular similar celular escolar popular particular exemplar singular regular preliminar complementar lunar solar polar nuclear secular vulgar peculiar hospitalar curricular disciplinar".split(
    " ",
  ),
);
const SPAN = words("anos|meses|semanas|dias|séculos|décadas|minutos|segundos");
const AMOUNT = `(?:(?:quase|uns|umas|alguns|algumas|muitos|muitas|poucos|poucas|vários|várias|cerca${S}de|mais${S}de|menos${S}de|\\d+|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta|cem)${W}${S})`;
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
const INFINITIVE_AHEAD = `\\p{Ll}+[aeiô]r(?:em|mos|es)?${WORD_END}`;
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
  "(?:bem|mal|certo|certa|errado|errada|pronto|pronta|ótimo|ótima|cheio|cheia|cansado|cansada|feliz|triste|doente|ocupado|ocupada|com|sem|em|no|na|nos|nas|muito|tão|sendo|quase|perto|longe|frio|quente|melhor|pior)";

// "a" fused with the article that follows it.
const WITH_A: Record<string, string> = { o: "ao", a: "à", os: "aos", as: "às" };
const SHOWS =
  "filmes?|jogos?|programas?|shows?|espetáculos?|aulas?|novelas?|séries?|vídeos?|partidas?|apresentaç(?:ão|ões)|peças?|concertos?|palestras?|missas?|desfiles?|televisão|tv|telejornal|final|finais|corrida|luta|treino|ensaio";
// After these "a" is the bare preposition ("assistir a uma aula", "obedecer a
// leis"), or the crase is optional ("obedecer a sua mãe"); "o" and "os" are always the article.
const NOT_ARTICLE_NEXT =
  "(?!\\p{Ll}+s(?![\\p{L}]))(?!(?:um|uma|uns|umas|est[ea]s?|ess[ea]s?|aquel[ea]s?|tod[oa]s?|cada|qualquer|nenhum|nenhuma|cert[oa]s?|vári[oa]s|muit[oa]s?|pouc[oa]s?|dois|duas|três|seus?|suas?|meus?|minhas?|teus?|tuas?|nossos?|nossas?)(?![\\p{L}]))";
const ASSISTIR =
  "assist(?:o|e|es|imos|em|i|iu|iram|ia|iam|ir|indo|irei|irá|iremos|irão|iria|iriam|a|am)";
const OBEDECER =
  "(?:des)?obedec(?:e|em|emos|i|eu|eram|ia|iam|er|endo|erei|erá|eremos|erão|eria|eriam)|(?:des)?obedeço|(?:des)?obedeça|(?:des)?obedeçam";
const PREFERIR =
  "prefiro|prefere|preferes|preferimos|preferem|preferia|preferiam|preferiria|preferiríamos|preferi|preferiu|preferiram|preferir|preferível";

const FRAMES: Frame[] = [
  // "assistir ao filme" (to watch); "assistir o paciente" (to help) keeps its object.
  {
    pattern: `${ASSISTIR}${S}(?<target>os?|as?(?=${S}${NOT_ARTICLE_NEXT}))${S}(?=(?:\\p{Ll}+${S})?(?:${SHOWS})${W})`,
    alternatives: (typed) => [WITH_A[typed.toLowerCase()]],
    messageKey: "review_msg_pt_regency",
  },
  // "obedecer aos pais", "desobedecer à lei".
  {
    pattern: `(?:${OBEDECER})${S}(?<target>os?|as?(?=${S}${NOT_ARTICLE_NEXT}))${S}(?=\\p{Ll}{2,})`,
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
    pattern: `(?<target>esta)${S}(?=(?:\\p{Ll}{2,}(?:ado|ido)|coberto|aberto|feito|morto|escrito|pronto|cheio|vazio|certo|bom|ótimo|lindo|frio|quente|limpo|sujo|seco|novo|velho)${W})`,
    alternatives: ["está"],
    messageKey: "review_msg_pt_homophone",
  },
  // "poço" (well) before an infinitive or an object pronoun is "posso" (I can).
  {
    pattern: `(?<!(?:o|um|do|no|ao|pelo|esse|este|aquele|seu|meu|nosso|teu|cada|algum|nenhum|qualquer|grande|pequeno|fundo|velho)${S})(?<target>poço)${S}(?=(?:me|te|lhe|lhes|nos|vos|se|\\p{Ll}+[aeiô]r)${W})`,
    alternatives: ["posso"],
    messageKey: "review_msg_pt_homophone",
  },
  // "várias" (several) before a plural noun; "varias" is "you vary".
  {
    pattern: `(?<!tu${S}(?:não${S})?)(?<target>varias)${S}(?=(?!(?:os|as|nos|vos|mais|menos|vezes${S}de)${W})\\p{Ll}{2,}s${W})`,
    alternatives: ["várias"],
    messageKey: "review_msg_pt_homophone",
  },
  // "até" (until, even) before an article, a place or a time word; "ate" is a form of "atar".
  {
    pattern: `(?<!(?:que|se|quando|embora|talvez|caso)${S}(?:\\p{Ll}+${S})?)(?<target>ate)${S}(?=(?:o|a|os|as|ao|aos|à|às|aqui|ali|lá|onde|quando|minha|meu|sua|seu|nossa|nosso|\\d)${W})`,
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
    pattern: `(?:é|era|foi|será|seria|são|eram)${S}para${S}(?<target>mim)${S}(?=${INFINITIVE_AHEAD})`,
    alternatives: ["eu"],
    messageKey: "review_msg_pt_pronoun_case",
  },
  {
    pattern: `(?<=(?:^|[.!?;:][ \\t\\u00a0]{0,8}|\\n[ \\t\\u00a0]{0,8}))para${S}(?<target>mim)${S}(?=${INFINITIVE_AHEAD})`,
    alternatives: ["eu", "mim,"],
    messageKey: "review_msg_pt_pronoun_case",
  },
  // Crase: "à" before a span of time is "há" (it existed), after "daqui" plain "a".
  {
    pattern: `(?<!daqui${S})(?<target>à)${S}${AMOUNT}?${SPAN}`,
    alternatives: ["há"],
    messageKey: "review_msg_pt_crase",
  },
  {
    pattern: `(?<target>à)${S}(?:muito|pouco|bastante|algum|tanto)${S}tempo${W}`,
    alternatives: ["há"],
    messageKey: "review_msg_pt_crase",
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
    pattern: `(?<target>à)${S}(?!(?:mais|menos|demais|vezes|trois)${W})\\p{Ll}{2,}(?:as|os|es|ns|is|ões|ães)${W}`,
    alternatives: ["a"],
    messageKey: "review_msg_pt_crase",
  },
  // "por quê" closes a question; before more words it is "por que" (or "porque").
  {
    pattern: `(?<!(?:o|um|nenhum|seu|qualquer)${S})(?<target>por${S}quê)${S}(?=\\p{Ll})`,
    alternatives: ["por que", "porque"],
    messageKey: "review_msg_pt_por_que",
  },
  // "porque?" and "por que?" at the end of a question are "por quê?".
  {
    pattern: `(?<!(?:o|um|nenhum|seu|qualquer)${S})(?<target>porque|por${S}que)(?=[ \\t\\u00a0]{0,2}\\?)`,
    alternatives: ["por quê"],
    messageKey: "review_msg_pt_por_que",
  },
  // The noun is "porquê": "o porquê de tudo", "nenhum porquê".
  {
    pattern: `(?:o|um|nenhum|seu|qualquer)${S}(?<target>porque|por${S}que|por${S}quê)(?=[ \\t\\u00a0]{0,2}[.,;:!?]|${S}(?:de|da|do|das|dos)${W})`,
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
    pattern: `(?<target>esta)${S}(?!segundo${W})(?=\\p{Ll}+[aei]ndo${W})`,
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
    pattern: `${CLITIC}${S}(?<target>da)${S}(?=\\p{Ll})`,
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
    pattern: `que${S}(?:você|ele|ela|eles|elas|vocês|o${S}\\p{Ll}+|a${S}\\p{Ll}+)${S}(?<target>de)${S}(?:mais${S}|uma${S}(?=(?:chance|dica|olhada|mão|força|ajuda|resposta|oportunidade)${W}))?(?:crédito|atenção|valor|importância|licença|chance|razão|confiança|ouvidos|sorte|dica|olhada|mão|força|ajuda|resposta|oportunidade)${W}`,
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
    pattern: `(?<target>encima)${S}(?:de|da|do|das|dos|dele|dela|deles|delas|disso|disto|daquel\\p{Ll}*)${W}`,
    alternatives: ["em cima"],
    messageKey: "review_msg_pt_homophone",
  },
  {
    pattern: `(?:aqui|ali|lá|cá|aí|está|estava|ficou|pôs|caiu|subiu)${S}(?<target>encima)(?=[ \\t\\u00a0]{0,2}[.,;!?])`,
    alternatives: ["em cima"],
    messageKey: "review_msg_pt_homophone",
  },
  // "pôr" (to put) after a modal: "por" + article would contract to "pelo".
  {
    pattern: `${MODAL}${S}(?<target>por)${S}(?:o|a|os|as|em|termo|ordem)${W}`,
    alternatives: ["pôr"],
    messageKey: "review_msg_pt_homophone",
  },
];

const INFINITIVE_CRASE = `(?<target>à)${S}(?<verb>\\p{Ll}+(?:ar|er|ir))${W}`;
const CLAUSE_BEFORE = /(?:^|[.!?:;][ \t\r\n "”»)]{0,8}|\n[ \t ]{0,8})$/;

export function confusions(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
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
  for (const frame of FRAMES) {
    for (const m of frameMatches(ctx, frame.pattern)) {
      if (
        frame.clauseStart &&
        !CLAUSE_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))
      )
        continue;
      // Frames are matched ignoring case; a capitalized name inside one is not prose.
      if (/\s\p{Lu}/u.test(m[0])) continue;
      const alternatives =
        typeof frame.alternatives === "function"
          ? frame.alternatives(m.groups!.target)
          : frame.alternatives;
      push(m, alternatives, frame.messageKey);
    }
  }
  for (const m of frameMatches(ctx, INFINITIVE_CRASE)) {
    if (FEMININE_R.has(m.groups!.verb) || ctx.dictionary.has(m.groups!.verb)) continue;
    push(m, ["a"], "review_msg_pt_crase");
  }
  return findings;
}
