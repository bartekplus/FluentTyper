import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
const COMPLETE = `(?!${EDGE})(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;
const TOPIC = `(?:the|this|that|our|your|their)${SPACE}(?:(?:new|old|current|latest|proposed)${SPACE})?(?:release|plan|report|problem|proposal|results|schedule|budget|design|issue|changes|project)`;
const SUBJECT = "(?:I|you|we|they|he|she|it)";
const templates: ReadonlyArray<{
  pattern: string;
  replacement: string;
  messageKey: RawFinding["messageKey"];
}> = [
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

/** Audited phrase templates; no general replacement of a preposition or inference of attachment. */
export function fixedPrepositions(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { pattern, replacement, messageKey } of templates) {
    const regex = new RegExp(`(?<![.])(?<!${EDGE})${pattern}`, "gidu");
    regex.lastIndex = Math.max(0, ctx.from - 256);
    for (
      let match = regex.exec(ctx.scanText);
      match && match.index < ctx.to;
      match = regex.exec(ctx.scanText)
    ) {
      const [start, end] = match.indices!.groups!.target;
      if (start < ctx.from || start >= ctx.to) continue;
      const phraseEnd = match.index + match[0].length;
      if (/^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(phraseEnd, phraseEnd + 2))) continue;
      const before = ctx.scanText.slice(Math.max(0, match.index - 96), match.index);
      if (
        /\b(?:write|type|spell|phrase|words?|example|literal|text|says?|reads?)[ :\t]*["“'‘][^\r\n\uFFFC]{0,80}$/i.test(
          before,
        )
      )
        continue;
      if (
        (match[0].match(/[A-Za-z]+/g) ?? []).some(
          (word) =>
            ctx.dictionary.has(word.toLowerCase()) ||
            (word !== "TypeScript" && applyWordCase(word, detectWordCase(word)) !== word),
        )
      )
        continue;
      findings.push({
        ruleId: "englishFixedPrepositions",
        messageKey,
        range: { start, end },
        alternatives: [
          replacement ? applyWordCase(replacement, detectWordCase(match.groups!.target)) : "",
        ],
        context: {
          start: Math.max(0, match.index - 96),
          end: Math.min(ctx.text.length, match.index + match[0].length + 9),
        },
      });
    }
  }
  return findings;
}
