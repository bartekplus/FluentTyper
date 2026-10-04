import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, isLang, SPACE as S, WORD_END as W } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { FORM_ROWS, NOT_PLURAL_VERBS, NOT_VERBS, singularOf, TIME } from "./agreement";
import { graphWords } from "../wordGraph";
import type * as Data from "./verbs.generated";
import { reviewData } from "../reviewLanguageData";
import { analyze, SENTENCE_START } from "./nounAgreement";
import { infinitive } from "./infinitives";
import {
  type ClauseProfile,
  clauseTokensAfter,
  skipComplements,
  skipCoordinated,
  skipPostnominal,
  verbAfterRelative,
} from "../clauseReader";

/**
 * Verb agreement and verb forms that a closed frame can tell:
 * - a noun-phrase subject opening the sentence and its verb: "Os meninos dança" -> "dançam",
 *   "O menino gostam" -> "gosta";
 * - hours take the plural: "Já deu dez horas" -> "deram", "Está dando 10h" -> "Estão";
 * - "ser" agrees with the pronoun after it: "Quem fez foi eu" -> "fui";
 * - "trata-se de" and "precisa-se de" stay singular;
 * - a past or future verb right next to "ontem" or "amanhã": "Enviarão ontem" -> "Enviaram".
 * The subjunctive after "espero que", "embora"... is in subjunctive.ts.
 */

const ADVERBS = `(?:(?:não|já|ainda|também|sempre|nunca|só|quase)${S}){0,2}`;
const CLITIC = `(?:(?:se|me|te|lhe|lhes|nos)${S})?`;

type MessageKey =
  "review_msg_pt_agreement" | "review_msg_pt_tense_adverb" | "review_msg_pt_subjunctive";

function push(
  findings: RawFinding[],
  ctx: DetectContext,
  m: RegExpExecArray,
  group: string,
  alternatives: string[],
  messageKey: MessageKey = "review_msg_pt_agreement",
): void {
  const typed = m.groups![group];
  if (ctx.dictionary.has(typed.toLowerCase())) return;
  const [start, end] = m.indices!.groups![group];
  const style = detectWordCase(typed);
  findings.push({
    ruleId: "portugueseAgreement",
    messageKey,
    range: { start, end },
    alternatives: alternatives.map((alternative) => applyWordCase(alternative, style)),
    context: { start: Math.min(m.index, start), end: Math.max(end, m.index + m[0].length) },
    ...(alternatives.length > 1 && { requiresChoice: true }),
  });
}

// -------------------------------------------------------------- noun-phrase subjects

const PLURAL_LEAD =
  "os|as|uns|umas|estes|estas|esses|essas|aqueles|aquelas|meus|minhas|teus|tuas|seus|suas|nossos|nossas|alguns|algumas|muitos|muitas|vários|várias";
const SINGULAR_LEAD =
  "o|a|um|uma|este|esta|esse|essa|aquele|aquela|meu|minha|teu|tua|seu|sua|nosso|nossa";
const POSSESSIVE =
  "meus|minhas|teus|tuas|seus|suas|nossos|nossas|meu|minha|teu|tua|seu|sua|nosso|nossa";
const PLURAL_SUBJECT = `(?<lead>${PLURAL_LEAD})${S}(?:(?:${POSSESSIVE})${S})?(?<noun>\\p{L}{3,}(?:[aeo]s|ões|ães|ais|éis|óis|res|zes))${S}${ADVERBS}${CLITIC}(?<target>\\p{L}{2,}|é)${W}(?!-)`;
const SINGULAR_SUBJECT = `(?<lead>${SINGULAR_LEAD})${S}(?:(?:${POSSESSIVE})${S})?(?<noun>\\p{L}{3,})${S}${ADVERBS}${CLITIC}(?<target>\\p{L}{2,})${W}(?!-)`;
// Time spans and words that open an adverbial, not a subject: "Este ano vão abrir", "Os
// alunos dia 5 voltam", "Os jogadores fora de campo".
const NOT_SUBJECT_NOUNS = new Set(
  `${TIME} ano dia mês semana vez hora minuto segundo século momento período tempo fim verão
  inverno outono primavera sábado domingo gente resto pé cavalo`.split(/[\s|]+/),
);
const NOT_FINITE = new Set(
  `${[...NOT_VERBS].join(" ")} dia semana segunda terça quarta quinta sexta forma vez maneira
  hora mesmo inclusive exceto sequer cerca perante durante mediante conforme sobre desde dele dela
  deles delas nele nela neles nelas tem vem violeta creme rosa laranja cinza vinho bege lilás
  turquesa prata`.split(/\s+/),
);

