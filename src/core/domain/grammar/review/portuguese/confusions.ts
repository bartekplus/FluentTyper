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
  alternatives: string[];
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
const SUBJECT =
  "(?:ele|ela|você|eles|elas|vocês|isso|isto|tudo|não|nunca|já|ainda|quem|onde|como|ninguém|alguém|também|sempre)";
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

const FRAMES: Frame[] = [
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
      push(m, frame.alternatives, frame.messageKey);
    }
  }
  for (const m of frameMatches(ctx, INFINITIVE_CRASE)) {
    if (FEMININE_R.has(m.groups!.verb) || ctx.dictionary.has(m.groups!.verb)) continue;
    push(m, ["a"], "review_msg_pt_crase");
  }
  return findings;
}
