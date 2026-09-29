import { detectPhraseTemplates, type PhraseTemplate } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
const COMPLETE = `(?!${EDGE})(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;
const TOPIC = `(?:the|this|that|our|your|their)${SPACE}(?:(?:new|old|current|latest|proposed)${SPACE})?(?:release|plan|report|problem|proposal|results|schedule|budget|design|issue|changes|project)`;
const SUBJECT = "(?:I|you|we|they|he|she|it)";
const templates: readonly PhraseTemplate[] = [
  {
    pattern: `despite${SPACE}(?<target>of${SPACE})(?:the|this|that)${SPACE}(?:(?:long|heavy|loud|bad|high|unexpected)${SPACE})?(?:delay|rain|noise|weather|problem|warning|risk|cost|pressure|heat|cold|traffic)${COMPLETE}`,
    replacement: "",
    messageKey: "review_msg_despite_of",
  },
  {
    pattern: `(?:${SUBJECT}${SPACE}(?:discuss|discussed|discusses|(?:am|is|are|was|were)${SPACE}discussing)|please${SPACE}discuss)${SPACE}(?<target>about${SPACE})${TOPIC}${COMPLETE}`,
    replacement: "",
    messageKey: "review_msg_discuss_about",
  },
  {
    pattern: `${SUBJECT}${SPACE}(?:am|is|are|was|were)${SPACE}interested${SPACE}(?<target>on)${SPACE}(?:learning${SPACE}(?:Rust|English|French|German|Spanish|Python|TypeScript)|writing${SPACE}code|reading${SPACE}books|playing${SPACE}chess|building${SPACE}apps|testing${SPACE}software|${TOPIC})${COMPLETE}`,
    replacement: "in",
    messageKey: "review_msg_interested_on",
  },
];

export function fixedPrepositions(ctx: DetectContext): RawFinding[] {
  return detectPhraseTemplates(ctx, templates, "englishFixedPrepositions");
}
