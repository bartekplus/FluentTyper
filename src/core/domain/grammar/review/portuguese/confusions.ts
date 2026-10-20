import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import type { ReviewMessageKey } from "../types";
import { analyze } from "./nounAgreement";

/**
 * Portuguese words that sound alike or differ by one accent, told apart by the
 * words around them: crase (à/a/há), por que/porque/por quê/porquê, é/e,
 * está/esta, dá/da, dê/de, houve/ouve, pôr/por. Every frame names its evidence. The frames
 * are in grammar/rules/pt_BR.yaml.
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

/** The finding of `pushFinding` as a frame result: none for a user-dictionary word. */
function crase(ctx: DetectContext, m: RegExpExecArray, alternatives: string[]): RawFinding[] {
  const findings: RawFinding[] = [];
  pushFinding(ctx, findings, m, alternatives, "review_msg_pt_crase");
  return findings;
}

/** The named frame fixes of the crase frames of grammar/rules/pt_BR.yaml (`fixer:`). */
export const CRASE_FIXERS = {
  craseGoverned: (m, ctx) => {
    const { lead, target, noun } = m.groups!;
    if (
      /^quanto$/i.test(lead) &&
      !CLAUSE_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))
    )
      return null;
    if (noun !== noun.toLowerCase()) return null;
    const analysis = analyze(noun);
    if (!analysis?.feminine || analysis.plural !== (target.length === 2)) return null;
    return crase(ctx, m, [target.length === 2 ? "às" : "à"]);
  },
  craseGoesTo: (m, ctx) => crase(ctx, m, [m.groups!.target.toLowerCase() === "as" ? "às" : "à"]),
  craseNone: (m, ctx) => crase(ctx, m, ["a"]),
  craseInfinitive: (m, ctx) =>
    FEMININE_R.has(m.groups!.verb) || ctx.dictionary.has(m.groups!.verb)
      ? null
      : crase(ctx, m, ["a"]),
} satisfies Record<string, MatchFixer>;
