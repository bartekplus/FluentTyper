import { frameRuleDetector, type MatchFixer } from "../engine/reviewRules";
import { group, hasUserOrCasedWord } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";
import { finding } from "./finding";

/** The named frame fixes of the doubledDegree rule (grammar/rules/common.yaml). */
export const FIXERS = {
  // Finite predicative clauses establish degree, rather than quantity or noun modifiers.
  doubledDegree: (m, ctx) => {
    if (ctx.lang !== "en_US") return null;
    const [start, end] = group(m, "target");
    const phraseEnd = m.index + m[0].length;
    if (hasUserOrCasedWord(ctx, m[0])) return null;
    if (m.groups!.target !== m.groups!.target.toLowerCase()) return null;
    return finding(
      "englishDoubledDegree",
      "review_msg_doubled_degree",
      start,
      end,
      [m.groups!.word],
      {
        context: {
          start: Math.max(0, m.index - 128),
          end: Math.min(ctx.text.length, phraseEnd + 9),
        },
      },
    );
  },
} satisfies Record<string, MatchFixer>;

// Built at the first call: the rule files import this module (an import cycle).
let rule: ((ctx: DetectContext) => RawFinding[]) | undefined;

/** The findings of the English doubledDegree frames ("this is more faster"). */
export const doubledDegree = (ctx: DetectContext): RawFinding[] =>
  (rule ??= frameRuleDetector("doubledDegree", { common: FIXERS }))(ctx);
