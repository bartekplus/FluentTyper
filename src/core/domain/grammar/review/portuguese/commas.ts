import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";

/**
 * Commas Portuguese requires in pairs or before a name.
 * - A parenthetical expression opened by a comma is closed by one ("Foi, no entanto bem
 *   feito" -> "no entanto,"), and one closed by a comma is opened by one ("Disse no entanto,
 *   que" -> "Disse, no entanto, que").
 * - A greeting or thanks before the name it addresses ("Bom dia Ana" -> "Bom dia, Ana").
 * - A repeated "não" or "sim" answering a question ("Não não quero" -> "Não, não quero").
 * - "Por exemplo" opening a sentence ("Por exemplo hoje choveu").
 * - A letter's greeting or closing on a line of its own ("Prezado Senhor", "Atenciosamente").
 * - A question opened by a question word and "é que" ends with "?" ("O que é que houve.").
 */

const S = SPACE;
const W = WORD_END;
// Expressions that only ever stand apart from the clause. Left out because they also
// read as ordinary words: "em geral" ("os carros, em geral caros,"), "no fundo" ("no fundo
// do mar"), "isto é" ("isto é o que quero"), "de fato" ("um casal de fato").
const PARENTHETICAL = `no${S}entanto|na${S}verdade|além${S}disso|por${S}outro${S}lado|por${S}assim${S}dizer|ou${S}seja|a${S}meu${S}ver|aliás|em${S}contrapartida|por${S}conseguinte|em${S}suma`;
// Expressions that are asides only when a comma closes them: "portanto" inside a clause,
// "com efeito retroativo", "por exemplo o Brasil".
const ADVERBS = `portanto|contudo|todavia|entretanto|por${S}exemplo|não${S}obstante|com${S}efeito|em${S}resumo`;
// A conjunction or the start of a clause before the expression needs no comma.
const NO_COMMA_BEFORE =
  /^(?:e|mas|ou|nem|que|pois|porém|se|quando|como|onde|porque|então|logo|assim|também)$/iu;
const GREETINGS = `bom${S}dia|boa${S}tarde|boa${S}noite|olá|oi|obrigad[oa]|tchau|parabéns|feliz${S}aniversário`;

// ", no entanto está bem" -> ", no entanto, está bem": a word follows without a comma.
const UNCLOSED = `(?<=,)${S}(?<target>(?:${PARENTHETICAL})|por${S}exemplo(?=${S}que${W}))(?=${S}[\\p{L}\\d])`;
// "Disse no entanto, que" -> "Disse, no entanto, que".
// "além disso" also means "beyond that" ("não via nada além disso,").
const UNOPENED = `(?<lead>\\p{L}+)(?<target>${S})(?!além${W})(?:${PARENTHETICAL}|${ADVERBS})${W}(?=,)`;
const GREETING = `(?<=^|[.!?;:\\n][ \\t\\u00a0]{0,8})(?:${GREETINGS})(?<target>${S})(?=\\p{Lu}\\p{Ll}+(?:[ \\t\\u00a0]{0,8}[.!?,]|$))`;
const REPEATED = `(?<=^|[.!?;:\\n][ \\t\\u00a0]{0,8})(?<first>não|sim)(?<target>${S})(?=\\k<first>${W})`;

const OPENER = `(?<=^|[.!?;:\\n][ \\t\\u00a0]{0,8})por${S}exemplo(?<target>${S})(?=\\p{Ll}{2,}${W})(?!(?:de|do|da|que)${W})`;
// A whole line that greets or signs off a letter.
const CLOSINGS = `atenciosamente|cordialmente|respeitosamente|cumprimentos|melhores${S}cumprimentos|com${S}os${S}melhores${S}cumprimentos|saudações|abraços|um${S}abraço|um${S}grande${S}abraço|beijos|grato${S}pela${S}atenção|grata${S}pela${S}atenção|obrigad[oa]${S}pela${S}atenção`;
const LINE_END = `(?=[ \\t\\u00a0]{0,8}(?:\\n|$))`;
const CLOSING = `(?<=^|\\n)[ \\t\\u00a0]{0,8}(?=(?:${CLOSINGS})[.;]?${LINE_END})(?:\\p{L}{1,30}${S}){0,6}(?<target>\\p{L}{1,30}[.;]?)${LINE_END}`;
const GREETING_LINE = `(?<=^|\\n)[ \\t\\u00a0]{0,8}(?:prezad[oa]s?|car[oa]s?|estimad[oa]s?|querid[oa]s?)(?:${S}(?:senhor(?:a|es|as)?|sr\\.?|sra\\.?|dr\\.?|dra\\.?|doutor(?:a)?|professor(?:a)?|\\p{Lu}[\\p{L}.]*|e|senhores|senhoras|colegas|amigos|amigas|clientes)){0,4}${S}(?<target>[\\p{L}.]{1,30}!?)${LINE_END}`;
const ASKS = `(?<=^|[.!?;\\n][ \\t\\u00a0]{0,8})(?:quem|o${S}que|que|como|onde|de${S}onde|aonde|quando|por${S}que|qual|quanto|quantos|quantas)${S}(?:foi|é|era)${S}que${W}[^.!?\\n]{1,160}?(?<target>\\.)(?=[ \\t\\u00a0]*(?:\\n|$|\\p{Lu}))`;

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
  findings.push({
    ruleId: "portugueseCommas",
    messageKey,
    range: { start, end },
    alternatives: [replace(typed)],
    context: { start: m.index, end: Math.max(end, m.index + m[0].length) },
  });
}

export function commas(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, UNCLOSED)) push(findings, m, (typed) => `${typed},`);
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
