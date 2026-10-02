import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { analyze } from "./nounAgreement";

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