/** The third person plural of a singular verb ("dança" -> "dançam", "saiu" -> "saíram"). */
function pluralOf(verb: string): string | undefined {
  for (const row of FORM_ROWS.get(verb) ?? []) if (row[1] === verb) return row[3];
  if (FORM_ROWS.has(verb)) return undefined;
  if (/ou$/.test(verb)) return `${verb.slice(0, -2)}aram`;
  if (/eu$/.test(verb)) return `${verb.slice(0, -2)}eram`;
  if (/[^a]iu$/.test(verb)) return `${verb.slice(0, -2)}iram`;
  if (/[^aeiou](?:a|e)$/.test(verb) || /(?:ia|ava)$/.test(verb)) return `${verb}m`;
  return undefined;
}

// "Os ficheiros cache são", "As palavras passe são": a word before a verb modifies the noun.
const VERB_AFTER =
  /^[ \t\u00a0]+(?:é|são|foi|foram|era|eram|está|estão|estava|estavam|tem|têm|vai|vão|fica|ficam|será|serão|parece|parecem)(?![\p{L}])/u;
// "Algumas coisas é melhor que não sejam ditas": an impersonal "é melhor que".
const IMPERSONAL_AFTER =
  /^[ \t\u00a0]+(?:melhor|pior|bom|importante|necessário|preciso|possível|difícil|fácil)[ \t\u00a0]+que(?![\p{L}])/u;

/** Whether the frame's noun and verb read as subject and verb. */
function subjectAndVerb(ctx: DetectContext, m: RegExpExecArray): boolean {
  const { lead, noun, target } = m.groups!;
  if (lead !== lead.replace(/^\p{Ll}/u, (c) => c.toUpperCase())) return false;
  if (!SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))) return false;
  if (noun !== noun.toLowerCase() || target !== target.toLowerCase()) return false;
  if (NOT_SUBJECT_NOUNS.has(noun) || NOT_FINITE.has(target) || /mente$/.test(target)) return false;
  const after = ctx.text.slice(m.indices!.groups!.target[1], m.indices!.groups!.target[1] + 40);
  // "Os meninos é que sabem": the cleft "é que" does not agree.
  if (/^[ \t\u00a0]+que(?![\p{L}])/u.test(after)) return false;
  return !VERB_AFTER.test(after) && !IMPERSONAL_AFTER.test(after);
}

function subjects(ctx: DetectContext, findings: RawFinding[]): void {
  for (const m of frameMatches(ctx, PLURAL_SUBJECT)) {
    if (!subjectAndVerb(ctx, m)) continue;
    const target = m.groups!.target;
    const wanted = pluralOf(target);
    if (wanted) push(findings, ctx, m, "target", [wanted]);
  }
  for (const m of frameMatches(ctx, SINGULAR_SUBJECT)) {
    const { lead, noun, target } = m.groups!;
    if (!subjectAndVerb(ctx, m) || /s$/.test(noun) || NOT_FINITE.has(noun)) continue;
    // "A pé vão mais rápido": "a" before a masculine noun is the preposition.
    if (/^a$/i.test(lead) && !/(?:a|ção|dade|gem|ice|ez)$/.test(noun)) continue;
    let wanted: string | undefined;
    const rows = FORM_ROWS.get(target);
    if (rows) {
      const row = rows.find((candidate) => candidate[3] === target && candidate[1] !== target);
      wanted = row?.[1];
    } else if (/[ae]m$/.test(target) && !NOT_PLURAL_VERBS.has(target) && !NOT_FINITE.has(target))
      wanted = singularOf(target, false);
    if (wanted) push(findings, ctx, m, "target", [wanted]);
  }
}

// -------------------------------------------------------------- subjects at a distance

const pt = (list: string) => new Set(list.split(/\s+/));
const PT_DETERMINERS = pt(
  `o a os as um uma uns umas este esta estes estas esse essa esses essas aquele aquela aqueles
  aquelas meu minha meus minhas teu tua teus tuas seu sua seus suas nosso nossa nossos nossas`,
);
const PT_PREPOSITIONS = pt(
  `de do da dos das em no na nos nas com para por pelo pela pelos pelas sobre entre sem contra
  desde ao aos à às`,
);
const PT_ADVERBS = pt("não já ainda também sempre nunca só quase aqui ali lá hoje ontem muito");
const PT_PLURAL_LEAD = new Set(PLURAL_LEAD.split("|"));
// Nouns of quantity, whose verb may agree with their complement ("a maioria das escolas estão").
const COLLECTIVE = pt(
  `maioria minoria metade parte resto porção porcentagem percentagem totalidade quantidade número
  grupo conjunto série dezena centena milhar milhão milhões bilhão bilhões par tipo espécie`,
);

