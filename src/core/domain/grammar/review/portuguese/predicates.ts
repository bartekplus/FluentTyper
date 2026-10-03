import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { TIME } from "./agreement";
import { analyze } from "./nounAgreement";
import { verbStems } from "./subjunctive";
import { finding } from "../finding";

/**
 * An adjective after "ser", "estar", "ficar" or "parecer" agrees with the subject opening the
 * sentence: "A palavra está correto" -> "correta", "Elas são altos" -> "altas". The subject is
 * a pronoun of known gender, or an article and a noun whose gender its spelling tells. After
 * "ser" a bare noun may follow ("A cidade é palco de"), so only listed adjectives count there;
 * after "estar" and "ficar" participles count too ("A porta está fechado").
 */

const S = SPACE;
const W = WORD_END;

const ADJECTIVE_STEMS = new Set(
  `corret errad cert bonit fei alt baix gord magr pront nov velh chei vazi ric lind car barat limp
  suj abert quiet calm nervos ansios sóbri séri perfeit complet incomplet curt long larg estreit
  branc pret vermelh amarel rox escur clar fri sec molhad salgad gostos delicios famos perigos
  segur sozinh viv mort simpátic antipátic rápid lent pequen únic rar estranh esquisit chat
  obrigatóri necessári proibid ótim péssim maravilhos brav furios satisfeit orgulhos louc maluc
  tranquil exaust surpres curios confus distraíd preocupad ocupad cansad animad apaixonad casad
  solteir atrasad preparad convencid encantad lotad assustad envergonhad zangad irritad
  emocionad chatead decepcionad contrári honest sincer generos teimos preguiços ciumen
  agressiv atent educad grat`.split(/\s+/),
);
const COPULAS = {
  ser: "é|são|era|eram|foi|foram|será|serão|seria|seriam|parece|parecem|parecia|pareciam",
  estar:
    "está|estão|estava|estavam|esteve|estiveram|estará|estarão|estaria|estariam|fica|ficam|ficou|ficaram|ficava|ficavam|ficará|ficarão|continua|continuam|continuava|permanece|permanecem",
};
const ADVERBS = `(?:(?:muito|bem|tão|bastante|meio|super|mais|menos|sempre|já|ainda|realmente|totalmente|completamente|demasiado|um${S}pouco)${S}){0,2}`;
const PRONOUN = "ele|ela|eles|elas";
const ARTICLE = "o|a|os|as";
const SUBJECT = `(?:(?<pronoun>${PRONOUN})|(?<article>${ARTICLE})${S}(?<noun>\\p{Ll}{3,}))`;
const PATTERN = `${SUBJECT}${S}(?:não${S})?(?<copula>${COPULAS.ser}|${COPULAS.estar})${S}${ADVERBS}(?<target>\\p{Ll}{3,}[oa]s?)${W}(?![-\\p{L}])`;
const SENTENCE_START = /(?:^|[.!?;:\n]["'”’»)]*)[ \t ]*["'“‘«(]?[ \t ]*$/u;
// What may follow a predicate adjective: the end of the clause or a word that cannot be its noun.
const CLAUSE_GOES_ON =
  /^(?:[ \t\u00a0]*(?:[.,;:!?)"”»…]|$)|[ \t\u00a0]+(?:e|ou|mas|de|do|da|dos|das|com|para|pra|em|no|na|nos|nas|por|pelo|pela|a|ao|à|aos|às|hoje|agora|ontem|amanhã|demais|também|ainda|sempre|que|quando|porque|pois|se|como|depois|antes|aqui|ali|lá|mesmo|logo|desde|até|sem|nesta|neste|nessa|nesse)(?![\p{L}]))/u;
// Nouns spelled like a participle, which follow "ser" bare: "A crise é resultado de".
const NOUNS_IN_DO = new Set(
  `resultad estad mercad soldad advogad deputad delegad cuidad pecad legad recad significad
  partid sentid pedid ruíd tecid marid vestid ouvid apelid bocad dad lad prad gad fad senad
  reinad eleitorad mandad atentad cunhad namorad aliad comunicad atestad diplomad doutorad
  mestrad feriad ditad sobrad telhad gramad machad bordad`.split(/\s+/),
);
// "A gente está cansado": "a gente" is "we".
const NOT_SUBJECT = new Set(["gente", "maioria", "minoria", "metade", "parte", "porcentagem"]);

export function subjectPredicates(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PATTERN)) {
    const { pronoun, article, noun, copula, target } = m.groups!;
    if (!SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))) continue;
    if (target !== target.toLowerCase() || ctx.dictionary.has(target)) continue;
    let feminine: boolean;
    let plural: boolean;
    if (pronoun) {
      if (pronoun.slice(1) !== pronoun.slice(1).toLowerCase()) continue;
      feminine = /^elas?$/i.test(pronoun);
      plural = /s$/i.test(pronoun);
    } else {
      if (noun !== noun.toLowerCase() || NOT_SUBJECT.has(noun)) continue;
      const info = analyze(noun);
      if (!info || info.feminine === null) continue;
      feminine = info.feminine;
      plural = info.plural;
      // The article agrees with its noun, or the subject is not what it seems.
      if (/a/i.test(article) !== feminine || /s$/i.test(article) !== plural) continue;
    }
    const stem = target.replace(/[oa]s?$/, "");
    const participle = /\p{Ll}{2}(?:ad|id)$/u.test(stem) && !NOUNS_IN_DO.has(stem);
    // "são ótimos indicadores": an adjective before its noun is no predicate.
    const [, targetEnd] = m.indices!.groups!.target;
    if (!CLAUSE_GOES_ON.test(ctx.text.slice(targetEnd, targetEnd + 24))) continue;
    if (!ADJECTIVE_STEMS.has(stem) && !participle) continue;
    const wanted = `${stem}${feminine ? "a" : "o"}${plural ? "s" : ""}`;
    if (wanted === target) continue;
    // A plural copula with a singular subject (or back) is verbAgreement's to fix.
    if (/(?:ão|am|em)$/.test(copula) !== plural) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "portugueseAgreement",
      messageKey: "review_msg_pt_noun_agreement",
      range: { start, end },
      alternatives: [applyWordCase(wanted, detectWordCase(target))],
      context: { start: m.index, end },
    });
  }
  return findings;
}

