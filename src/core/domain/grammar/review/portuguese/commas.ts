import { frameMatches, SPACE, WORD_END, isLang } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { finding } from "../finding";

/**
 * Commas Portuguese requires in pairs or before a name.
 * - A parenthetical expression opened by a comma is closed by one ("Foi, no entanto bem
 *   feito" -> "no entanto,"), and one closed by a comma is opened by one ("Disse no entanto,
 *   que" -> "Disse, no entanto, que").
 * - After a conjunction, an aside takes both commas ("e além disso, trouxe" -> "e, além
 *   disso,"; "e, no fundo ficou" -> "e, no fundo, ficou").
 * - A greeting or thanks before the name it addresses ("Bom dia Ana" -> "Bom dia, Ana").
 * - A repeated "não" or "sim" answering a question ("Não não quero" -> "Não, não quero").
 * - "Por exemplo" opening a sentence ("Por exemplo hoje choveu").
 * - An emphatic "sim" between a modal and its infinitive ("Devemos, sim, lutar"), the
 *   addressee after an answer ("sim, senhor!") and "mas" before an aside ("bem, mas, como").
 * - A letter's greeting or closing on a line of its own ("Prezado Senhor", "Atenciosamente").
 * - A question opened by a question word and "é que" ends with "?" ("O que é que houve.").
 * - "mas" opening a clause after a word ("Adoro doce mas engorda" -> "doce, mas").
 */

const S = SPACE;
const W = WORD_END;
// Expressions that only ever stand apart from the clause. Left out because they also
// read as ordinary words: "em geral" ("os carros, em geral caros,"), "no fundo" ("no fundo
// do mar"), "isto é" ("isto é o que quero"), "de fato" ("um casal de fato").
const PARENTHETICAL = `no${S}entanto|na${S}verdade|além${S}disso|por${S}outro${S}lado|por${S}assim${S}dizer|ou${S}seja|a${S}meu${S}ver|aliás|em${S}contrapartida|por${S}conseguinte|em${S}suma`;
// Expressions that are asides only when a comma closes them: "portanto" inside a clause,
// "com efeito retroativo", "por exemplo o Brasil".
const ADVERBS = `portanto|contudo|todavia|entretanto|outrossim|por${S}exemplo|não${S}obstante|com${S}efeito|em${S}resumo`;
// Asides only right after a conjunction: "e no fundo, ficou" but "caiu no fundo, e".
const AFTER_CONJUNCTION = `${PARENTHETICAL}|${ADVERBS}|no${S}fundo|em${S}geral|ao${S}mesmo${S}tempo`;
// A conjunction or the start of a clause before the expression needs no comma.
const NO_COMMA_BEFORE =
  /^(?:e|mas|ou|nem|que|pois|porém|se|quando|como|onde|porque|então|logo|assim|também)$/iu;
const GREETINGS = `bom${S}dia|boa${S}tarde|boa${S}noite|olá|oi|obrigad[oa]|tchau|parabéns|feliz${S}aniversário|feliz${S}natal|feliz${S}ano${S}novo|feliz${S}páscoa|bem-vind[oa]s?|até${S}logo|até${S}amanhã|com${S}licença`;

// ", no entanto está bem" -> ", no entanto, está bem": a word follows without a comma.
const UNCLOSED = `(?<=,)${S}(?<target>(?:${PARENTHETICAL})|por${S}exemplo(?=${S}que${W}))(?=${S}[\\p{L}\\d])`;
// "Disse no entanto, que" -> "Disse, no entanto, que".
// "além disso" also means "beyond that" ("não via nada além disso,").
const UNOPENED = `(?<lead>\\p{L}+)(?<target>${S})(?!além${W})(?:${PARENTHETICAL}|${ADVERBS})${W}(?=,)`;
// "e além disso, está" -> "e, além disso, está": the aside a comma closes opens after
// the conjunction too.
// Not at a sentence start: "Mas na verdade, ninguém sabe" opens with the aside.
const CONJUNCTION_UNOPENED = `(?<=[\\p{L}\\d,][ \\t\\u00a0]{1,8})(?:e|mas|ou|nem)(?<target>${S})(?:${AFTER_CONJUNCTION})${W}(?=,)`;
// "e, no fundo ficou" -> "e, no fundo, ficou": a comma after the conjunction opens an aside.
const CONJUNCTION_UNCLOSED = `(?<=(?<![\\p{L}])(?:e|mas|ou|nem),)${S}(?<target>${AFTER_CONJUNCTION})(?=${S}[\\p{L}\\d])`;
const GREETING = `(?<=^|[.!?;:\\n][ \\t\\u00a0]{0,8})(?:${GREETINGS})(?<target>${S})(?=\\p{Lu}\\p{Ll}+(?:[ \\t\\u00a0]{0,8}[.!?,]|$))`;
const REPEATED = `(?<=^|[.!?;:\\n][ \\t\\u00a0]{0,8})(?<first>não|sim)(?<target>${S})(?=\\k<first>${W})`;

