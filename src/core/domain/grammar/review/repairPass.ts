import type { RawFinding } from "./reviewDetectors";
import { positionMapper, rangesOverlap } from "./textRanges";
import { REVIEW_CHUNK_CHARS, type ReviewDiagnostic, type ReviewEdit, type TextRange } from "./types";

/*
 * The repair pass. A contraction typo hides every finding that needs the
 * contraction: "I cant hardly" shows only "can't", and "can't hardly" -> "can
 * hardly" shows only after that fix. Review applies the safe contraction fixes
 * to a shadow copy of the text, scans it again near them, and offers each
 * finding that depends on a repair as one fix of the original text
 * ("cant" -> "can"). reviewDiagnostics runs the scans; this module is pure.
 */

/** How far from a repaired word a finding that depends on it can start. */
export const REPAIR_WINDOW = 160;

const APOSTROPHES = /['’]/g;

/**
 * The contraction fixes the pass applies: exactly one alternative that only adds
 * apostrophes ("cant" -> "can't"), and that its detector does not doubt. A detector
 * marks doubt as "context-dependent" ("wont", "ill" read from the next words) or
 * "ambiguous" (a word glued to a hyphen).
 */
export function selectRepairs(diagnostics: readonly ReviewDiagnostic[]): ReviewDiagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (
      diagnostic.messageKey !== "review_msg_contraction" ||
      diagnostic.warningOnly ||
      diagnostic.alternatives.length !== 1
    )
      return false;
    if (
      !diagnostic.bulk.eligible &&
      (diagnostic.bulk.reason === "context-dependent" || diagnostic.bulk.reason === "ambiguous")
    )
      return false;
    const { preview } = diagnostic.alternatives[0];
    return (
      preview.length > diagnostic.original.length &&
      preview.replace(APOSTROPHES, "") === diagnostic.original
    );
  });
}

export interface RepairShadow {
  repairs: ReviewDiagnostic[];
  /** Every repair's edits, in positions of the original text. */
  edits: ReviewEdit[];
  /** Original position -> shadow position. */
  toShadow: (position: number) => number;
  /** Shadow position -> original position (exact outside the repaired words). */
  fromShadow: (position: number) => number;
  /** Each repaired word in the shadow text, in the order of `repairs`. */
  spans: TextRange[];
}

/** The repairs applied: their edits and the position mappers both ways. */
export function repairShadow(repairs: readonly ReviewDiagnostic[]): RepairShadow {
  const edits = repairs.flatMap((repair) => repair.alternatives[0].edits);
  const toShadow = positionMapper(edits);
  const fromShadow = positionMapper(
    edits.map((edit) => {
      // An insertion stays after its position, so this is where its text starts.
      const start = toShadow(edit.start);
      return {
        start,
        end: start + edit.replacement.length,
        original: edit.replacement,
        replacement: edit.original,
      };
    }),
  );
  return {
    repairs: [...repairs],
    edits,
    toShadow,
    fromShadow,
    spans: repairs.map((repair) => ({
      start: toShadow(repair.range.start),
      end: toShadow(repair.range.end),
    })),
  };
}

/**
 * The shadow text to scan: REPAIR_WINDOW around each repaired word, clipped to the
 * scope, joined where windows overlap, and split into parts of at most
 * REVIEW_CHUNK_CHARS. A scan owns the findings that start in its range, so any
 * split point is correct.
 */
export function repairWindows(spans: readonly TextRange[], scope: TextRange): TextRange[] {
  const sorted = spans
    .map((span) => ({
      start: Math.max(scope.start, span.start - REPAIR_WINDOW),
      end: Math.min(scope.end, span.end + REPAIR_WINDOW),
    }))
    .filter((window) => window.start < window.end)
    .sort((a, b) => a.start - b.start);
  const joined: TextRange[] = [];
  for (const window of sorted) {
    const last = joined.at(-1);
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end);
    else joined.push({ ...window });
  }
  return joined.flatMap((window) => {
    const parts: TextRange[] = [];
    for (let start = window.start; start < window.end; start += REVIEW_CHUNK_CHARS)
      parts.push({ start, end: Math.min(window.end, start + REVIEW_CHUNK_CHARS) });
    return parts;
  });
}

/** A finding of the shadow scan, and the same finding checked against the shadow text. */
export interface ShadowFinding {
  finding: RawFinding;
  diagnostic: ReviewDiagnostic;
}

/** One fix of the original text, and the ids of the repairs that fix includes. */
export interface Composite {
  finding: RawFinding;
  repairIds: string[];
}

/**
 * The shadow findings that depend on a repair, as findings of the original text.
 * A finding depends on a repair when its evidence reads the repaired word, and it
 * is not a finding the original scan already reports. Style advice, warnings and
 * dictionary findings never absorb a repair.
 */
export function composeRepairs(
  shadow: RepairShadow,
  original: readonly ReviewDiagnostic[],
  found: readonly ShadowFinding[],
  shadowText: string,
): Composite[] {
  const composites: Composite[] = [];
  for (const { finding, diagnostic } of found) {
    if (
      diagnostic.warningOnly ||
      diagnostic.category === "style" ||
      diagnostic.alternatives.length === 0 ||
      finding.terminology ||
      finding.dictionaryWord ||
      finding.requiresChoice
    )
      continue;
    const touched = new Set<number>();
    shadow.spans.forEach((span, index) => {
      if (rangesOverlap(span, diagnostic.context)) touched.add(index);
    });
    if (touched.size === 0) continue;
    const { range } = diagnostic;
    if (!shadow.spans.some((span) => rangesOverlap(span, range))) {
      const start = shadow.fromShadow(range.start);
      const end = shadow.fromShadow(range.end);
      // The original text has the same finding: it does not need the repair.
      if (
        original.some(
          (d) => d.ruleId === diagnostic.ruleId && d.range.start === start && d.range.end === end,
        )
      )
        continue;
    }
    // The finding and the repairs it reads, grown over any repair inside them.
    const union = { start: range.start, end: range.end };
    for (let size = -1; size !== touched.size; ) {
      size = touched.size;
      for (const index of touched) {
        union.start = Math.min(union.start, shadow.spans[index].start);
        union.end = Math.max(union.end, shadow.spans[index].end);
      }
      shadow.spans.forEach((span, index) => {
        if (rangesOverlap(span, union)) touched.add(index);
      });
    }
    const before = shadowText.slice(union.start, range.start);
    const after = shadowText.slice(range.end, union.end);
    composites.push({
      finding: {
        ruleId: finding.ruleId,
        messageKey: finding.messageKey,
        range: { start: shadow.fromShadow(union.start), end: shadow.fromShadow(union.end) },
        alternatives: diagnostic.alternatives.map(({ preview }) => before + preview + after),
        context: {
          start: shadow.fromShadow(Math.min(diagnostic.context.start, union.start)),
          end: shadow.fromShadow(Math.max(diagnostic.context.end, union.end)),
        },
        bulkBlock: "context-dependent",
      },
      repairIds: [...touched].map((index) => shadow.repairs[index].id),
    });
  }
  return composites;
}
