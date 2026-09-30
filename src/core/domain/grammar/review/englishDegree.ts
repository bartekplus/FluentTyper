import { ENGLISH_COMPARATIVES } from "../implementations/helpers/EnglishDegreeForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
const END = `(?!${EDGE})(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;
const NOUN =
  "(?:algorithm|approach|result|option|route|method|plan|model|version|device|answer|solution|test)";
const SUBJECT = `(?:this|that|it|(?:this|that|the)${SPACE}(?:(?:new|old|revised|previous)${SPACE})?${NOUN})${SPACE}(?:is|was)(?:${SPACE}also)?`;
const COMPARATIVE = `(?:${ENGLISH_COMPARATIVES.join("|")}|easier|simpler)`;
const SUPERLATIVE =
  "(?:fastest|slowest|largest|smallest|best|worst|newest|oldest|cheapest|safest|easiest)";
const patterns = [
  `${SUBJECT}${SPACE}(?:much${SPACE})?(?<target>more${SPACE}(?<word>${COMPARATIVE}))(?:(?:${SPACE}to${SPACE}(?:test|use|read|find|check|build))|(?:${SPACE}(?:than|then)${SPACE}(?:before|expected|(?:the|my|your|our)${SPACE}(?:(?:old|new|previous)${SPACE})?(?:${NOUN}|one)|[0-9]{1,6}(?!,|[.][0-9]))))?${END}`,
  `${SUBJECT}${SPACE}the${SPACE}(?<target>most${SPACE}(?<word>${SUPERLATIVE}))${SPACE}${NOUN}(?:${SPACE}we${SPACE}(?:tried|tested)${SPACE}so${SPACE}far)?${END}`,
];

/** Finite predicative clauses establish degree, rather than quantity or noun modifiers. */
export function doubledDegree(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const pattern of patterns) {
    const regex = new RegExp(`(?<![.])(?<!${EDGE})${pattern}`, "gidu");
    regex.lastIndex = Math.max(0, ctx.from - 256);
    for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
      const [start, end] = m.indices!.groups!.target;
      if (start < ctx.from || start >= ctx.to) continue;
      const phraseEnd = m.index + m[0].length;
      if (/^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(phraseEnd, phraseEnd + 2))) continue;
      const before = ctx.scanText.slice(Math.max(0, m.index - 128), m.index);
      if (
        /\b(?:write|type|spell|phrase|words?|example|literal|text|term|form|heading|title|label|says?|reads?)(?:[ \t]+(?:is|was))?[ :\t]*["“'‘][^\r\n\uFFFC]{0,80}$/i.test(
          before,
        )
      )
        continue;
      if (
        (m[0].match(/[A-Za-z]+/g) ?? []).some(
          (w) => ctx.dictionary.has(w.toLowerCase()) || applyWordCase(w, detectWordCase(w)) !== w,
        )
      )
        continue;
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
