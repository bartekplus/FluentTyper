import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";

/**
 * Agreement Portuguese marks on words a closed list can name.
 * - Verbs of existing and happening agree with a plural subject placed after them: "Existe
 *   muitos problemas" -> "Existem", "Vai acontecer várias mudanças" -> "Vão".
 * - "próprio" agrees with the pronoun it reinforces: "ela próprio" -> "ela própria".
 * - A neuter pronoun (isso, isto, aquilo, tudo) takes a masculine adjective: "Isso é muito
 *   engraçada" -> "engraçado".
 * - After "quando", "se", "enquanto"... an irregular verb takes its future subjunctive, not
 *   its infinitive: "Quando eu ver" -> "vir", "se nós fazermos" -> "fizermos".
 */

const S = SPACE;
const W = WORD_END;

// Third person singular -> plural of the verbs whose subject usually follows them.
// Subjunctives stay out: "sobre" is also the preposition, and "que isso não ocorra" has its
// subject before.
const PLURAL: Record<string, string> = {};
for (const [stem, forms] of [
  ["exist", "e:em ia:iam iu:iram irá:irão iria:iriam"],
  ["acontec", "e:em ia:iam eu:eram erá:erão eria:eriam"],
  ["ocorr", "e:em ia:iam eu:eram erá:erão eria:eriam"],
  ["surg", "e:em ia:iam iu:iram irá:irão iria:iriam"],
  ["rest", "a:am ava:avam ou:aram ará:arão aria:ariam"],
  ["bast", "a:am ava:avam ou:aram ará:arão aria:ariam"],
  ["sobr", "a:am ava:avam ou:aram ará:arão aria:ariam"],
] as const) {
  for (const pair of forms.split(" ")) {
    const [singular, plural] = pair.split(":");
    PLURAL[stem + singular] = stem + plural;
  }
}
const AUXILIARY: Record<string, string> = {
  vai: "vão",
  ia: "iam",
  irá: "irão",
  iria: "iriam",
  pode: "podem",
  podia: "podiam",
  poderá: "poderão",
  poderia: "poderiam",
  deve: "devem",
  devia: "deviam",
  deverá: "deverão",
  deveria: "deveriam",
  costuma: "costumam",
  costumava: "costumavam",
  continua: "continuam",
  começa: "começam",
};
const INFINITIVES = "existir|acontecer|ocorrer|surgir|restar|bastar|sobrar";
const PLURAL_DETERMINER =
  "muitos|muitas|vários|várias|alguns|algumas|poucos|poucas|diversos|diversas|inúmeros|inúmeras|tantos|tantas|uns|umas|os|as|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|vinte|cem|[2-9]|\\d{2,}";
// "Acontece muitas vezes", "ocorre dois dias depois": a span of time is no subject.
const TIME = "vezes|anos|meses|semanas|dias|horas|minutos|segundos|tempos|décadas|séculos";
const ADVERB = `(?:(?:ainda|também|já|só|apenas|hoje|aqui|ali|lá|agora|sempre|realmente|então)${W}${S})?`;
const SUBJECT_AFTER = `${ADVERB}(?:${PLURAL_DETERMINER})${W}${S}(?!(?:${TIME}|mais|menos|de|do|da)${W})\\p{Ll}{3,}s${W}`;
const POSTPOSED = `(?<target>${Object.keys(PLURAL).join("|")})${S}(?=${SUBJECT_AFTER})`;
const PERIPHRASIS = `(?<target>${Object.keys(AUXILIARY).join("|")})${S}(?=(?:${INFINITIVES})${W}${S}${SUBJECT_AFTER})`;
// A subject before the verb ("Ele resta...", "quem existe") makes it agree with that one.
const SUBJECT_BEFORE =
  /(?<![\p{L}])(?:eu|tu|ele|ela|você|nós|eles|elas|vocês|que|quem|o|a|isso|isto|tudo|nada|algo|ninguém)[ \t ]+$/iu;

const PROPRIO = `(?<pronoun>n?ele|n?ela|n?eles|n?elas|dele|dela|deles|delas)${S}(?<target>própri[oa]s?)${W}`;
const PROPRIO_ENDING: Record<string, string> = {
  ele: "o",
  ela: "a",
  eles: "os",
  elas: "as",
};

const FEMININE_ADJECTIVES =
  "boa|linda|bonita|engraçada|perfeita|errada|certa|chata|estranha|esquisita|complicada|ótima|péssima|maravilhosa|necessária|obrigatória|verdadeira|falsa|ridícula|absurda|perigosa|gostosa|divertida|cansativa|curiosa|justa|injusta|correta|incorreta|clara|óbvia|rara|barata|fantástica|horrorosa|nojenta";
