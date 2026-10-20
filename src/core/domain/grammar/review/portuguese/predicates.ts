import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { TIME } from "./agreement";
import { analyze, SENTENCE_START } from "./nounAgreement";
import { verbStems } from "./subjunctive";
import { finding } from "../finding";

/**
 * An adjective after "ser", "estar", "ficar" or "parecer" agrees with the subject opening the
 * sentence: "A palavra está correto" -> "correta", "Elas são altos" -> "altas". The subject is
 * a pronoun of known gender, or an article and a noun whose gender its spelling tells. After
 * "ser" a bare noun may follow ("A cidade é palco de"), so only listed adjectives count there;
 * after "estar" and "ficar" participles count too ("A porta está fechado").
 * The frames are in grammar/rules/pt_BR.yaml.
 */

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

/** An adjective after a copula agrees with the subject opening the sentence. */
const subjectPredicate: MatchFixer = (m, ctx) => {
  const { pronoun, article, noun, copula, target } = m.groups!;
  if (!SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))) return null;
  if (target !== target.toLowerCase() || ctx.dictionary.has(target)) return null;
  let feminine: boolean;
  let plural: boolean;
  if (pronoun) {
    if (pronoun.slice(1) !== pronoun.slice(1).toLowerCase()) return null;
    feminine = /^elas?$/i.test(pronoun);
    plural = /s$/i.test(pronoun);
  } else {
    if (noun !== noun.toLowerCase() || NOT_SUBJECT.has(noun)) return null;
    const info = analyze(noun);
    if (!info || info.feminine === null) return null;
    feminine = info.feminine;
    plural = info.plural;
    // The article agrees with its noun, or the subject is not what it seems.
    if (/a/i.test(article) !== feminine || /s$/i.test(article) !== plural) return null;
  }
  const stem = target.replace(/[oa]s?$/, "");
  const participle = /\p{Ll}{2}(?:ad|id)$/u.test(stem) && !NOUNS_IN_DO.has(stem);
  // "são ótimos indicadores": an adjective before its noun is no predicate.
  const [, targetEnd] = m.indices!.groups!.target;
  if (!CLAUSE_GOES_ON.test(ctx.text.slice(targetEnd, targetEnd + 24))) return null;
  if (!ADJECTIVE_STEMS.has(stem) && !participle) return null;
  // "Eles são cara de pau": "cara de" is the noun "face".
  if (stem === "car" && /^[ \t\u00a0]+de(?![\p{L}])/u.test(ctx.text.slice(targetEnd))) return null;
  const wanted = `${stem}${feminine ? "a" : "o"}${plural ? "s" : ""}`;
  if (wanted === target) return null;
  // A plural copula with a singular subject (or back) is verbAgreement's to fix.
  if (/(?:ão|am|em)$/.test(copula) !== plural) return null;
  const [start, end] = m.indices!.groups!.target;
  return {
    ruleId: "portugueseAgreement",
    messageKey: "review_msg_pt_noun_agreement",
    range: { start, end },
    alternatives: [applyWordCase(wanted, detectWordCase(target))],
    context: { start: m.index, end },
  };
};

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
/** "a razão pelo qual" -> "pela qual": "o/a qual" agrees with the noun right before it. */
const relative: MatchFixer = (m, ctx) => {
  const { noun, target, qual } = m.groups!;
  if (noun !== noun.toLowerCase() || target !== target.toLowerCase()) return null;
  const row = Object.values(PREPOSITION_FORMS).find((forms) => forms.includes(target));
  if (!row) return null;
  const info = analyze(noun);
  if (!info || info.feminine === null) return null;
  // "o estudo ou a metodologia pelo qual": a coordinated noun may be the antecedent.
  const before = ctx.text.slice(Math.max(0, m.index - 30), m.index);
  if (/(?:^|[^\p{L}])(?:ou|e)[ \t\u00a0]+(?:\p{L}+[ \t\u00a0]+)?$/u.test(before)) return null;
  // "quais" is plural and "qual" singular: they must match the article already.
  if ((qual === "quais") !== info.plural) return null;
  const wanted = row[(info.plural ? 2 : 0) + (info.feminine ? 1 : 0)];
  if (wanted === target) return null;
  const [start, end] = m.indices!.groups!.target;
  return finding("portugueseAgreement", "review_msg_pt_noun_agreement", start, end, [wanted], {
    context: { start: m.index, end: m.index + m[0].length },
  });
};

/** "Vende-se casas" -> "Vendem-se casas": the plural noun after the verb is its subject. */
const passiveSe: MatchFixer = (m) => {
  const { verb, noun, det } = m.groups!;
  if (verb.slice(1) !== verb.slice(1).toLowerCase() || noun !== noun.toLowerCase()) return null;
  const info = analyze(noun);
  if (!info?.plural || info.feminine === null) return null;
  if (!det && !info.certain && !/[ao]s$/.test(noun)) return null;
  if (new RegExp(`^(?:${TIME})$`).test(noun)) return null;
  // A present tense of an everyday verb: not "houve-se", nor "leia-se" (read as).
  const lower = verb.toLowerCase();
  if (GOVERNS_A_SE.has(lower)) return null;
  const { ar, er, ir } = verbStems();
  const stem = lower.slice(0, -1);
  if (!(lower.endsWith("a") ? ar.has(stem) : er.has(stem) || ir.has(stem))) return null;
  const [start, end] = m.indices!.groups!.verb;
  return {
    ruleId: "portugueseAgreement",
    messageKey: "review_msg_pt_agreement",
    range: { start, end },
    alternatives: [`${verb}m`].map((wanted) => applyWordCase(wanted, detectWordCase(verb))),
    context: { start: m.index, end: m.index + m[0].length },
  };
};