// "a razão pelo qual" -> "pela qual": "o/a qual" agrees with the noun right before it.
const RELATIVE = `(?<noun>\\p{Ll}{3,})${S}(?<target>(?<prep>pel|n|d|a|à)(?<article>o|a|os|as)?)${S}(?<qual>qual|quais)${W}`;
const PREPOSITION_FORMS: Record<string, string[]> = {
  pel: ["pelo", "pela", "pelos", "pelas"],
  n: ["no", "na", "nos", "nas"],
  d: ["do", "da", "dos", "das"],
  a: ["ao", "à", "aos", "às"],
};

// Pronominal verbs that govern "a": "Refere-se as práticas" lacks a crase, the noun is no subject.
const GOVERNS_A_SE = new Set(
  "refere dirige candidata dedica submete adapta acostuma habitua apega destina resume limita restringe assemelha equipara alia".split(
    " ",
  ),
);
const PASSIVE_SE = `(?<verb>\\p{Ll}{3,}[ae])-se${S}(?:(?<det>os|as|muitos|muitas|vários|várias|alguns|algumas|novos|novas|diversos|diversas|\\d+)${S})?(?<noun>\\p{Ll}{3,}s)${W}`;

export function relativeAgreement(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, RELATIVE)) {
    const { noun, target, qual } = m.groups!;
    if (noun !== noun.toLowerCase() || target !== target.toLowerCase()) continue;
    const row = Object.values(PREPOSITION_FORMS).find((forms) => forms.includes(target));
    if (!row) continue;
    const info = analyze(noun);
    if (!info || info.feminine === null) continue;
    // "o estudo ou a metodologia pelo qual": a coordinated noun may be the antecedent.
    const before = ctx.text.slice(Math.max(0, m.index - 30), m.index);
    if (/(?:^|[^\p{L}])(?:ou|e)[ \t\u00a0]+(?:\p{L}+[ \t\u00a0]+)?$/u.test(before)) continue;
    // "quais" is plural and "qual" singular: they must match the article already.
    if ((qual === "quais") !== info.plural) continue;
    const wanted = row[(info.plural ? 2 : 0) + (info.feminine ? 1 : 0)];
    if (wanted === target) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push(
      finding("portugueseAgreement", "review_msg_pt_noun_agreement", start, end, [wanted], {
        context: { start: m.index, end: m.index + m[0].length },
      }),
    );
  }
  // "Vende-se casas" -> "Vendem-se casas": with "se" the plural noun after the verb is its
  // subject. "Precisa-se de", "Trata-se de" have none.
  for (const m of frameMatches(ctx, PASSIVE_SE, "verb")) {
    const { verb, noun, det } = m.groups!;
    if (verb.slice(1) !== verb.slice(1).toLowerCase() || noun !== noun.toLowerCase()) continue;
    const info = analyze(noun);
    if (!info?.plural || info.feminine === null) continue;
    if (!det && !info.certain && !/[ao]s$/.test(noun)) continue;
    if (new RegExp(`^(?:${TIME})$`).test(noun)) continue;
    // A present tense of an everyday verb: not "houve-se", nor "leia-se" (read as).
    const lower = verb.toLowerCase();
    if (GOVERNS_A_SE.has(lower)) continue;
    const { ar, er, ir } = verbStems();
    const stem = lower.slice(0, -1);
    if (!(lower.endsWith("a") ? ar.has(stem) : er.has(stem) || ir.has(stem))) continue;
    const [start, end] = m.indices!.groups!.verb;
    findings.push({
      ruleId: "portugueseAgreement",
      messageKey: "review_msg_pt_agreement",
      range: { start, end },
      alternatives: [`${verb}m`].map((wanted) => applyWordCase(wanted, detectWordCase(verb))),
      context: { start: m.index, end: m.index + m[0].length },
    });
  }
  return findings;
}

