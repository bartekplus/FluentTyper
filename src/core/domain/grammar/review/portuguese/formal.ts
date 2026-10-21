import { finding } from "../finding";
import type { MatchFixer } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { conjugate } from "./style";

/**
 * Opt-in formal register (stylePhrasing): a plain or colloquial verb that has a formal
 * equivalent in the same sense. Each swap names the complement that selects that sense:
 * "baixar o preço" -> "reduzir", but "baixar o arquivo" stays; "pegar uma gripe" ->
 * "contrair", "pegar os dados" -> "obter". The formal verb takes the tense and person of the
 * typed one. Also "uma boa questão" -> "uma questão pertinente". The frames are in
 * grammar/rules/pt_BR.yaml.
 */

type Swap = {
  verbs: string[];
  formal: string[];
  /** Statements only: "Você acha que…?" asks for the reader's view in any register. */
  statement?: true;
};

const ARTICLE: Record<string, string> = { o: " o", a: " a", os: " os", as: " as" };

/** A finding unless a typed word is a user word; a capital carries onto the fixes. */
function push(ctx: DetectContext, m: RegExpExecArray, alternatives: string[]): RawFinding | null {
  const [start, end] = m.indices!.groups!.target;
  const typed = m.groups!.target;
  if (typed.split(/[ \t\u00a0]+/).some((word) => ctx.dictionary.has(word.toLowerCase())))
    return null;
  if (/^\p{Lu}/u.test(typed))
    alternatives = alternatives.map((alt) => alt[0].toUpperCase() + alt.slice(1));
  return finding("stylePhrasing", "review_msg_style_phrasing", start, end, alternatives, {
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  });
}

/**
 * The fixer of one swap: the formal verb in the tense and person of the typed one. The frame
 * names the forms of the typed verbs (`head`), the words the formal verb also replaces and,
 * in a lookahead, the complement that selects the sense.
 */
function swap({ verbs, formal, statement }: Swap): MatchFixer {
  const slots = new Map<string, number>();
  for (const verb of verbs)
    conjugate(verb).forEach((form, slot) => slots.has(form) || slots.set(form, slot));
  return (m, ctx) => {
    const { head, of } = m.groups!;
    // A capital after the first word is a name.
    if (head !== head.toLowerCase() && !/^\p{Lu}\p{Ll}*$/u.test(head)) return null;
    const slot = slots.get(head.toLowerCase());
    if (slot === undefined) return null;
    if (statement && /^[^.!?\n]*\?/.test(ctx.text.slice(m.index, m.index + 200))) return null;
    const article = of ? (ARTICLE[of.toLowerCase().replace(/^(?:d|n|sobre\s+)/, "")] ?? "") : "";
    return push(
      ctx,
      m,
      formal.map((verb) => {
        const [first, ...rest] = verb.split(" ");
        return [conjugate(first)[slot], ...rest].join(" ") + article;
      }),
    );
  };
}

const GOOD: Record<string, string> = { bom: "", boa: "", bons: "s", boas: "s" };

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = {
  formalAchar: swap({
    verbs: ["achar"],
    formal: ["considerar", "julgar", "pensar"],
    statement: true,
  }),
  formalBaixar: swap({ verbs: ["baixar"], formal: ["reduzir"] }),
  formalPassar: swap({ verbs: ["passar"], formal: ["passar por", "enfrentar"] }),
  formalPegarDados: swap({ verbs: ["pegar"], formal: ["obter"] }),
  formalPegarDoenca: swap({ verbs: ["pegar"], formal: ["contrair"] }),
  formalPegarTransporte: swap({ verbs: ["pegar"], formal: ["tomar"] }),
  formalArrumar: swap({ verbs: ["arrumar"], formal: ["conseguir"] }),
  formalFazer: swap({ verbs: ["fazer"], formal: ["elaborar"] }),
  formalDeixar: swap({ verbs: ["deixar"], formal: ["permitir"] }),
  formalPedir: swap({ verbs: ["pedir"], formal: ["solicitar"] }),
  formalChatear: swap({ verbs: ["chatear"], formal: ["incomodar", "importunar"] }),
  formalAturar: swap({ verbs: ["aturar"], formal: ["suportar", "tolerar"] }),
  formalJogar: swap({ verbs: ["jogar"], formal: ["descartar"] }),
  formalFalar: swap({ verbs: ["falar"], formal: ["abordar"] }),
  formalMexer: swap({ verbs: ["mexer"], formal: ["alterar"] }),
  formalDo: (m, ctx) => push(ctx, m, ["do"]),
  formalSupoe: (m, ctx) => push(ctx, m, ["supõe-se"]),
  formalConforme: (m, ctx) => push(ctx, m, ["conforme"]),
  formalEmTorno: (m, ctx) => push(ctx, m, ["em torno"]),
  formalGoodBefore: (m, ctx) => {
    const plural = GOOD[m.groups!.good.toLowerCase()];
    return push(ctx, m, [
      `${m.groups!.noun} pertinente${plural}`,
      `${m.groups!.noun} relevante${plural}`,
    ]);
  },
  formalGoodAfter: (m, ctx) => {
    const plural = GOOD[m.groups!.target.toLowerCase()];
    return push(ctx, m, [`pertinente${plural}`, `relevante${plural}`]);
  },
} satisfies Record<string, MatchFixer>;
