import { ENGLISH_COMPARATIVES } from "../implementations/helpers/EnglishDegreeForms";
import { COMPLETE, frameMatches, hasUserOrCasedWord, SPACE } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const NOUN =
  "(?:algorithm|approach|result|option|route|method|plan|model|version|device|answer|solution|test)";
const SUBJECT = `(?:this|that|it|(?:this|that|the)${SPACE}(?:(?:new|old|revised|previous)${SPACE})?${NOUN})${SPACE}(?:is|was)(?:${SPACE}also)?`;
const COMPARATIVE = `(?:${ENGLISH_COMPARATIVES.join("|")}|easier|simpler)`;
const SUPERLATIVE =
  "(?:fastest|slowest|largest|smallest|best|worst|newest|oldest|cheapest|safest|easiest)";
const patterns = [
  `${SUBJECT}${SPACE}(?:much${SPACE})?(?<target>more${SPACE}(?<word>${COMPARATIVE}))(?:(?:${SPACE}to${SPACE}(?:test|use|read|find|check|build))|(?:${SPACE}(?:than|then)${SPACE}(?:before|expected|(?:the|my|your|our)${SPACE}(?:(?:old|new|previous)${SPACE})?(?:${NOUN}|one)|[0-9]{1,6}(?!,|[.][0-9]))))?${COMPLETE}`,
  `${SUBJECT}${SPACE}the${SPACE}(?<target>most${SPACE}(?<word>${SUPERLATIVE}))${SPACE}${NOUN}(?:${SPACE}we${SPACE}(?:tried|tested)${SPACE}so${SPACE}far)?${COMPLETE}`,
];

/** Finite predicative clauses establish degree, rather than quantity or noun modifiers. */
export function doubledDegree(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const pattern of patterns) {
    for (const m of frameMatches(ctx, pattern)) {
      const [start, end] = m.indices!.groups!.target;
      const phraseEnd = m.index + m[0].length;
      if (hasUserOrCasedWord(ctx, m[0])) continue;
      if (m.groups!.target !== m.groups!.target.toLowerCase()) continue;
      findings.push({
        ruleId: "englishDoubledDegree",
        messageKey: "review_msg_doubled_degree",
        range: { start, end },
        alternatives: [m.groups!.word],
        context: {
          start: Math.max(0, m.index - 128),
          end: Math.min(ctx.text.length, phraseEnd + 9),
        },
      });
    }
  }
  return findings;
}
