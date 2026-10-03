import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, isLang, SPACE as S, WORD_END as W } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { analyze } from "./nounAgreement";

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
  ["falt", "a:am ava:avam ou:aram ará:arão aria:ariam"],
  ["cheg", "a:am ava:avam ou:aram ará:arão aria:ariam"],
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
const INFINITIVES = "existir|acontecer|ocorrer|surgir|restar|bastar|sobrar|faltar|chegar";
// "Tem existido muitos", "Está chegando os dias": a perfect or progressive of the same verbs.
const PERFECT: Record<string, string> = {
  tem: "têm",
  tinha: "tinham",
  tenha: "tenham",
  teria: "teriam",
  terá: "terão",
  tivesse: "tivessem",
  está: "estão",
  estava: "estavam",
  esteve: "estiveram",
  esteja: "estejam",
  havia: "haviam",
  haveria: "haveriam",
  haja: "hajam",
  houvesse: "houvessem",
};
const PARTICIPLES =
  "existido|acontecido|ocorrido|surgido|restado|bastado|sobrado|faltado|chegado|existindo|acontecendo|ocorrendo|surgindo|restando|sobrando|faltando|chegando";
const BETWEEN = `(?:(?:ainda|já|também|sempre|nunca${S}mais|nunca|talvez)${S})?`;
const PLURAL_DETERMINER =
  "mais|muitos|muitas|vários|várias|alguns|algumas|poucos|poucas|diversos|diversas|inúmeros|inúmeras|tantos|tantas|uns|umas|os|as|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|vinte|cem|[2-9]|\\d{2,}";
// "Acontece muitas vezes", "ocorre dois dias depois": a span of time is no subject.
export const TIME =
  "vezes|anos|meses|semanas|dias|horas|minutos|segundos|tempos|décadas|séculos|instantes|momentos";
const ADVERB = `(?:(?:ainda|também|já|só|apenas|hoje|aqui|ali|lá|agora|sempre|realmente|então)${W}${S})?`;
const SUBJECT_AFTER = `${ADVERB}(?:${PLURAL_DETERMINER})${W}${S}(?!(?:${TIME}|mais|menos|de|do|da)${W})\\p{Ll}{3,}s${W}`;
const POSTPOSED = `(?<target>${Object.keys(PLURAL).join("|")})${S}(?=${SUBJECT_AFTER})`;
const PERIPHRASIS = `(?<target>${Object.keys(AUXILIARY).join("|")})${S}(?=${BETWEEN}(?:${INFINITIVES})${W}${S}${SUBJECT_AFTER})`;
const PERFECT_FRAME = `(?<target>${Object.keys(PERFECT).join("|")})${S}(?=${BETWEEN}(?:${PARTICIPLES})${W}${S}${SUBJECT_AFTER})`;
// A bare plural after the verb: "Já aconteceu erros" -> "aconteceram", "tenha surgido dúvidas"
// -> "tenham". Checked in code.
const BARE = `(?<target>${Object.keys(PLURAL).join("|")})${S}${ADVERB}(?<noun>\\p{Ll}{3,}s)${W}`;
const BARE_PERFECT = `(?<target>${Object.keys(PERFECT).join("|")})${S}${BETWEEN}(?:${PARTICIPLES})${S}${ADVERB}(?<noun>\\p{Ll}{3,}s)${W}`;
// A subject before the verb ("Ele resta...", "quem existe") makes it agree with that one.
const SUBJECT_BEFORE =
  /(?<![\p{L}])(?:eu|tu|ele|ela|você|nós|eles|elas|vocês|que|quem|o|a|isso|isto|tudo|nada|algo|ninguém)[ \t ]+$/iu;

