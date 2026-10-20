import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { SPACE as S, WORD_END as W } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { analyze } from "./nounAgreement";
import { infinitive } from "./infinitives";

/**
 * Agreement Portuguese marks on words a closed list can name.
 * - Verbs of existing and happening agree with a plural subject placed after them: "Existe
 *   muitos problemas" -> "Existem", "Vai acontecer várias mudanças" -> "Vão".
 * - "próprio" agrees with the pronoun it reinforces: "ela próprio" -> "ela própria".
 * - A neuter pronoun (isso, isto, aquilo, tudo) takes a masculine adjective: "Isso é muito
 *   engraçada" -> "engraçado".
 * - After "quando", "se", "enquanto"... an irregular verb takes its future subjunctive, not
 *   its infinitive: "Quando eu ver" -> "vir", "se nós fazermos" -> "fizermos".
 * The frames are in grammar/rules/pt_BR.yaml.
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
const PLURAL_DETERMINER =
  "mais|muitos|muitas|vários|várias|alguns|algumas|poucos|poucas|diversos|diversas|inúmeros|inúmeras|tantos|tantas|uns|umas|os|as|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|vinte|cem|[2-9]|\\d{2,}";
// "Acontece muitas vezes", "ocorre dois dias depois": a span of time is no subject.
export const TIME =
  "vezes|anos|meses|semanas|dias|horas|minutos|segundos|tempos|décadas|séculos|instantes|momentos";
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

const PROPRIO_ENDING: Record<string, string> = {
  ele: "o",
  ela: "a",
  eles: "os",
  elas: "as",
};

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
const QUESTION_LEAD =
  /^(?:sei|sabe|sabem|sabemos|saber|sabia|soube|decidir|decide|decidiu|decidimos|escolher|escolhe|escolheu|perguntar|pergunta|perguntou|ensinar|ensina|ensinou|aprender|aprende|aprendeu|entender|entende|explicar|explica|explicou|dizer|diz|disse|mostrar|mostra|mostrou|indicar|indica|definir|define|planejar|ideia|dúvida|noção|até|desde|de|para|sobre|é|era)$/iu;

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
export const NOT_PLURAL_VERBS = new Set(
  `também porém além aquém alguém ninguém quem nem sem bem cem ontem homem jovem nuvem ordem
  item trem refém harém armazém vintém desdém virgem`.split(/\s+/),
);
/** The singular form for `pronoun` ("eu" or a third person), or undefined when irregular. */
export function singularOf(plural: string, firstPerson: boolean): string | undefined {
  // "constroem" -> "constrói" (construir).
  const oi = /^(\p{L}+)oem$/u.exec(plural)?.[1];
  if (oi && !firstPerson && infinitive(`${oi}ui`)) return `${oi}ói`;
  if (/(?:gem|eem|oem)$/.test(plural)) return undefined;
  if (firstPerson) {
    if (/avam$/.test(plural)) return plural.slice(0, -1);
    if (/aram$/.test(plural)) return `${plural.slice(0, -4)}ei`;
    if (/[^i]am$/.test(plural) && !/[eiá]ram$/.test(plural)) return `${plural.slice(0, -2)}o`;
    return undefined;
  }
  if (/aram$/.test(plural)) return `${plural.slice(0, -4)}ou`;
  // "saíram" -> "saiu", "incluíram" -> "incluiu".
  if (/[au]íram$/.test(plural)) return `${plural.slice(0, -4)}iu`;
  if (/[eiíá]ram$/.test(plural)) return undefined;
  if (/zem$/.test(plural)) return plural.slice(0, -2);
  if (/aem$/.test(plural)) return `${plural.slice(0, -3)}ai`;
  // "seguem" -> "segue", but "possuem" -> "possui".
  if (/[gq]uem$/.test(plural)) return plural.slice(0, -1);
  if (/uem$/.test(plural)) return `${plural.slice(0, -3)}ui`;
  return plural.slice(0, -1);
}
const ELAPSED = new RegExp(`^${S}(?:\\p{L}+${S})?(?:${TIME}|tempo)${W}`, "iu");
// A preposition makes the pronoun no subject ("para eles foi difícil", "a todos eles"); "e",
// "ou" or a comma can join it to another subject ("eu e ela vamos"); after a copula it is the
// predicate ("ser eu"); after an article it is a noun ("os nós", "o verdadeiro eu").
export const NOT_SUBJECT =
  /(?<![\p{L}])(?:(?:para|com|de|dentre|sem|entre|a|por|contra|até|sobre|perante|desde|após)(?:[ \t ]+(?:todos|todas|ambos|ambas))?|e|ou|nem|como|quanto|ser|sou|é|era|foi|o|a|os|as|um|uma|uns|umas|dos|das|nos|nas|aos|pelos|pelas|meu|seu|teu|nosso|verdadeiro|próprio)[ \t ]+$|,[ \t ]*$/iu;

