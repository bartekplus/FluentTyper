import type { DetectContext, RawFinding } from "./reviewDetectors";

const CANONICAL = new Map(
  ["GitHub", "JavaScript", "TypeScript", "WebRTC", "FluentTyper", "iPhone", "macOS", "eBay"].map(
    (term) => [term.toLowerCase(), term],
  ),
);

/** Explicit names only; uppercase emphasis and identifier-like mixed casing stay untouched. */
export function canonicalCasing(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const words = /(?<![.\p{L}\p{M}\p{N}_'’@/#=$\\-])[A-Za-z]+(?![\p{L}\p{M}\p{N}_'’@/#=$\\-])/gu;
  words.lastIndex = ctx.from;
  for (
    let match = words.exec(ctx.scanText);
    match && match.index < ctx.to;
    match = words.exec(ctx.scanText)
  ) {
    const typed = match[0];
    const canonical = CANONICAL.get(typed.toLowerCase());
    if (!canonical || canonical === typed || ctx.dictionary.has(typed.toLowerCase())) continue;
    if (!/^[A-Z]?[a-z]+$/.test(typed)) continue;
    const start = match.index;
    const end = start + typed.length;
    if (/^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(end, end + 2))) continue;
    if (/["“'‘]/.test(ctx.text[start - 1] ?? "") && /["”'’]/.test(ctx.text[end] ?? "")) continue;
    const before = ctx.text.slice(Math.max(0, start - 128), start);
    if (
      /\b(?:write|type|spell|spelled|spelling|name|phrase|word|example|literal|text|term|form|heading|title|label|identifier|property|variable|says?|reads?)(?:[ \t]+(?:name|is|was))?[ :\t]*["“'‘][^\r\n\uFFFC]{0,80}$/i.test(
        before,
      )
    )
      continue;
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