// Finite endings, and the vowels of the present singular that the verb stems check them with:
// "falam" -> "fala", "comeu" -> "come", "partiram" -> "parti", "deixei" -> "deixa".
const FINITE: [RegExp, string[]][] = [
  [/^(\p{L}{2,}?)(?:a|am|ou|aram|ava|avam|ei|amos)$/u, ["a"]],
  [/^(\p{L}{2,}?)(?:e|em|eu|eram)$/u, ["e"]],
  [/^(\p{L}{2,}?)(?:iu|iram)$/u, ["i"]],
  [/^(\p{L}{2,}?)(?:ia|iam)$/u, ["e", "i"]],
];

/** A finite verb: an irregular row, or a regular form of a known stem. */
function ptVerb(w: string): boolean {
  if (FORM_ROWS.has(w)) return true;
  if (NOT_FINITE.has(w) || NOT_PLURAL_VERBS.has(w)) return false;
  return FINITE.some(([ending, vowels]) => {
    const stem = ending.exec(w)?.[1];
    return !!stem && vowels.some((vowel) => !!infinitive(stem + vowel));
  });
}

/** The Portuguese words of the shared clause reader. Portuguese has no verb lexicon, so the
 * reader reads only what the endings show. */
const PORTUGUESE_CLAUSE: ClauseProfile = {
  determiners: PT_DETERMINERS,
  prepositions: PT_PREPOSITIONS,
  quantifiers: pt("todos todas alguns algumas muitos muitas vários várias poucos poucas"),
  numbers: pt("dois duas três quatro cinco seis sete oito nove dez cem mil"),
  notHeads: new Set([...PT_DETERMINERS, ...PT_PREPOSITIONS, ...NOT_FINITE, "que", "quem"]),
  coordinators: pt("e ou"),
  joins: pt("e"),
  pronouns: pt("mim ti ele ela eles elas nós vós você vocês"),
  relatives: pt("que"),
  clitics: pt("não já se me te lhe lhes nos"),
  isAdverb: (t) => PT_ADVERBS.has(t.w) || (/mente$/.test(t.w) && t.w.length > 6),
  isNoun: (text, t) =>
    text.slice(t.start, t.end) === t.w
      ? !!analyze(t.w)
      : /^\p{Lu}\p{Ll}+$/u.test(text.slice(t.start, t.end)),
  nominal: () => false,
  // "as cartas enviadas": a participle.
  postnominal: (t) => !!t && /^\p{L}{3,}(?:ad|id)[oa]s?$/u.test(t.w),
  prenominal: (_text, _tokens, i) => i,
  isFiniteVerb: (t) => ptVerb(t.w),
};

/** "A lista dos produtos estão", "Os preços da casa que comprei sobe": a subject read past its
 * complements, a second noun phrase or a relative clause by the shared clause reader. */