const OPENER = `(?<=^|[.!?;:\\n][ \\t\\u00a0]{0,8})por${S}exemplo(?<target>${S})(?=\\p{Ll}{2,}${W})(?!(?:de|do|da|que)${W})`;
// A whole line that greets or signs off a letter.
const CLOSINGS = `atenciosamente|cordialmente|respeitosamente|cumprimentos|melhores${S}cumprimentos|com${S}os${S}melhores${S}cumprimentos|saudações|abraços|um${S}abraço|um${S}grande${S}abraço|beijos|grato${S}pela${S}atenção|grata${S}pela${S}atenção|obrigad[oa]${S}pela${S}atenção`;
const LINE_END = `(?=[ \\t\\u00a0]{0,8}(?:\\n|$))`;
const CLOSING = `(?<=^|\\n)[ \\t\\u00a0]{0,8}(?=(?:${CLOSINGS})[.;]?${LINE_END})(?:\\p{L}{1,30}${S}){0,6}(?<target>\\p{L}{1,30}[.;]?)${LINE_END}`;
const GREETING_LINE = `(?<=^|\\n)[ \\t\\u00a0]{0,8}(?:prezad[oa]s?|car[oa]s?|estimad[oa]s?|querid[oa]s?)(?:${S}(?:senhor(?:a|es|as)?|sr\\.?|sra\\.?|dr\\.?|dra\\.?|doutor(?:a)?|professor(?:a)?|\\p{Lu}[\\p{L}.]*|e|senhores|senhoras|colegas|amigos|amigas|clientes)){0,4}${S}(?<target>[\\p{L}.]{1,30}!?)${LINE_END}`;
const ASKS = `(?<=^|[.!?;\\n][ \\t\\u00a0]{0,8})(?:quem|o${S}que|que|como|onde|de${S}onde|aonde|quando|por${S}que|qual|quanto|quantos|quantas)${S}(?:foi|é|era)${S}que${W}[^.!?\\n]{1,160}?(?<target>\\.)(?=[ \\t\\u00a0]*(?:\\n|$|\\p{Lu}))`;

// "Devemos sim lutar" -> "Devemos, sim, lutar": an emphatic "sim" between a modal and its
// infinitive stands between commas.
const MODALS =
  "devo|deve|devemos|devem|deveria|deveríamos|deveriam|posso|pode|podemos|podem|poderia|poderíamos|poderiam|quero|quer|queremos|querem|vou|vai|vamos|vão|preciso|precisa|precisamos|precisam";
const EMPHATIC_SIM = `(?:${MODALS})(?<before>,?)${S}sim(?<after>,?)(?=${S}\\p{Ll}+(?:ar|er|ir|or)${W})`;
// "sim senhor!", "não senhora.": the addressee after the answer.
const ANSWER_ADDRESS = `(?:sim|não)(?<target>${S})(?=senhor(?:a|es|as)?[ \\t\\u00a0]{0,8}[.!?,;])`;
// "as melhores intenções mas, porque..." -> ", mas,": an aside after "mas" means "mas" opens a
// clause, which takes a comma before it.
const MAS_ASIDE = `(?<lead>\\p{L}+|\\d+|\\))(?<target>${S})mas(?=,)`;

// "Adoro doce mas engorda" -> "doce, mas": "mas" opening a clause after a word.
const MAS_CLAUSE = `(?<lead>\\p{L}+)(?<target>${S})mas(?=${S}(?:eu|tu|ele|ela|você|nós|eles|elas|vocês|não|nunca|já|ainda|faz|fez|tem|tinha|há|havia|acho|parece)${W})`;
// "É caro mas é bom": a copula after "mas" opens a clause too, once a clause stands before it
// ("Simples mas é bom" coordinates a bare adjective). "Vai mas é trabalhar", an emphatic "mas
// é" before an infinitive, stays.
const MAS_COPULA = `(?<=\\p{L}[ \\t\\u00a0]{1,8})(?<lead>\\p{L}+)(?<target>${S})mas(?=${S}(?:é|era|foi|são|eram|foram|está|estava|estão|será|seria)${W}(?!${S}\\p{Ll}+[aei]r${W}))`;
// Words after which "mas" needs no comma: "não só ... mas", "nem ... mas".
const MAS_NO_COMMA = /^(?:e|ou|nem|não|só|somente|apenas|mas|que|porém)$/iu;

const SUBJECTS = new Set("eu tu ele ela você nós eles elas vocês".split(" "));
// "Como é que ele descobriu é um mistério", "O que ele quer eu não sei": an indirect question
// inside a statement has a second verb of its own.
const STATEMENT_VERB = new Set(
  "é era foi será sei sabe sabem sabemos saber pergunto mistério depende interessa importa".split(
    " ",
  ),
);

/** Whether the words after "é que" read as a direct question, not part of a statement. */
function direct(rest: string): boolean {
  const words = rest.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.some((word) => STATEMENT_VERB.has(word))) return false;
  return !words.some((word, index) => index > 0 && SUBJECTS.has(word));
}