/** "Estamos muitos contentes" -> "muito contentes": before an adjective it is an adverb. */
const quantified: MatchFixer = (m, ctx) => {
  const { target, adjective } = m.groups!;
  if (target !== target.toLowerCase() || adjective !== adjective.toLowerCase()) return null;
  const stem = adjective.replace(/[oa]s?$/, "");
  // After "ser" a participle may be a noun: "São muitos interessados".
  const participle =
    /\p{Ll}{2}(?:ad|id)$/u.test(stem) &&
    !NOUNS_IN_DO.has(stem) &&
    !/^(?:é|são|era|eram|foi|foram|será|serão|seria|seriam|somos|fomos|éramos)\s/iu.test(m[0]);
  if (!ADJECTIVE_STEMS.has(stem) && !participle && !/es$/.test(adjective)) return null;
  const [, end] = m.indices!.groups!.adjective;
  if (!CLAUSE_GOES_ON.test(ctx.text.slice(end, end + 24))) return null;
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
  return finding(
    "portugueseAgreement",
    "review_msg_pt_noun_agreement",
    start,
    targetEnd,
    [wanted],
    {
      context: { start: m.index, end },
    },
  );
};

const COPULA_NUMBER = new Map<string, string>();
for (const pair of "foi:foram é:são era:eram será:serão seria:seriam for:forem fosse:fossem seja:sejam".split(
  " ",
)) {
  const [one, many] = pair.split(":");
  COPULA_NUMBER.set(one, many).set(many, one);
}
const SHORT_PARTICIPLES = new Set(
  "feit dit escrit abert cobert pag ganh gast entregu aceit".split(" "),
);
const SUBJECT_AFTER =
  /^[ \t ]+(?:(?<one>o|um|uma)|os|as|uns|umas|outros|outras|todos|todas|muitos|muitas|vários|várias|alguns|algumas|novos|novas)[ \t ]/u;

/**
 * "Foram corrigido o valor" -> "Foi corrigido", "Foi pagos os juros" -> "Foram pagos": a
 * participle or adjective after "ser" takes the verb's number.
 */
const passive: MatchFixer = (m, ctx) => {
  const { copula, target } = m.groups!;
  if (target !== target.toLowerCase() || copula.slice(1) !== copula.slice(1).toLowerCase())
    return null;
  const stem = target.replace(/[oa]s?$/, "");
  const participle =
    (/\p{Ll}{2}(?:ad|id)$/u.test(stem) && !NOUNS_IN_DO.has(stem)) || SHORT_PARTICIPLES.has(stem);
  if (!participle && !ADJECTIVE_STEMS.has(stem)) return null;
  const pluralCopula = /(?:ão|am|em)$/.test(copula);
  if (pluralCopula === target.endsWith("s")) return null;
  const [start] = m.indices!.groups!.copula;
  const [, end] = m.indices!.groups!.target;
  const subject = SUBJECT_AFTER.exec(ctx.text.slice(end, end + 24));
  // With the subject before them, subjectPredicates fixes the participle.
  if (!subject || ctx.dictionary.has(ctx.text.slice(start, end).toLowerCase())) return null;
  // The subject's number decides which of the two words disagrees with it.
  const lower = copula.toLowerCase();
  const fixed =
    !!subject.groups!.one === pluralCopula
      ? `${COPULA_NUMBER.get(lower)} ${target}`
      : `${lower} ${pluralCopula ? `${target}s` : target.slice(0, -1)}`;
  return finding(
    "portugueseAgreement",
    "review_msg_pt_passive_number",
    start,
    end,
    [applyWordCase(fixed, detectWordCase(copula))],
    { context: { start, end } },
  );
};

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

/** The agreement fix of `group`, unless it is already right or a user word. */
function fixed(
  ctx: DetectContext,
  m: RegExpExecArray,
  group: string,
  wanted: string,
): RawFinding | null {
  const [start, end] = m.indices!.groups![group];
  const typed = ctx.text.slice(start, end);
  if (wanted === typed.toLowerCase() || ctx.dictionary.has(typed.toLowerCase())) return null;
  return {
    ruleId: "portugueseAgreement",
    messageKey: "review_msg_pt_noun_agreement",
    range: { start, end },
    alternatives: [applyWordCase(wanted, detectWordCase(typed))],
    context: { start: m.index, end: Math.max(end, m.index + m[0].length) },
  };
}

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  subjectPredicate,
  relative,
  passiveSe,
  quantified,
  passive,
  // Fixed agreements: masculine millions, "muito poucos", "segue anexa".
  millions: (m, ctx) => {
    // The match start owns the frame.
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    const group = m.groups!.one ? "one" : "target";
    return fixed(ctx, m, group, MASCULINE_OF[m.groups![group].toLowerCase()]);
  },
  veryFew: (m, ctx) => {
    const typed = m.groups!.target.toLowerCase();
    return fixed(ctx, m, "target", typed.startsWith("muit") ? "muito" : "bastante");
  },
  annex: (m, ctx) => fixed(ctx, m, "target", ANNEX_DET[m.groups!.det.toLowerCase()]),
} satisfies Record<string, MatchFixer>;