function distantSubjects(ctx: DetectContext, findings: RawFinding[]): void {
  for (const m of frameMatches(ctx, `(?<target>${PLURAL_LEAD}|${SINGULAR_LEAD})${S}(?=\\p{L})`)) {
    const lead = m.groups!.target;
    if (lead !== lead.replace(/^\p{Ll}/u, (c) => c.toUpperCase())) continue;
    if (!SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))) continue;
    const tokens = clauseTokensAfter(ctx.text, m.index, 16);
    const noun = tokens[1] && !tokens[1].hyphen ? analyze(tokens[1].w) : null;
    if (!noun || NOT_SUBJECT_NOUNS.has(tokens[1].w) || COLLECTIVE.has(tokens[1].w)) continue;
    // "A norte de França": "a" before a noun that is not surely feminine may be the preposition.
    if (tokens[0].w === "a" && noun.feminine !== true) continue;
    if (ctx.text.slice(tokens[1].start, tokens[1].end) !== tokens[1].w) continue;
    let plural = PT_PLURAL_LEAD.has(tokens[0].w);
    if (noun.plural !== plural) continue;
    const head = skipPostnominal(PORTUGUESE_CLAUSE, tokens, 2);
    const joined = skipCoordinated(PORTUGUESE_CLAUSE, ctx.text, tokens, head);
    if (joined > head) plural = true;
    const end = skipComplements(PORTUGUESE_CLAUSE, ctx.text, tokens, joined);
    const relative = verbAfterRelative(PORTUGUESE_CLAUSE, ctx.text, tokens, end, () => true);
    let at = relative;
    if (at < 0 && (end > joined || joined > head)) {
      at = end;
      while (tokens[at] && PORTUGUESE_CLAUSE.clitics.has(tokens[at].w)) at++;
      // "Os livros de capa dura custam": a word right before another verb is an adjective.
      if (at === end && tokens[at + 1] && ptVerb(tokens[at + 1].w)) continue;
    }
    const verb = tokens[at];
    if (!verb || verb.hyphen || !ptVerb(verb.w) || /mente$/.test(verb.w)) continue;
    if (ctx.text.slice(verb.start, verb.end) !== verb.w || ctx.dictionary.has(verb.w)) continue;
    const after = ctx.text.slice(verb.end, verb.end + 40);
    // "O problema dos preços são os impostos": "ser" may agree with the noun phrase after it.
    if (/^(?:é|são|foi|foram|era|eram|será|serão|seja|sejam)$/.test(verb.w)) continue;
    if (/^[ \t\u00a0]+que(?![\p{L}])/u.test(after) || IMPERSONAL_AFTER.test(after)) continue;
    let wanted: string | undefined;
    if (plural) {
      if (!/[ae]m$|ão$/.test(verb.w)) wanted = pluralOf(verb.w);
    } else {
      const rows = FORM_ROWS.get(verb.w);
      if (rows) wanted = rows.find((row) => row[3] === verb.w && row[1] !== verb.w)?.[1];
      else if (/[ae]m$/.test(verb.w)) wanted = singularOf(verb.w, false);
    }
    if (!wanted || wanted === verb.w) continue;
    findings.push({
      ruleId: "portugueseAgreement",
      messageKey: "review_msg_pt_agreement",
      range: { start: verb.start, end: verb.end },
      alternatives: [wanted],
      context: { start: m.index, end: verb.end },
    });
  }
}

// -------------------------------------------------------------- hours

