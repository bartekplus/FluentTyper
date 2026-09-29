import { detectPhraseTemplates, type PhraseTemplate } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
const END = `(?!${EDGE})(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;
const SUBJECT = `(?:(?:this|that|the)${SPACE}(?:(?:new|old|latest)${SPACE})?(?:feature|idea|story|proposal|question|book|article|design|project|topic)|it)`;
const templates: readonly PhraseTemplate[] = [
  {
    pattern: `for${SPACE}all${SPACE}(?<target>intensive)${SPACE}purposes,${SPACE}(?:the|this|that)${SPACE}(?:test|project|work|task|report|plan|design|review|process|document|proposal|update)${SPACE}(?:is|was)${SPACE}(?:complete|finished|ready|done|final|successful)${END}`,
    replacement: "intents and",
    messageKey: "review_msg_intents_purposes",
  },
  {
    pattern: `(?:they|we|these|those|(?:the|these|those)${SPACE}two${SPACE}(?:things|people|files|documents|reports|plans|ideas|options))${SPACE}(?:are|were)${SPACE}one${SPACE}(?<target>in)${SPACE}the${SPACE}same${END}`,
    replacement: "and",
    messageKey: "review_msg_one_same",
  },
  ...(
    [
      ["peaked", "piqued"],
      ["peaks", "piques"],
      ["peak", "pique"],
      ["peaking", "piquing"],
    ] as const
  ).map(([form, replacement]) => ({
    pattern: `${SUBJECT}${SPACE}${form === "peak" ? `(?:can|will|could|should|may|might)${SPACE}` : form === "peaking" ? `(?:is|was)${SPACE}` : ""}(?<target>${form})${SPACE}(?:my|your|his|her|our|their)${SPACE}interest${END}`,
    replacement,
    messageKey: "review_msg_pique_interest" as const,
  })),
];

/** Conventional meanings only; unknown metaphors and literal peak constructions abstain. */
export function usagePhrases(ctx: DetectContext): RawFinding[] {
  return detectPhraseTemplates(ctx, templates, "englishUsagePhrases").filter(
    (finding) =>
      !/\b(?:metaphor|poetic|creative|deliberate|deliberately|dialect|invented)\b/i.test(
        ctx.scanText.slice(finding.context!.start, finding.context!.end),
      ),
  );
}