// "chegar" and "faltar" mostly follow their subject ("A polícia chegou alguns instantes
// depois"): they only agree with one after them when nothing but an adverb comes before.
const SUBJECTLESS =
  /(?:^|[.!?;:,\n]["'”’»)]*[ \t\u00a0]*|(?:^|[^\p{L}])(?:já|ontem|hoje|então|ainda|agora|aí|enfim|finalmente|não)[ \t\u00a0]+)$/iu;
// "cheg-" or "falt-" as the verb, or as the participle after "tem", "está" and the like.
const ARRIVE_OR_LACK = /^(?:\p{L}+[ \t\u00a0]+(?:\p{L}+[ \t\u00a0]+)?)?(?:cheg|falt)/iu;
function subjectless(ctx: DetectContext, m: RegExpExecArray): boolean {
  if (!ARRIVE_OR_LACK.test(ctx.text.slice(m.index, m.index + 40))) return true;
  return SUBJECTLESS.test(ctx.text.slice(Math.max(0, m.index - 16), m.index));
}

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

// Frequent irregular verbs, one row per tense: first singular, third singular, first plural,
// third plural ("tem/vem" after a plural pronoun are portugueseConfusions' têm/vêm).
export const PERSONS = ["eu", "ele", "nós", "eles"] as const;
const CONJUGATIONS = [
  "sou é somos são",
  "fui foi fomos foram",
  "era era éramos eram",
  "serei será seremos serão",
  "estou está estamos estão",
  "estive esteve estivemos estiveram",
  "estava estava estávamos estavam",
  "vou vai vamos vão",
  "ia ia íamos iam",
  "tenho tem temos têm",
  "tive teve tivemos tiveram",
  "tinha tinha tínhamos tinham",
  "faço faz fazemos fazem",
  "fiz fez fizemos fizeram",
  "fazia fazia fazíamos faziam",
  "posso pode podemos podem",
  "pude pôde pudemos puderam",
  "podia podia podíamos podiam",
  "quero quer queremos querem",
  "quis quis quisemos quiseram",
  "queria queria queríamos queriam",
  "sei sabe sabemos sabem",
  "soube soube soubemos souberam",
  "sabia sabia sabíamos sabiam",
  "dou dá damos dão",
  "dei deu demos deram",
  "dava dava dávamos davam",
  "digo diz dizemos dizem",
  "disse disse dissemos disseram",
  "dizia dizia dizíamos diziam",
].map((row) => row.split(" "));
/** Each form -> the rows (tenses) it belongs to. */
export const FORM_ROWS = new Map<string, string[][]>();
for (const row of CONJUGATIONS)
  for (const form of new Set(row)) FORM_ROWS.set(form, [...(FORM_ROWS.get(form) ?? []), row]);
const PRONOUN_PERSON: Record<string, (typeof PERSONS)[number]> = {
  eu: "eu",
  ele: "ele",
  ela: "ele",
  você: "ele",
  "a gente": "ele",
  nós: "nós",
  eles: "eles",
  elas: "eles",
  vocês: "eles",
};
// A regular verb in the third person singular after a plural pronoun: "eles gosta" ->
// "gostam", "nós gostava" -> "gostávamos". Words ending in -a or -e that are no verb after a
// pronoun (pronouns, adverbs, prepositions, numbers, "pra") are listed out.
export const NOT_VERBS = new Set(
  `se me te lhe de que bastante breve e a da na pela para pra sobre sempre hoje ainda agora nunca lá cá onde
  quase toda cada nada contra entre desde enquanto essa esta aquela uma outra nenhuma alguma
  este esse aquele tarde noite longe dentre ante diante adiante mesma mesme ora sete nove onze
  doze treze quinze dezesseis dezessete dezoito dezenove vinte trinta quarenta cinquenta
  sessenta setenta oitenta noventa duzentas trezentas tampouco cedo pouca muita tanta toda
  sozinha juntas juntos fora embora talvez agorinha aqui ali logo ontem ou meu teu seu céu
  réu véu chapéu troféu museu europeu`.split(/\s+/),
);
const REGULAR_PLURAL_SUBJECT = `(?<pronoun>nós|eles|elas|vocês)${S}(?:(?:não|já|também|sempre|só|ainda|nunca)${S}){0,2}(?<target>\\p{Ll}{3,}[ae]|\\p{Ll}{1,}(?:ou|eu|iu))${W}`;
// The reverse: a regular verb in the third person plural after "eu", "ele", "ela" or "você"
// ("ele não passeiam" -> "passeia", "eu gostaram" -> "gostei").
const SINGULAR_SUBJECT = `(?<pronoun>eu|ele|ela|você)${S}(?:(?:não|já|também|sempre|só|ainda|nunca)${S}){0,2}(?<target>\\p{Ll}{2,}[ae]m)${W}`;
export const NOT_PLURAL_VERBS = new Set(
  `também porém além aquém alguém ninguém quem nem sem bem cem ontem homem jovem nuvem ordem
  item trem refém harém armazém vintém desdém virgem`.split(/\s+/),
);
/** The singular form for `pronoun` ("eu" or a third person), or undefined when irregular. */
export function singularOf(plural: string, firstPerson: boolean): string | undefined {
  if (/(?:gem|eem|oem)$/.test(plural)) return undefined;
  if (firstPerson) {
    if (/avam$/.test(plural)) return plural.slice(0, -1);
    if (/aram$/.test(plural)) return `${plural.slice(0, -4)}ei`;
    if (/[^i]am$/.test(plural) && !/[eiá]ram$/.test(plural)) return `${plural.slice(0, -2)}o`;
    return undefined;
  }
  if (/aram$/.test(plural)) return `${plural.slice(0, -4)}ou`;
  if (/[eiá]ram$/.test(plural)) return undefined;
  if (/zem$/.test(plural)) return plural.slice(0, -2);
  if (/aem$/.test(plural)) return `${plural.slice(0, -3)}ai`;
  // "seguem" -> "segue", but "possuem" -> "possui".
  if (/[gq]uem$/.test(plural)) return plural.slice(0, -1);
  if (/uem$/.test(plural)) return `${plural.slice(0, -3)}ui`;
  return plural.slice(0, -1);
}
const PRONOUN_SUBJECT = `(?<pronoun>eu|ele|ela|você|a${S}gente|nós|eles|elas|vocês)${S}(?:(?:não|já|também|sempre|só|ainda|nunca)${S}){0,2}(?<target>${[...FORM_ROWS.keys()].join("|")})${W}`;
const ELAPSED = new RegExp(`^${S}(?:\\p{L}+${S})?(?:${TIME}|tempo)${W}`, "iu");
// A preposition makes the pronoun no subject ("para eles foi difícil", "a todos eles"); "e",
// "ou" or a comma can join it to another subject ("eu e ela vamos"); after a copula it is the
// predicate ("ser eu"); after an article it is a noun ("os nós", "o verdadeiro eu").
export const NOT_SUBJECT =
  /(?<![\p{L}])(?:(?:para|com|de|dentre|sem|entre|a|por|contra|até|sobre|perante|desde|após)(?:[ \t ]+(?:todos|todas|ambos|ambas))?|e|ou|nem|como|quanto|ser|sou|é|era|foi|o|a|os|as|um|uma|uns|umas|dos|das|nos|nas|aos|pelos|pelas|meu|seu|teu|nosso|verdadeiro|próprio)[ \t ]+$|,[ \t ]*$/iu;

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
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  for (const [pattern, table] of [
    [POSTPOSED, PLURAL],
    [PERIPHRASIS, AUXILIARY],
    [PERFECT_FRAME, PERFECT],
  ] as const) {
    for (const m of frameMatches(ctx, pattern)) {
      const before = ctx.text.slice(Math.max(0, m.index - 16), m.index);
      if (SUBJECT_BEFORE.test(before)) continue;
      if (!subjectless(ctx, m)) continue;
      push(findings, ctx, m, table[m.groups!.target.toLowerCase()]);
    }
  }
  for (const [pattern, table] of [
    [BARE, PLURAL],
    [BARE_PERFECT, PERFECT],
  ] as const)
    for (const m of frameMatches(ctx, pattern)) {
      const noun = m.groups!.noun;
      if (
        noun !== noun.toLowerCase() ||
        /mos$/.test(noun) ||
        new RegExp(`^(?:${TIME})$`).test(noun)
      )
        continue;
      if (new RegExp(`^(?:${PLURAL_DETERMINER})$`).test(noun)) continue;
      const info = analyze(noun);
      if (!info?.plural || info.feminine === null) continue;
      if (SUBJECT_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 16), m.index))) continue;
      if (!subjectless(ctx, m)) continue;
      push(findings, ctx, m, table[m.groups!.target.toLowerCase()]);
    }
  for (const m of frameMatches(ctx, PROPRIO)) {
    const pronoun = m.groups!.pronoun.toLowerCase().replace(/^[nd]/, "");
    const typed = m.groups!.target.toLowerCase();
    const wanted = typed.replace(/[oa]s?$/, PROPRIO_ENDING[pronoun]);
    if (wanted !== typed) push(findings, ctx, m, wanted);
  }
  for (const m of frameMatches(ctx, PRONOUN_SUBJECT)) {
    const person = PRONOUN_PERSON[m.groups!.pronoun.toLowerCase().replace(/\s+/g, " ")];
    const typed = m.groups!.target.toLowerCase();
    const rows = FORM_ROWS.get(typed)!;
    const index = PERSONS.indexOf(person);
    if (rows.some((row) => row[index] === typed)) continue;
    if (person === "eles" && (typed === "tem" || typed === "vem")) continue;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (NOT_SUBJECT.test(before)) continue;
    // A capitalized "Eu" inside a sentence is a noun ("o verdadeiro Eu").
    if (/^\p{Lu}/u.test(m.groups!.pronoun) && !/(?:^|[.!?:;"“«]\s*)$/u.test(before)) continue;
    // "Nós é que sabemos": the cleft "é que" does not agree.
    // "Vi eles faz um ano": elapsed-time "fazer" has no subject.
    const after = ctx.text.slice(m.indices!.groups!.target[1], m.indices!.groups!.target[1] + 40);
    if (/^[ \t ]+que(?![\p{L}])/u.test(after)) continue;
    if (/^f[ia]z/.test(typed) && ELAPSED.test(after)) continue;
    const wanted = new Set(rows.map((row) => row[index]));
    if (wanted.size === 1) push(findings, ctx, m, [...wanted][0]);
  }
  for (const m of frameMatches(ctx, REGULAR_PLURAL_SUBJECT)) {
    const typed = m.groups!.target;
    const pronoun = m.groups!.pronoun.toLowerCase();
    if (
      typed !== typed.toLowerCase() ||
      NOT_VERBS.has(typed) ||
      FORM_ROWS.has(typed) ||
      typed.endsWith("mente")
    )
      continue;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (NOT_SUBJECT.test(before)) continue;
    let wanted: string | undefined;
    // The preterite: "eles gostou" -> "gostaram", "nós comeu" -> "comemos".
    const preterite = /([oei])u$/.exec(typed);
    if (preterite) {
      const vowel = { o: "a", e: "e", i: "i" }[preterite[1]]!;
      wanted = `${typed.slice(0, -2)}${vowel}${pronoun === "nós" ? "mos" : "ram"}`;
    } else if (pronoun !== "nós") wanted = `${typed}m`;
    // "nós gostava" -> "gostávamos", "nós gosta" -> "gostamos". "-ia" is either an imperfect
    // (comia) or a present (passeia, anuncia), so it stays.
    else if (/ava$/.test(typed)) wanted = `${typed.slice(0, -3)}ávamos`;
    else if (/[^i]a$/.test(typed)) wanted = `${typed}mos`;
    if (wanted) push(findings, ctx, m, wanted);
  }
  for (const m of frameMatches(ctx, SINGULAR_SUBJECT)) {
    const typed = m.groups!.target;
    if (typed !== typed.toLowerCase() || NOT_PLURAL_VERBS.has(typed) || FORM_ROWS.has(typed))
      continue;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (NOT_SUBJECT.test(before)) continue;
    const wanted = singularOf(typed, m.groups!.pronoun.toLowerCase() === "eu");
    if (wanted) push(findings, ctx, m, wanted);
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
