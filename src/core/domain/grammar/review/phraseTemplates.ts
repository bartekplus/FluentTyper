import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
export type PhraseTemplate = {
  pattern: string;
  replacement: string;
  messageKey: RawFinding["messageKey"];
};

/** Shared bounded phrase matching; templates provide explicit grammatical context. */
export function detectPhraseTemplates(
  ctx: DetectContext,
  templates: readonly PhraseTemplate[],
  ruleId: RawFinding["ruleId"],
): RawFinding[] {
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
        /\b(?:write|type|spell|phrase|words?|example|literal|text|term|form|heading|title|label|says?|reads?)(?:[ \t]+(?:is|was))?[ :\t]*["“'‘][^\r\n\uFFFC]{0,80}$/i.test(
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
        ruleId,
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
