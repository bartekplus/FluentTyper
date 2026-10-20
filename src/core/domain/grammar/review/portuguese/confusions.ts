import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, isLang, SPACE as S, WORD_END as W } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { ReviewMessageKey } from "../types";
import { analyze } from "./nounAgreement";

/**
 * Portuguese words that sound alike or differ by one accent, told apart by the
 * words around them: crase (à/a/há), por que/porque/por quê/porquê, é/e,
 * está/esta, dá/da, dê/de, houve/ouve, pôr/por. Every frame names its evidence.
 */

// Infinitives look like these nouns and adjectives, which can follow a crase ("à mulher").
const FEMININE_R = new Set(
  "mulher colher militar titular auxiliar familiar circular similar celular escolar popular particular exemplar singular regular preliminar complementar lunar solar polar nuclear secular vulgar peculiar hospitalar curricular disciplinar".split(
    " ",
  ),
);
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

// Places one goes to: "vou a escola" -> "à escola". "foi" and "fui" also mean "was".
const GOES = "vou|vais|vai|vamos|vão|ia|iam|irei|irás|irá|iremos|irão|iria|iríamos|iriam|ir|indo";
const DESTINATIONS =
  "escola|praia|festa|igreja|missa|feira|academia|farmácia|padaria|faculdade|universidade|reunião|aula|piscina|fazenda|praça|loja|biblioteca|delegacia|prefeitura|cidade|capital|cozinha|sala|janela|rodoviária|lavanderia|oficina|creche|cerimônia|consulta|sessão|exposição";
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

/** A Portuguese frame fix: the alternatives for the typed target. */
export type PortugueseFixer = (typed: string) => string[];

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  ptViajem: (typed) => [NOUN_TWIN[typed.toLowerCase()]],
  ptViajem2: (typed) => [NOUN_TWIN[typed.toLowerCase()]],
  ptOs: (typed) => [WITH_A[typed.toLowerCase()]],
  ptOs2: (typed) => [WITH_A[typed.toLowerCase()]],
  ptDo: (typed) => {
    const article = /\s(o|a|os|as)$/i.exec(typed)?.[1].toLowerCase();
    return [article ? WITH_A[article] : "a"];
  },
  ptCon: (typed) => [typed.replace(/[eé]m$/i, "êm")],
  ptFazem: (typed) => [IMPERSONAL[typed.toLowerCase()]],
  ptVão: (typed) => [IMPERSONAL[typed.toLowerCase()]],
  ptEu: (typed) => [typed.toLowerCase() === "eu" ? "mim" : "ti"],
  ptEu2: (typed) => [typed.toLowerCase() === "eu" ? "mim" : "ti"],
  ptMim: (typed) => [typed.toLowerCase() === "mim" ? "eu" : "tu"],
  ptMim2: (typed) => (typed.toLowerCase() === "mim" ? ["eu", "mim,"] : ["tu", "ti,"]),
  ptDês: (typed) => {
    const article = /d([oa]s?|e)$/.exec(typed.toLowerCase())![1];
    return [article === "e" ? "desde" : `desde ${article}`];
  },
  ptFazem2: (typed) => [IMPERSONAL[typed.toLowerCase()]],
  ptFazem3: (typed) => [IMPERSONAL[typed.toLowerCase()]],
  ptHaviam: (typed) => [HAVER_SINGULAR[typed.toLowerCase()]],
  ptGast: (typed) => [shortParticiple(typed.toLowerCase())],
  ptNa: (typed) => [typed.toLowerCase() === "nas" ? "às" : "à"],
  ptNo: (typed) => [typed.toLowerCase() === "nos" ? "aos" : "ao"],
  ptDevem: (typed) => [MODAL_SINGULAR[typed.toLowerCase()]],
  ptSai: (typed) => {
    const lower = typed.toLowerCase().replace("ó", "o");
    return [`${lower.slice(0, -1)}í`, lower.replace(/i$/, /ai$/.test(lower) ? "io" : "o")];
  },
  ptOra: (typed) => [typed.toLowerCase() === "oras" ? "horas" : "hora"],
  ptMais: (typed) => {
    const word = typed.toLowerCase().split(/\s+/).pop()!;
    const plural = /s$/.test(word);
    const base = /^b/.test(word) ? "melhor" : /^m/.test(word) ? "pior" : "maior";
    return [plural ? `${base}es` : base];
  },
  ptEu3: (typed) => [typed.toLowerCase() === "eu" ? "mim" : "ti"],
  ptCinto: (typed) => [`s${typed.slice(1).toLowerCase()}`],
  ptEstá: (typed) => [typed.replace(/á/i, "a")],
  ptFoi: (typed) => [
    { foi: "foram", é: "são", era: "eram", está: "estão", estava: "estavam" }[typed.toLowerCase()]!,
  ],
  ptTive: (typed) => [ESTAR_FOR_TER[typed.toLowerCase()]],
  ptPos: (typed) => [ACCENTED_PREFIX[typed.toLowerCase()]],
  ptSera: (typed) => [FUTURE_ACCENT[typed.toLowerCase()]],
  ptSera2: (typed) => [FUTURE_ACCENT[typed.toLowerCase()]],
} satisfies Record<string, PortugueseFixer>;

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
export const CLAUSE_BEFORE = /(?:^|[.!?:;][ \t\r\n "”»)]{0,8}|\n[ \t ]{0,8})$/;

/** A finding for the `target` group of `m`, in the typed casing; user-dictionary words stay. */
export function pushFinding(
  ctx: DetectContext,
  findings: RawFinding[],
  m: RegExpExecArray,
  alternatives: string[],
  messageKey: ReviewMessageKey,
  ruleId: RawFinding["ruleId"] = "portugueseConfusions",
): void {
  const [start, end] = m.indices!.groups!.target;
  const typed = ctx.text.slice(start, end);
  if (ctx.dictionary.has(typed.toLowerCase())) return;
  findings.push({
    ruleId,
    messageKey,
    range: { start, end },
    alternatives: alternatives.map((alt) => applyWordCase(alt, detectWordCase(typed))),
    context: { start: m.index, end: Math.max(end, m.index + m[0].length) },
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  });
}

export function confusions(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  const push = (m: RegExpExecArray, alternatives: string[], messageKey: ReviewMessageKey): void =>
    pushFinding(ctx, findings, m, alternatives, messageKey);
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