const NEUTER = `(?:isso|isto|aquilo|tudo)${S}(?:não${S})?(?:é|era|foi|seja|fosse|será|seria|parece|parecia|fica|ficou|está|estava|continua)${S}(?:(?:muito|tão|bem|super|bastante|meio|mais|menos|realmente|totalmente|completamente)${S})?(?<target>${FEMININE_ADJECTIVES})(?=[ \\t\\u00a0]{0,2}(?:[.,;:!?]|$)|${S}(?:demais|mesmo|também|para|de)${W})`;

// Infinitive -> future subjunctive stem of the irregular verbs (the regular ones coincide).
// "por" without its accent stays out: "quando ele por fim chegou".
const FUTURE_SUBJUNCTIVE: Record<string, string> = {
  dizer: "disse",
  fazer: "fize",
  refazer: "refize",
  desfazer: "desfize",
  ver: "vi",
  rever: "revi",
  prever: "previ",
  ter: "tive",
  manter: "mantive",
  conter: "contive",
  obter: "obtive",
  deter: "detive",
  reter: "retive",
  pôr: "puse",
  propor: "propuse",
  compor: "compuse",
  supor: "supuse",
  ser: "fo",
  ir: "fo",
  dar: "de",
  estar: "estive",
  poder: "pude",
  saber: "soube",
  querer: "quise",
  trazer: "trouxe",
  caber: "coube",
};
const PERSON_ENDING: Record<string, string> = { "": "r", es: "res", mos: "rmos", em: "rem" };
const CONJUNCTION = `(?:quando|se|enquanto|assim${S}que|logo${S}que|sempre${S}que|depois${S}que|caso|conforme)`;
const SUBJECT = `(?:eu|tu|ele|ela|você|nós|eles|elas|vocês|a${S}gente|(?:o|a|os|as)${S}\\p{Ll}+)`;
const INFINITIVE = `(?<target>(?<verb>${Object.keys(FUTURE_SUBJUNCTIVE).join("|")})(?<person>es|mos|em)?)`;
const FUTURE = `${CONJUNCTION}${S}${SUBJECT}${S}(?:não${S})?${INFINITIVE}${W}`;

function push(
  findings: RawFinding[],
  ctx: DetectContext,
  m: RegExpExecArray,
  replacement: string,
  messageKey:
    "review_msg_pt_agreement" | "review_msg_pt_future_subjunctive" = "review_msg_pt_agreement",
): void {
  const typed = m.groups!.target;
  if (ctx.dictionary.has(typed.toLowerCase())) return;
  const [start, end] = m.indices!.groups!.target;
  findings.push({
    ruleId: "portugueseAgreement",
    messageKey,
    range: { start, end },
    alternatives: [applyWordCase(replacement, detectWordCase(typed))],
    context: { start: m.index, end: Math.max(end, m.index + m[0].length) },
  });
}

export function agreement(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const [pattern, table] of [
    [POSTPOSED, PLURAL],
    [PERIPHRASIS, AUXILIARY],
  ] as const) {
    for (const m of frameMatches(ctx, pattern)) {
      const before = ctx.text.slice(Math.max(0, m.index - 16), m.index);
      if (SUBJECT_BEFORE.test(before)) continue;
      push(findings, ctx, m, table[m.groups!.target.toLowerCase()]);
    }
  }
  for (const m of frameMatches(ctx, PROPRIO)) {
    const pronoun = m.groups!.pronoun.toLowerCase().replace(/^[nd]/, "");
    const typed = m.groups!.target.toLowerCase();
    const wanted = typed.replace(/[oa]s?$/, PROPRIO_ENDING[pronoun]);
    if (wanted !== typed) push(findings, ctx, m, wanted);
  }
  for (const m of frameMatches(ctx, FUTURE)) {
    const { verb, person = "" } = m.groups!;
    push(
      findings,
      ctx,
      m,
      FUTURE_SUBJUNCTIVE[verb.toLowerCase()] + PERSON_ENDING[person],
      "review_msg_pt_future_subjunctive",
    );
  }
  for (const m of frameMatches(ctx, NEUTER)) {
    const typed = m.groups!.target.toLowerCase();
    push(findings, ctx, m, typed === "boa" ? "bom" : typed.replace(/a$/, "o"));
  }
  return findings;
}
