import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";

/**
 * Commas Portuguese requires in pairs or before a name.
 * - A parenthetical expression opened by a comma is closed by one ("Foi, no entanto bem
 *   feito" -> "no entanto,"), and one closed by a comma is opened by one ("Disse no entanto,
 *   que" -> "Disse, no entanto, que").
 * - A greeting or thanks before the name it addresses ("Bom dia Ana" -> "Bom dia, Ana").
 * - A repeated "não" or "sim" answering a question ("Não não quero" -> "Não, não quero").
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

function push(findings: RawFinding[], m: RegExpExecArray, replace: (typed: string) => string) {
  const [start, end] = m.indices!.groups!.target;
  const typed = m.groups!.target;
  findings.push({
    ruleId: "portugueseCommas",
    messageKey: "review_msg_pt_comma",
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
  return findings;
}
