import { finding } from "../finding";
import { alternation, frameMatches, isLang, SPACE as S, WORD_END as W } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { conjugate } from "./style";

/**
 * Opt-in formal register (stylePhrasing): a plain or colloquial verb that has a formal
 * equivalent in the same sense. Each swap names the complement that selects that sense:
 * "baixar o preço" -> "reduzir", but "baixar o arquivo" stays; "pegar uma gripe" ->
 * "contrair", "pegar os dados" -> "obter". The formal verb takes the tense and person of the
 * typed one. Also "uma boa questão" -> "uma questão pertinente".
 */

type Swap = {
  verbs: string[];
  formal: string[];
  /** What follows the verb (a lookahead); it selects the sense. */
  complement: string;
  /** Words after the verb that the formal verb replaces too: "jogar fora" -> "descartar". */
  inside?: string;
  /** Statements only: "Você acha que…?" asks for the reader's view in any register. */
  statement?: true;
};

const DET = `(?:(?:[oa]s?|um|uma|uns|umas|seus?|suas?|nossos?|nossas?|esses?|essas?|estes?|estas?|meus?|minhas?)${S})?`;
const SOME = `(?:(?:grandes|várias|vários|muitas|muitos|sérias|sérios|algumas|alguns|enormes|tantas|poucas)${S})?`;
const nouns = (list: string) => `${S}${DET}${SOME}(?:${list})${W}`;

const PREPOSITION = `(?<of>de|d[oa]s?|n[oa]s?|em|sobre${S}[oa]s?|sobre)`;
const ARTICLE: Record<string, string> = { o: " o", a: " a", os: " os", as: " as" };
// A verb form after a determiner is a noun: "a bota", "a fala", "o passo".
const NOT_AFTER = `(?<!(?:^|[^\\p{L}])(?:[oa]s?|d[oa]s?|n[oa]s?|uma?|uns|umas|seus?|suas?|ess[ea]s?|est[ea]s?|meus?|minhas?)${S})`;

const SWAPS: Swap[] = [
  // "Acho que" gives an opinion; formal prose considers or judges.
  {
    verbs: ["achar"],
    formal: ["considerar", "julgar", "pensar"],
    complement: `${S}que${W}`,
    statement: true,
  },
  {
    verbs: ["baixar"],
    formal: ["reduzir"],
    complement: nouns(
      "preços?|custos?|doses?|dosagens?|dosagem|nível|níveis|taxas?|juros|impostos?|gastos|despesas|consumo|velocidade|temperatura|tarifas?|salários?",
    ),
  },
  {
    verbs: ["passar"],
    formal: ["passar por", "enfrentar"],
    complement: nouns("dificuldades|necessidades|privações|apuros|apertos?"),
  },
  {
    verbs: ["pegar"],
    formal: ["obter"],
    complement: nouns(
      "dados|informaç(?:ão|ões)|resultados|documentos|certidão|certidões|autorizaç(?:ão|ões)",
    ),
  },
  {
    verbs: ["pegar"],
    formal: ["contrair"],
    complement: nouns("gripes?|doenças?|vírus|infecç(?:ão|ões)|resfriados?|covid|dengue|sarampo"),
  },
  {
    verbs: ["pegar"],
    formal: ["tomar"],
    complement: nouns("ônibus|metrô|trens?|aviões|avião|táxis?|voos?|barcos?"),
  },
  {
    verbs: ["arrumar"],
    formal: ["conseguir"],
    complement: nouns("empregos?|trabalhos?|vagas?|estágios?"),
  },
  {
    verbs: ["fazer"],
    formal: ["elaborar"],
    complement: nouns(
      "planos?|relatórios?|orçamentos?|projetos?|cronogramas?|pareceres|parecer|resumos?",
    ),
  },
  // "não deixe que ele saia": letting is permitting.
  { verbs: ["deixar"], formal: ["permitir"], complement: `${S}que${W}` },
  {
    verbs: ["pedir"],
    formal: ["solicitar"],
    complement: nouns(
      "informaç(?:ão|ões)|documentos?|autorizaç(?:ão|ões)|permissão|esclarecimentos?|orçamentos?|reembolsos?|licença|apoio",
    ),
  },
  {
    verbs: ["chatear"],
    formal: ["incomodar", "importunar"],
    complement: `(?:${S}(?:(?:mais|tanto)${S})?(?:[oa]s?|me|te|nos|lhe|lhes|ninguém|você|vocês|seus?|suas?)${W}|-(?:me|te|nos|lhe|lhes|o|a|os|as)${W})`,
  },
  {
    verbs: ["aturar"],
    formal: ["suportar", "tolerar"],
    complement: `(?:${S}\\p{L}|-(?:me|te|nos|o|a|os|as)${W})`,
  },
  {
    verbs: ["botar"],
    formal: ["colocar", "pôr"],
    complement: `${S}(?:[oa]s?|um|uma|isso|tudo|me|se)${W}`,
  },
  { verbs: ["jogar"], formal: ["descartar"], inside: "fora", complement: W },
  // "fala das questões" -> "aborda as questões".
  {
    verbs: ["falar"],
    formal: ["abordar"],
    inside: PREPOSITION,
    complement: `${S}(?:${SOME}|(?:outr[oa]s?|vári[oa]s|tod[oa]s|ess[ea]s?|est[ea]s?)${S})?(?:temas?|assuntos?|questão|questões|problemas?|tópicos?)${W}`,
  },
  {
    verbs: ["mexer"],
    formal: ["alterar"],
    inside: PREPOSITION,
    complement: `${S}(?:códigos?|arquivos?|configuraç(?:ão|ões)|sistemas?|documentos?|textos?|contratos?|planilhas?)${W}`,
  },
];