const HOUR_VERBS: Record<string, string> = {
  deu: "deram",
  bateu: "bateram",
  soou: "soaram",
  dava: "davam",
  batia: "batiam",
  soava: "soavam",
  dará: "darão",
  baterá: "baterão",
  soará: "soarão",
  daria: "dariam",
  bateria: "bateriam",
};
const HOUR_AUXILIARIES: Record<string, string> = {
  vai: "vão",
  ia: "iam",
  está: "estão",
  estava: "estavam",
  tinha: "tinham",
  havia: "haviam",
  pode: "podem",
  deve: "devem",
};
// Two o'clock or later: "uma hora" and "meio-dia" stay singular.
const HOUR = `(?:as${S})?(?:duas|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|0?[2-9]|1\\d|2[0-3])(?:(?:${S})?(?:h|hs|horas)${W}|:[0-5]\\d(?!\\d)|${S}d[ae]${S}(?:manhã|tarde|noite|madrugada)${W})`;
const HOUR_FRAME = `(?<target>${Object.keys(HOUR_VERBS).join("|")})(?=${S}${HOUR})`;
const HOUR_PERIPHRASIS = `(?<target>${Object.keys(HOUR_AUXILIARIES).join("|")})(?=${S}(?:dar|bater|soar|dando|batendo|soando|dado|batido|soado)${S}${HOUR})`;
// Nothing but a sentence start or a conjunction before: "O sino bateu dez horas" has its
// subject.
const CLAUSE_OPENING =
  /(?:(?:^|[.!?;:\n]["'”’»)]*)[ \t\u00a0]*|(?:^|[^\p{L}])(?:quando|que|até|mal|se|enquanto)[ \t\u00a0]+)(?:(?:já|não|ainda|nem|quase)[ \t\u00a0]+)*$/iu;

function hours(ctx: DetectContext, findings: RawFinding[]): void {
  for (const [pattern, table] of [
    [HOUR_FRAME, HOUR_VERBS],
    [HOUR_PERIPHRASIS, HOUR_AUXILIARIES],
  ] as const) {
    for (const m of frameMatches(ctx, pattern)) {
      if (!CLAUSE_OPENING.test(ctx.text.slice(Math.max(0, m.index - 40), m.index))) continue;
      push(findings, ctx, m, "target", [table[m.groups!.target.toLowerCase()]]);
    }
  }
}

// -------------------------------------------------------------- ser + pronoun

const SER_PRONOUN: Record<string, Record<string, string>> = {
  foi: { eu: "fui", nós: "fomos", eles: "foram", elas: "foram", vocês: "foram" },
  é: { eu: "sou", nós: "somos", eles: "são", elas: "são", vocês: "são" },
  será: { eu: "serei", nós: "seremos", eles: "serão", elas: "serão", vocês: "serão" },
};
const SER_PRONOUN_FRAME = `(?<target>foi|é|será)${S}(?<pronoun>eu|nós|eles|elas|vocês)(?=[ \\t\\u00a0]{0,2}(?:[.!?,;:]|$)|${S}(?:que|quem|mesm[oa]s?|própri[oa]s?)${W})`;

// -------------------------------------------------------------- trata-se de

const IMPERSONAL_SE = `(?<target>tratam|precisam|necessitam)-se${S}de${W}(?!${S}(?:manhã|tarde|noite|madrugada|forma|maneira|modo)${W})`;

// -------------------------------------------------------------- tense next to ontem/amanhã

let rStems: Set<string> | undefined;
/** "esperam", "para": a present tense of an -rar verb, not a preterite or pluperfect. */
const present = (verb: string) =>
  (rStems ??= new Set(graphWords(reviewData<typeof Data>("pt").PORTUGUESE_R_STEMS))).has(
    verb.replace(/(?:am|a)$/, ""),
  );
const FUTURE = "\\p{L}{2,}(?:ar|er|ir)(?:ão|á|ei)";
const PAST = "\\p{L}{2,}(?:aram|eram|iram|ara|era|ira)";
const DETERMINER_BEFORE =
  /(?:^|[^\p{L}])(?:o|a|os|as|um|uma|do|da|no|na|pelo|pela|este|esse|aquele|meu|seu|nosso)[ \t\u00a0]+$/iu;
const TENSE_FRAMES = [
  `(?<target>${FUTURE})${S}(?:ontem|anteontem)${W}`,
  `(?:ontem|anteontem),?${S}(?<target>${FUTURE})${W}`,
  `(?<target>${PAST})${S}amanhã${W}`,
  `amanhã,?${S}(?<target>${PAST})${W}`,
];

function pastOf(future: string): string[] {
  const stem = future.replace(/(?:ão|á|ei)$/, "");
  const vowel = stem.slice(-2, -1);
  if (/ão$/.test(future)) return [`${stem}am`];
  if (/ei$/.test(future)) return [`${stem.slice(0, -2)}${vowel === "a" ? "ei" : "i"}`];
  const preterite = `${stem.slice(0, -2)}${{ a: "ou", e: "eu", i: "iu" }[vowel]}`;
  return [preterite, `${stem}a`];
}

function tenses(ctx: DetectContext, findings: RawFinding[]): void {
  for (const pattern of TENSE_FRAMES) {
    for (const m of frameMatches(ctx, pattern)) {
      const target = m.groups!.target.toLowerCase();
      const [start] = m.indices!.groups!.target;
      if (DETERMINER_BEFORE.test(ctx.text.slice(Math.max(0, start - 12), start))) continue;
      if (/ra?m?$/.test(target) && !/[áã]/.test(target)) {
        if (present(target)) continue;
        const future = target.endsWith("m")
          ? `${target.slice(0, -2)}ão`
          : `${target.slice(0, -1)}á`;
        push(findings, ctx, m, "target", [future], "review_msg_pt_tense_adverb");
      } else push(findings, ctx, m, "target", pastOf(target), "review_msg_pt_tense_adverb");
    }
  }
}

export function verbAgreement(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  subjects(ctx, findings);
  distantSubjects(ctx, findings);
  hours(ctx, findings);
  for (const m of frameMatches(ctx, SER_PRONOUN_FRAME)) {
    const verb = m.groups!.target.toLowerCase();
    push(findings, ctx, m, "target", [SER_PRONOUN[verb][m.groups!.pronoun.toLowerCase()]]);
  }
  for (const m of frameMatches(ctx, IMPERSONAL_SE)) {
    if (!SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))) continue;
    push(findings, ctx, m, "target", [m.groups!.target.slice(0, -1)]);
  }
  tenses(ctx, findings);
  return findings;
}
