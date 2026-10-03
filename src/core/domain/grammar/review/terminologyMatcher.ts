import { validateTerminology } from "./preferredTerminology";
import type { RawFinding } from "./reviewDetectors";
import type { ProtectedRange, ReviewOptions, ReviewSourceSnapshot, TextRange } from "./types";
import { isGraphemeBoundary, mergeRanges, rangesOverlap } from "./textRanges";

const EDGE = /[\p{L}\p{M}\p{N}_'’@#$%&/\\=+*<>~^`|-]/u;

/** Literal matching only; case-insensitive matching retains original UTF-16 offsets. */
function* matches(text: string, phrase: string, insensitive: boolean, scope: TextRange) {
  const pattern = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(pattern, insensitive ? "giu" : "gu");
  const scoped = text.slice(scope.start, scope.end);
  for (let match = regex.exec(scoped); match; match = regex.exec(scoped)) {
    const start = scope.start + match.index;
    const end = start + match[0].length;
    if (end > scope.end || EDGE.test(text[start - 1] ?? "") || EDGE.test(text[end] ?? "")) continue;
    if (
      (text[start - 1] === "." && /[\p{L}\p{N}]/u.test(text[start - 2] ?? "")) ||
      (text[end] === "." && /[\p{L}\p{N}]/u.test(text[end + 1] ?? ""))
    )
      continue;
    if (!isGraphemeBoundary(text, start) || !isGraphemeBoundary(text, end)) continue;
    yield { start, end };
  }
}

/** One bounded prepared-snapshot pass. Preferred spans also prevent native recorrection loops. */
export function matchTerminology(
  snapshot: ReviewSourceSnapshot,
  options: ReviewOptions,
  protectedRanges: readonly ProtectedRange[],
  dictionary: ReadonlySet<string>,
): { findings: RawFinding[]; ranges: TextRange[]; limitedChars?: number } {
  const empty = { findings: [], ranges: [] };
  const result = validateTerminology(options.preferredTerminology);
  if (!result.ok || !result.value.enabled) return empty;
  const { text } = snapshot;
  const scope = {
    start: snapshot.scope.start,
    end: Math.min(snapshot.scope.end, snapshot.scope.start + 50_000),
  };
  const candidates: RawFinding[] = [];
  const ranges = new Map<string, TextRange>();
  for (const entry of result.value.entries) {
    if (
      !entry.enabled ||
      entry.language !== options.lang ||
      (entry.scope === "selection" && !snapshot.selection)
    )
      continue;
    const protectedMatch = (range: TextRange) =>
      protectedRanges.some((p) => rangesOverlap(p, range));
    // Exact preferred wording owns its spelling/casing without teaching the user dictionary.
    for (const range of matches(text, entry.replacement, false, scope)) {
      if (!protectedMatch(range)) ranges.set(`${range.start}:${range.end}`, range);
    }
    for (const range of matches(text, entry.source, entry.casePolicy === "insensitive", scope)) {
      const original = text.slice(range.start, range.end);
      // An insensitive match typed capitalized ("Whitelist it.", a sentence start)
      // keeps its leading capital; exact policies insert the authored form.
      const replacement =
        entry.casePolicy === "insensitive" &&
        /^\p{Lu}(?:\P{Lu}|$)/u.test(original) &&
        /^\p{Ll}/u.test(entry.replacement)
          ? entry.replacement[0].toUpperCase() + entry.replacement.slice(1)
          : entry.replacement;
      if (
        original === replacement ||
        protectedMatch(range) ||
        dictionary.has(original.toLowerCase()) ||
        (original.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).some((word) =>
          dictionary.has(word.toLowerCase()),
        )
      )
        continue;
      ranges.set(`${range.start}:${range.end}`, range);
      candidates.push({
        ruleId: "preferredTerminology",
        messageKey: "review_msg_preferred_terminology",
        range,
        alternatives: [replacement],
        terminology: { id: entry.id, explanation: entry.explanation },
        context: { start: Math.max(0, range.start - 2), end: Math.min(text.length, range.end + 2) },
      });
    }
  }
  // Longest complete phrase wins; equal lengths use position then stable authored ID.
  candidates.sort(
    (a, b) =>
      b.range.end - b.range.start - (a.range.end - a.range.start) ||
      a.range.start - b.range.start ||
      a.terminology!.id.localeCompare(b.terminology!.id),
  );
  const findings: RawFinding[] = [];
  const occupied = new Uint8Array(Math.max(0, scope.end - scope.start));
  for (const candidate of candidates) {
    const start = candidate.range.start - scope.start;
    const end = candidate.range.end - scope.start;
    if (occupied.subarray(start, end).some((value) => value !== 0)) continue;
    occupied.fill(1, start, end);
    findings.push(candidate);
  }
  return {
    findings: findings.sort((a, b) => a.range.start - b.range.start),
    ranges: mergeRanges([...ranges.values()], true),
    limitedChars: Math.max(0, snapshot.scope.end - scope.end),
  };
}