// "Estamos muitos contentes" -> "muito contentes", "Ela está meia cansada" -> "meio cansada":
// before an adjective "muito" and "meio" are adverbs.
const QUANTIFIED = `(?:${COPULAS.ser}|${COPULAS.estar}|somos|estamos|ficamos|fomos|éramos|estávamos)${S}(?<target>muit[oa]s|pouc[oa]s|muita|pouca|demasiad[oa]s?|bastantes|meias?)${S}(?<adjective>\\p{Ll}{3,}[oa]s?|contentes|felizes|tristes|alegres|doentes|inteligentes|diferentes|ansiosos)${W}`;

export function quantifiedAdjectives(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, QUANTIFIED)) {
    const { target, adjective } = m.groups!;
    if (target !== target.toLowerCase() || adjective !== adjective.toLowerCase()) continue;
    const stem = adjective.replace(/[oa]s?$/, "");
    // After "ser" a participle may be a noun: "São muitos interessados".
    const participle =
      /\p{Ll}{2}(?:ad|id)$/u.test(stem) &&
      !NOUNS_IN_DO.has(stem) &&
      !/^(?:é|são|era|eram|foi|foram|será|serão|seria|seriam|somos|fomos|éramos)\s/iu.test(m[0]);
    if (!ADJECTIVE_STEMS.has(stem) && !participle && !/es$/.test(adjective)) continue;
    const [, end] = m.indices!.groups!.adjective;
    if (!CLAUSE_GOES_ON.test(ctx.text.slice(end, end + 24))) continue;
    const wanted = target.startsWith("muit")
      ? "muito"
      : target.startsWith("pouc")
        ? "pouco"
        : target.startsWith("demasiad")
          ? "demasiado"
          : target.startsWith("meia")
            ? "meio"
            : "bastante";
    const [start, targetEnd] = m.indices!.groups!.target;
    findings.push(
      finding("portugueseAgreement", "review_msg_pt_noun_agreement", start, targetEnd, [wanted], {
        context: { start: m.index, end },
      }),
    );
  }
  return findings;
}

