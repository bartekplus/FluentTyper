import { namedExampleBefore, quotedSpan } from "./exampleCues";
import { ownedMatches } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const CANONICAL = new Map(
  [
    ...["GitHub", "JavaScript", "TypeScript", "WebRTC", "FluentTyper", "iPhone", "macOS", "eBay"],
    ...["LinkedIn", "WordPress", "iPad", "iPod", "iMac", "iTunes"],
  ].map((term) => [term.toLowerCase(), term]),
);
// Acronyms written as a capitalized word ("Nasa", "Cpu"); lowercase "pdf" or "url" is often a
// file extension or a field name and stays.
const ACRONYMS = new Set(
  "NASA IKEA LEGO NATO FBI CIA HIV DNA RNA CPU GPU HTML URL FAQ PDF CEO CFO HR AI UFO".split(" "),
);

/** Explicit names only; uppercase emphasis and identifier-like mixed casing stay untouched. */
export function canonicalCasing(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const words = /(?<![.\p{L}\p{M}\p{N}_'’@/#=$\\-])[A-Za-z]+(?![\p{L}\p{M}\p{N}_'’@/#=$\\-])/gu;
  for (const match of ownedMatches(ctx, words)) {
    const typed = match[0];
    const acronym = typed.length < 5 ? typed.toUpperCase() : "";
    const canonical =
      CANONICAL.get(typed.toLowerCase()) ??
      (ACRONYMS.has(acronym) &&
      /^[A-Z][a-z]+$/.test(typed) &&
      // "Ai Weiwei" is a name.
      !/^[ \t\u00a0]+[A-Z]/.test(ctx.text.slice(match.index + typed.length))
        ? acronym
        : undefined);
    if (!canonical || canonical === typed || ctx.dictionary.has(typed.toLowerCase())) continue;
    if (!/^[A-Z]?[a-z]+$/.test(typed)) continue;
    const start = match.index;
    const end = start + typed.length;
    if (/^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(end, end + 2))) continue;
    if (quotedSpan(ctx.text, start, end) || namedExampleBefore(ctx.text, start)) continue;
    findings.push({
      ruleId: "englishCanonicalCasing",
      messageKey: "review_msg_canonical_casing",
      range: { start, end },
      alternatives: [canonical],
      context: { start: Math.max(0, start - 128), end: Math.min(ctx.text.length, end + 2) },
    });
  }
  return findings;
}