function push(
  findings: RawFinding[],
  m: RegExpExecArray,
  replace: (typed: string) => string,
  messageKey: "review_msg_pt_comma" | "review_msg_pt_question_mark" = "review_msg_pt_comma",
) {
  const [start, end] = m.indices!.groups!.target;
  const typed = m.groups!.target;
  findings.push(
    finding("portugueseCommas", messageKey, start, end, [replace(typed)], {
      context: { start: m.index, end: Math.max(end, m.index + m[0].length) },
    }),
  );
}

// styleIntroductoryComma (opt-in): an opening phrase that the comma usually sets off ("Por
// favor faça" -> "Por favor, faça"; "Infelizmente não deu"). Writers often leave it out.
const OPENING_PHRASES = `por${S}favor|além${S}disso|no${S}entanto|na${S}verdade|por${S}outro${S}lado|ou${S}seja|em${S}suma|em${S}resumo|por${S}fim|enfim|aliás|contudo|todavia|portanto|porém|infelizmente|felizmente|sinceramente|obviamente|evidentemente|certamente|finalmente`;
const OPENING = `(?<=^|[.!?;\\n][ \\t\\u00a0]{0,8})(?:${OPENING_PHRASES})(?<target>${S})(?=\\p{Ll}+${W})(?!(?:de|do|da|dos|das|que|tudo)${W})`;

export function introductoryCommas(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  return [...frameMatches(ctx, OPENING)].map((m) => {
    const [start, end] = m.indices!.groups!.target;
    return {
      ruleId: "styleIntroductoryComma",
      messageKey: "review_msg_introductory_comma",
      range: { start, end },
      alternatives: [`,${m.groups!.target}`],
      context: { start: m.index, end },
    };
  });
}

export function commas(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, UNCLOSED)) push(findings, m, (typed) => `${typed},`);
  for (const m of frameMatches(ctx, CONJUNCTION_UNOPENED))
    push(findings, m, (typed) => `,${typed}`);
  for (const m of frameMatches(ctx, CONJUNCTION_UNCLOSED))
    push(findings, m, (typed) => `${typed},`);
  for (const m of frameMatches(ctx, UNOPENED)) {
    if (NO_COMMA_BEFORE.test(m.groups!.lead)) continue;
    push(findings, m, (typed) => `,${typed}`);
  }
  for (const m of frameMatches(ctx, GREETING)) {
    // Frames ignore case; the addressee is a capitalized name.
    if (!/^\p{Lu}/u.test(ctx.text.slice(m.indices!.groups!.target[1]))) continue;
    push(findings, m, (typed) => `,${typed}`);
  }
  for (const m of frameMatches(ctx, REPEATED)) push(findings, m, (typed) => `,${typed}`);
  for (const m of frameMatches(ctx, OPENER)) push(findings, m, (typed) => `,${typed}`);
  for (const m of frameMatches(ctx, ANSWER_ADDRESS)) push(findings, m, (typed) => `,${typed}`);
  for (const m of [...frameMatches(ctx, MAS_CLAUSE), ...frameMatches(ctx, MAS_COPULA)]) {
    if (MAS_NO_COMMA.test(m.groups!.lead)) continue;
    push(findings, m, (typed) => `,${typed}`);
  }
  for (const m of frameMatches(ctx, MAS_ASIDE)) {
    if (/^(?:e|ou|nem)$/iu.test(m.groups!.lead)) continue;
    push(findings, m, (typed) => `,${typed}`);
  }
  for (const m of frameMatches(ctx, EMPHATIC_SIM, null)) {
    const { before, after } = m.groups!;
    if (before && after) continue;
    const [start] = m.indices!.groups!.before;
    const end = m.index + m[0].length;
    if (start < ctx.from || start >= ctx.to) continue;
    const typed = ctx.text.slice(start, end);
    findings.push({
      ruleId: "portugueseCommas",
      messageKey: "review_msg_pt_comma",
      range: { start, end },
      alternatives: [`, ${typed.replace(/^,?[ \t ]+/, "").replace(/,$/, "")},`],
      context: { start: m.index, end },
    });
  }
  for (const m of frameMatches(ctx, CLOSING))
    push(findings, m, (typed) => typed.replace(/[.;]?$/, ","));
  for (const m of frameMatches(ctx, GREETING_LINE)) {
    // The line names someone: a capitalized word or a title after the greeting word.
    if (!/[ \t ]\p{Lu}|senhor|doutor|professor|colegas|amig|clientes/u.test(m[0])) continue;
    push(findings, m, (typed) => typed.replace(/!?$/, ","));
  }
  for (const m of frameMatches(ctx, ASKS)) {
    if (!direct(m[0].replace(/^.*?(?:foi|é|era)[ \t\u00a0]+que/isu, ""))) continue;
    push(findings, m, () => "?", "review_msg_pt_question_mark");
  }
  return findings;
}
