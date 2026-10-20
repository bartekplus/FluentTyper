import type { MatchFixer } from "../../engine/reviewRules";
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
 * The frames are in grammar/rules/pt_BR.yaml.
 */

// A conjunction or the start of a clause before the expression needs no comma.
const NO_COMMA_BEFORE =
  /^(?:e|mas|ou|nem|que|pois|porém|se|quando|como|onde|porque|então|logo|assim|também)$/iu;
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
  m: RegExpExecArray,
  replace: (typed: string) => string,
  messageKey: "review_msg_pt_comma" | "review_msg_pt_question_mark" = "review_msg_pt_comma",
) {
  const [start, end] = m.indices!.groups!.target;
  const typed = m.groups!.target;
  return finding("portugueseCommas", messageKey, start, end, [replace(typed)], {
    context: { start: m.index, end: Math.max(end, m.index + m[0].length) },
  });
}
const after = (typed: string) => `${typed},`;
const before = (typed: string) => `,${typed}`;

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  commaAfter: (m) => push(m, after),
  commaBefore: (m) => push(m, before),
  commaUnopened: (m) => (NO_COMMA_BEFORE.test(m.groups!.lead) ? null : push(m, before)),
  // Frames ignore case; the addressee is a capitalized name.
  commaGreeting: (m, ctx) =>
    /^\p{Lu}/u.test(ctx.text.slice(m.indices!.groups!.target[1])) ? push(m, before) : null,
  commaMasClause: (m) => (MAS_NO_COMMA.test(m.groups!.lead) ? null : push(m, before)),
  commaMasAside: (m) => (/^(?:e|ou|nem)$/iu.test(m.groups!.lead) ? null : push(m, before)),
  commaEmphaticSim: (m, ctx) => {
    const { before, after } = m.groups!;
    if (before && after) return null;
    const [start] = m.indices!.groups!.before;
    const end = m.index + m[0].length;
    if (start < ctx.from || start >= ctx.to) return null;
    const typed = ctx.text.slice(start, end);
    return {
      ruleId: "portugueseCommas",
      messageKey: "review_msg_pt_comma",
      range: { start, end },
      alternatives: [`, ${typed.replace(/^,?[ \t\u00a0]+/, "").replace(/,$/, "")},`],
      context: { start: m.index, end },
    };
  },
  commaClosing: (m) => push(m, (typed) => typed.replace(/[.;]?$/, ",")),
  commaGreetingLine: (m) =>
    // The line names someone: a capitalized word or a title after the greeting word.
    /[ \t\u00a0]\p{Lu}|senhor|doutor|professor|colegas|amig|clientes/u.test(m[0])
      ? push(m, (typed) => typed.replace(/!?$/, ","))
      : null,
  commaAsks: (m) =>
    direct(m[0].replace(/^.*?(?:foi|é|era)[ \t\u00a0]+que/isu, ""))
      ? push(m, () => "?", "review_msg_pt_question_mark")
      : null,
  introductoryComma: (m) => {
    const [start, end] = m.indices!.groups!.target;
    return {
      ruleId: "styleIntroductoryComma",
      messageKey: "review_msg_introductory_comma",
      range: { start, end },
      alternatives: [`,${m.groups!.target}`],
      context: { start: m.index, end },
    };
  },
} satisfies Record<string, MatchFixer>;