// "duas milhões" -> "dois", "as milhares de" -> "os": milhão, bilhão and milhar are masculine
// nouns, so the words before them are too ("duas mil" agrees with the noun after "mil").
// "a milhares de quilômetros" keeps the preposition "a".
const MASCULINE_OF: Record<string, string> = {
  uma: "um",
  duas: "dois",
  duzentas: "duzentos",
  trezentas: "trezentos",
  quatrocentas: "quatrocentos",
  quinhentas: "quinhentos",
  seiscentas: "seiscentos",
  setecentas: "setecentos",
  oitocentas: "oitocentos",
  novecentas: "novecentos",
  as: "os",
  das: "dos",
  nas: "nos",
  pelas: "pelos",
  estas: "estes",
  essas: "esses",
  aquelas: "aqueles",
  muitas: "muitos",
  várias: "vários",
  algumas: "alguns",
  tantas: "tantos",
  poucas: "poucos",
  outras: "outros",
};
const PLURAL_FEMININE = Object.keys(MASCULINE_OF)
  .filter((word) => word !== "uma")
  .join("|");
const MILLIONS = `(?<target>${PLURAL_FEMININE})${S}(?=(?:milhões|bilhões|trilhões|milhares)${W})|(?<one>uma)${S}(?=(?:milhão|bilhão|trilhão|milhar)${W})`;
// "muitos poucos" -> "muito poucos": before "pouco" the intensifier is an adverb.
const VERY_FEW = `(?<target>muit[oa]s|muita|bastantes)${S}(?=pouc[oa]s?${W})`;
// "Segue anexo a lista" -> "anexa", "Seguem anexo as fotos" -> "anexas": "anexo" is an adjective
// agreeing with what is sent ("em anexo" does not vary). "anexo a este e-mail" is a preposition.
const ANNEX_DET: Record<string, string> = {
  o: "anexo",
  a: "anexa",
  os: "anexos",
  as: "anexas",
  um: "anexo",
  uma: "anexa",
  meu: "anexo",
  minha: "anexa",
  meus: "anexos",
  minhas: "anexas",
  nosso: "anexo",
  nossa: "anexa",
  nossos: "anexos",
  nossas: "anexas",
  seu: "anexo",
  sua: "anexa",
  seus: "anexos",
  suas: "anexas",
};
const ANNEX = `(?:segue|seguem|seguiu|seguiram|vai|vão|envio|enviamos|remeto|remetemos|encaminho|encaminhamos|mando|mandamos)${S}(?<target>anex[oa]s?)${S}(?<det>${Object.keys(ANNEX_DET).join("|")})${S}(?!(?:este|esta|esse|essa|aquele|aquela|isto|isso|presente|mensagem|e-mail|email|carta|ofício)${W})\\p{Ll}`;

/** Fixed agreements: masculine millions, "muito poucos", "segue anexa". */
export function fixedAgreements(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  const push = (m: RegExpExecArray, group: string, wanted: string) => {
    const [start, end] = m.indices!.groups![group];
    const typed = ctx.text.slice(start, end);
    if (wanted === typed.toLowerCase() || ctx.dictionary.has(typed.toLowerCase())) return;
    findings.push({
      ruleId: "portugueseAgreement",
      messageKey: "review_msg_pt_noun_agreement",
      range: { start, end },
      alternatives: [applyWordCase(wanted, detectWordCase(typed))],
      context: { start: m.index, end: Math.max(end, m.index + m[0].length) },
    });
  };
  for (const m of frameMatches(ctx, MILLIONS, (match) => match.index)) {
    const group = m.groups!.one ? "one" : "target";
    push(m, group, MASCULINE_OF[m.groups![group].toLowerCase()]);
  }
  for (const m of frameMatches(ctx, VERY_FEW)) {
    const typed = m.groups!.target.toLowerCase();
    push(m, "target", typed.startsWith("muit") ? "muito" : "bastante");
  }
  for (const m of frameMatches(ctx, ANNEX))
    push(m, "target", ANNEX_DET[m.groups!.det.toLowerCase()]);
  return findings;
}