const COMPILED = SWAPS.map((swap) => {
  const slots = new Map<string, number>();
  for (const verb of swap.verbs)
    conjugate(verb).forEach((form, slot) => slots.has(form) || slots.set(form, slot));
  const head = `${NOT_AFTER}(?<head>${alternation(slots.keys())})`;
  const inside = swap.inside ? `${S}${swap.inside}` : "";
  const pattern = `(?<target>${head}${inside})(?=${swap.complement})`;
  return { swap, slots, pattern };
});

/** Fixed phrases with a formal form: a pattern with a `target` group and its replacement. */
const FIXED: Array<[string, string]> = [
  // "sob o ponto de vista" mixes "sob o prisma" and "do ponto de vista".
  [`(?<target>sob${S}o)${S}(?=ponto${S}de${S}vista${W})`, "do"],
  // "é suposto que" copies "it is supposed that".
  [`(?<target>é${S}suposto)${S}(?=que${W})`, "supõe-se"],
  // "segundo combinado" -> "conforme combinado": "segundo" takes a noun phrase.
  [
    `${NOT_AFTER}(?<target>segundo)${S}(?=(?:combinad|acordad|previst|solicitad|informad|estabelecid|planejad|programad|anunciad)[oa]s?${W})`,
    "conforme",
  ],
  [`(?<target>(?:à|em)${S}volta)${S}(?=d[eoa]s?${W})`, "em torno"],
];

// "uma boa questão" -> "uma questão pertinente"; "a questão é boa" -> "pertinente".
const POINT = "questão|questões|argumento|argumentos|pergunta|perguntas|observação|observações";
const GOOD: Record<string, string> = { bom: "", boa: "", bons: "s", boas: "s" };
const GOOD_BEFORE = `(?<=(?:um|uma|uns|umas|que|muito|muita|muitos|muitas|tão)${S})(?<target>(?<good>boa|bom|boas|bons)${S}(?<noun>${POINT}))${W}`;
const GOOD_AFTER = `(?:${POINT})${S}(?:(?:é|são|foi|foram|era|eram|me${S}parece|parece|parecem)${S})?(?:(?:muito|bem|bastante|realmente)${S})?(?<target>boa|bom|boas|bons)(?=[ \\t\\u00a0]*[.,;!?]|$)`;

export function formalVerbs(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  const typed = (m: RegExpExecArray) => m.groups!.target;
  const push = (m: RegExpExecArray, alternatives: string[]) => {
    const [start, end] = m.indices!.groups!.target;
    if (
      typed(m)
        .split(/[ \t ]+/)
        .some((word) => ctx.dictionary.has(word.toLowerCase()))
    )
      return;
    if (/^\p{Lu}/u.test(typed(m)))
      alternatives = alternatives.map((alt) => alt[0].toUpperCase() + alt.slice(1));
    findings.push(
      finding("stylePhrasing", "review_msg_style_phrasing", start, end, alternatives, {
        ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
      }),
    );
  };
  for (const { swap, slots, pattern } of COMPILED) {
    for (const m of frameMatches(ctx, pattern)) {
      const { head, of } = m.groups!;
      // A capital after the first word is a name.
      if (head !== head.toLowerCase() && !/^\p{Lu}\p{Ll}*$/u.test(head)) continue;
      const slot = slots.get(head.toLowerCase());
      if (slot === undefined) continue;
      if (swap.statement && /^[^.!?\n]*\?/.test(ctx.text.slice(m.index, m.index + 200))) continue;
      const article = of ? (ARTICLE[of.toLowerCase().replace(/^(?:d|n|sobre\s+)/, "")] ?? "") : "";
      push(
        m,
        swap.formal.map((verb) => {
          const [first, ...rest] = verb.split(" ");
          return [conjugate(first)[slot], ...rest].join(" ") + article;
        }),
      );
    }
  }
  for (const [pattern, replacement] of FIXED)
    for (const m of frameMatches(ctx, pattern)) push(m, [replacement]);
  for (const m of frameMatches(ctx, GOOD_BEFORE)) {
    const plural = GOOD[m.groups!.good.toLowerCase()];
    push(m, [`${m.groups!.noun} pertinente${plural}`, `${m.groups!.noun} relevante${plural}`]);
  }
  for (const m of frameMatches(ctx, GOOD_AFTER)) {
    const plural = GOOD[typed(m).toLowerCase()];
    push(m, [`pertinente${plural}`, `relevante${plural}`]);
  }
  return findings;
}
