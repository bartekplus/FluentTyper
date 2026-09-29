import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";
const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
const SUBJECT = "(?:I|you|we|they|he|she)";
const COMPLETE = `(?!${EDGE})(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;
const VERB_SLOT = `(?:please|${SUBJECT}${SPACE}(?:can|will|should|must|need${SPACE}to|want${SPACE}to|plan${SPACE}to))`;
const DAILY = [
  "(?:use|uses|used) this tool",
  "(?:check|checks|checked) the report",
  "(?:read|reads) the file",
  "(?:open|opens|opened) the app",
  "(?:visit|visits|visited) the office",
  "(?:review|reviews|reviewed) the plan",
  "(?:test|tests|tested) the device",
  "(?:work|works|worked) (?:here|remotely)",
  "(?:walk|walks|walked) home",
  "(?:run|runs|ran) the tests",
  "(?:write|writes|wrote) code",
  "(?:send|sends|sent) the report",
]
  .map((p) => p.replaceAll(" ", SPACE))
  .join("|");
const templates: ReadonlyArray<{
  pattern: string;
  replacement: string;
  messageKey: RawFinding["messageKey"];
}> = [
  {
    pattern: `${SUBJECT}${SPACE}(?:${DAILY})${SPACE}(?<target>everyday)${COMPLETE}`,
    replacement: "every day",
    messageKey: "review_msg_every_day",
  },
  {
    pattern: `${VERB_SLOT}${SPACE}(?<target>login)${SPACE}(?:to${SPACE}(?:continue|your${SPACE}account|the${SPACE}account|view${SPACE}the${SPACE}report|open${SPACE}the${SPACE}file|check${SPACE}your${SPACE}messages)|again|today|tomorrow|now|before${SPACE}continuing|(?:with|using)${SPACE}your${SPACE}password)${COMPLETE}`,
    replacement: "log in",
    messageKey: "review_msg_log_in",
  },
  {
    pattern: `${VERB_SLOT}${SPACE}(?<target>setup)${SPACE}(?:the|this|our|your)${SPACE}(?:environment|account|device|project|server|folder|test|screen|keyboard|connection|database|workspace)${COMPLETE}`,
    replacement: "set up",
    messageKey: "review_msg_set_up",
  },
];
/** Only curated grammatical slots; dictionary membership never determines compound boundaries. */
export function contextualCompounds(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { pattern, replacement, messageKey } of templates) {
    const regex = new RegExp(`(?<![.])(?<!${EDGE})${pattern}`, "gidu");
    regex.lastIndex = Math.max(0, ctx.from - 256);
    for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
      const [start, end] = m.indices!.groups!.target;
      if (start < ctx.from || start >= ctx.to) continue;
      if (m.groups!.target !== m.groups!.target.toLowerCase()) continue;
      const phraseEnd = m.index + m[0].length;
      if (/^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(phraseEnd, phraseEnd + 2))) continue;
      const before = ctx.scanText.slice(Math.max(0, m.index - 96), m.index);
      if (
        /\b(?:write|type|spell|phrase|words?|example|literal|text|says?|reads?)[ :\t]*["“'‘][^\r\n\uFFFC]{0,80}$/i.test(
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
      findings.push({
        ruleId: "englishContextualCompounds",
        messageKey,
        range: { start, end },
        alternatives: [applyWordCase(replacement, detectWordCase(m.groups!.target))],
        context: {
          start: Math.max(0, m.index - 96),
          end: Math.min(ctx.text.length, phraseEnd + 9),
        },
      });
    }
  }
  return findings;
}