function push(
  ctx: DetectContext,
  m: RegExpExecArray,
  replacement: string,
  messageKey:
    "review_msg_pt_agreement" | "review_msg_pt_future_subjunctive" = "review_msg_pt_agreement",
): RawFinding | null {
  const typed = m.groups!.target;
  if (ctx.dictionary.has(typed.toLowerCase())) return null;
  const [start, end] = m.indices!.groups!.target;
  return {
    ruleId: "portugueseAgreement",
    messageKey,
    range: { start, end },
    alternatives: [applyWordCase(replacement, detectWordCase(typed))],
    context: { start: m.index, end: Math.max(end, m.index + m[0].length) },
  };
}

/** A verb before its plural subject takes its plural form from `table`. */
const postposed =
  (table: Record<string, string>): MatchFixer =>
  (m, ctx) => {
    const before = ctx.text.slice(Math.max(0, m.index - 16), m.index);
    if (SUBJECT_BEFORE.test(before)) return null;
    if (!subjectless(ctx, m)) return null;
    return push(ctx, m, table[m.groups!.target.toLowerCase()]);
  };

/** The same before a bare plural noun, whose spelling must tell its number and gender. */
const bare =
  (table: Record<string, string>): MatchFixer =>
  (m, ctx) => {
    const noun = m.groups!.noun;
    if (noun !== noun.toLowerCase() || /mos$/.test(noun) || new RegExp(`^(?:${TIME})$`).test(noun))
      return null;
    if (new RegExp(`^(?:${PLURAL_DETERMINER})$`).test(noun)) return null;
    const info = analyze(noun);
    if (!info?.plural || info.feminine === null) return null;
    if (SUBJECT_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 16), m.index))) return null;
    if (!subjectless(ctx, m)) return null;
    return push(ctx, m, table[m.groups!.target.toLowerCase()]);
  };

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  agreementPostposed: postposed(PLURAL),
  agreementPeriphrasis: postposed(AUXILIARY),
  agreementPerfect: postposed(PERFECT),
  agreementBare: bare(PLURAL),
  agreementBarePerfect: bare(PERFECT),
  agreementProprio: (m, ctx) => {
    const pronoun = m.groups!.pronoun.toLowerCase().replace(/^[nd]/, "");
    const typed = m.groups!.target.toLowerCase();
    const wanted = typed.replace(/[oa]s?$/, PROPRIO_ENDING[pronoun]);
    return wanted !== typed ? push(ctx, m, wanted) : null;
  },
  agreementIrregular: (m, ctx) => {
    const person = PRONOUN_PERSON[m.groups!.pronoun.toLowerCase().replace(/\s+/g, " ")];
    const typed = m.groups!.target.toLowerCase();
    const rows = FORM_ROWS.get(typed)!;
    const index = PERSONS.indexOf(person);
    if (rows.some((row) => row[index] === typed)) return null;
    if (person === "eles" && (typed === "tem" || typed === "vem")) return null;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (NOT_SUBJECT.test(before)) return null;
    // A capitalized "Eu" inside a sentence is a noun ("o verdadeiro Eu").
    if (/^\p{Lu}/u.test(m.groups!.pronoun) && !/(?:^|[.!?:;"“«]\s*)$/u.test(before)) return null;
    // "Nós é que sabemos": the cleft "é que" does not agree.
    // "Vi eles faz um ano": elapsed-time "fazer" has no subject.
    const after = ctx.text.slice(m.indices!.groups!.target[1], m.indices!.groups!.target[1] + 40);
    if (/^[ \t\u00a0]+que(?![\p{L}])/u.test(after)) return null;
    if (/^f[ia]z/.test(typed) && ELAPSED.test(after)) return null;
    const wanted = new Set(rows.map((row) => row[index]));
    return wanted.size === 1 ? push(ctx, m, [...wanted][0]) : null;
  },
  agreementRegularPlural: (m, ctx) => {
    const typed = m.groups!.target;
    const pronoun = m.groups!.pronoun.toLowerCase();
    if (
      typed !== typed.toLowerCase() ||
      NOT_VERBS.has(typed) ||
      FORM_ROWS.has(typed) ||
      typed.endsWith("mente")
    )
      return null;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (NOT_SUBJECT.test(before)) return null;
    let wanted: string | undefined;
    // The preterite: "eles gostou" -> "gostaram", "nós comeu" -> "comemos".
    const preterite = /([oei])u$/.exec(typed);
    if (preterite) {
      // "eles saiu" -> "saíram": an "i" after a vowel takes its accent.
      const hiatus = preterite[1] === "i" && /[au]iu$/.test(typed) && pronoun !== "nós";
      const vowel = hiatus ? "í" : { o: "a", e: "e", i: "i" }[preterite[1]]!;
      wanted = `${typed.slice(0, -2)}${vowel}${pronoun === "nós" ? "mos" : "ram"}`;
    } else if (pronoun !== "nós") wanted = `${typed}m`;
    // "nós gostava" -> "gostávamos", "nós gosta" -> "gostamos". "-ia" is either an imperfect
    // (comia) or a present (passeia, anuncia), so it stays.
    else if (/ava$/.test(typed)) wanted = `${typed.slice(0, -3)}ávamos`;
    else if (/[^i]a$/.test(typed)) wanted = `${typed}mos`;
    return wanted ? push(ctx, m, wanted) : null;
  },
  agreementSingular: (m, ctx) => {
    const typed = m.groups!.target;
    if (typed !== typed.toLowerCase() || NOT_PLURAL_VERBS.has(typed) || FORM_ROWS.has(typed))
      return null;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (NOT_SUBJECT.test(before)) return null;
    const wanted = singularOf(typed, m.groups!.pronoun.toLowerCase() === "eu");
    return wanted ? push(ctx, m, wanted) : null;
  },
  agreementFuture: (m, ctx) => {
    const { verb, person = "" } = m.groups!;
    return push(
      ctx,
      m,
      FUTURE_SUBJUNCTIVE[verb.toLowerCase()] + PERSON_ENDING[person],
      "review_msg_pt_future_subjunctive",
    );
  },
  agreementFutureBare: (m, ctx) => {
    const { lead, conj, verb, person = "" } = m.groups!;
    if (/^quando$/i.test(conj)) {
      if (QUESTION_LEAD.test(lead)) return null;
      const end = m.index + m[0].length;
      if (/^[^.!?\n]*\?/.test(ctx.text.slice(end, end + 160))) return null;
    }
    return push(
      ctx,
      m,
      FUTURE_SUBJUNCTIVE[verb.toLowerCase()] + PERSON_ENDING[person],
      "review_msg_pt_future_subjunctive",
    );
  },
  agreementNeuter: (m, ctx) => {
    const typed = m.groups!.target.toLowerCase();
    return push(ctx, m, typed === "boa" ? "bom" : typed.replace(/a$/, "o"));
  },
} satisfies Record<string, MatchFixer>;
