import { finding } from "../finding";
import type { MatchFixer } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import { germanVerbLike } from "./germanLexicon";
import { isAuxiliary } from "./verbAgreement";

// Commas around fixed words (run by germanCommas): a tag question ("Du kommst, nicht wahr?"),
// an inserted "glaube ich" ("Das ist, glaube ich, egal"), and paired words ("teils lustig,
// teils traurig", "halb …, halb …", "einerseits …, andererseits", "je …, desto", "So weit,
// so gut").

const COPULAS = /^(?:ist|sind|war|waren|wäre|wären|sei|scheint|klingt|wird|wurde|bin|bist|seid)$/;
const COORDINATORS = /^(?:und|oder|aber|sowie|bzw)$/;

const named = (m: RegExpExecArray) =>
  ["word", "w2", "w3", "w4", "w5"].find((k) => m.groups![k] !== undefined)!;

/** A comma after text[start, end). */
const comma = (ctx: DetectContext, start: number, end: number, alternative: string) =>
  finding("germanCommas", "review_msg_german_comma", start, end, [alternative], {
    context: { start: Math.max(0, start - 40), end: Math.min(ctx.text.length, end + 40) },
  });
/** The comma after the `word` group. */
const afterWord = (m: RegExpExecArray, ctx: DetectContext) => {
  const [start, end] = m.indices!.groups!.word;
  return comma(ctx, start, end, `${m.groups!.word},`);
};

/** The named frame fixes of the de.commaFrames rule (grammar/rules/de.yaml). */
export const FIXERS = {
  pairedWords: (m, ctx) => {
    const word = m.groups![named(m)];
    if (COORDINATORS.test(word)) return null;
    const [start, end] = m.indices!.groups![named(m)];
    return comma(ctx, start, end, `${word},`);
  },
  commaAfterWord: afterWord,
  tagQuestion: (m, ctx) => {
    const word = m.groups!.word;
    const [start] = m.indices!.groups!.word;
    // A question that opens with its verb ("Ist das nicht wahr?") or a copula before "nicht
    // wahr" ("Das ist nicht wahr?") is no tag.
    const clause = ctx.text
      .slice(Math.max(0, start - 200), start)
      .split(/[.!?;:\n]/)
      .at(-1)!;
    const first = /\p{L}+/u.exec(clause)?.[0] ?? word;
    if (COPULAS.test(word) || COORDINATORS.test(word) || /^(?:entweder|das|es)$/i.test(word))
      return null;
    const low = first.toLowerCase();
    const verbFirst = isAuxiliary(low) || /st$/.test(low) || germanVerbLike(low);
    if (!/[ \t]/.test(clause.trim()) || verbFirst || /(?<!\p{L})entweder(?!\p{L})/iu.test(clause))
      return null;
    return afterWord(m, ctx);
  },
  insertedOpinion: (m, ctx) => {
    const [at, end] = m.indices!.groups!.target;
    const start = at - /[ \t\u00a0]*$/.exec(ctx.text.slice(Math.max(0, at - 8), at))![0].length;
    return comma(ctx, start, end, `, ${m.groups!.target.replace(/[ \t\u00a0]+/g, " ")},`);
  },
} satisfies Record<string, MatchFixer>;
