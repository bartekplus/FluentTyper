import type { RawFinding } from "./reviewDetectors";
import { isMarksOnlyFix } from "./reviewFindings";
import { applyEdits, editTouches, lowerBound, mergeRanges, positionMapper } from "./textRanges";
import {
  REVIEW_CHUNK_CHARS,
  type ReviewDiagnostic,
  type ReviewEdit,
  type TextRange,
} from "./types";

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
 * marks doubt as "context-dependent" ("wont", "ill" read from the next words; every
 * French elision, which shares the message) or "ambiguous" (a word glued to a hyphen).
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
    return diagnostic.alternatives[0].preview.replace(APOSTROPHES, "") === diagnostic.original;
  });
}

export interface RepairShadow {
  repairs: readonly ReviewDiagnostic[];
  /** Every repair's edits, in positions of the original text. */
  edits: ReviewEdit[];
  /** Shadow position -> original position (exact outside the repaired words). */
  fromShadow: (position: number) => number;
  /** Each repaired word in the shadow text, in the order of `repairs` (sorted, disjoint). */
  spans: TextRange[];
  /** The characters the repairs inserted, in the shadow text (sorted, disjoint). */
  inserted: TextRange[];
}

/**
 * The indices of the sorted, disjoint `spans` that `range` overlaps or, when it
 * is an insertion, touches. A binary search: a text full of repairs stays linear.
 */
function spansAt(spans: readonly TextRange[], range: TextRange): number[] {
  const indices: number[] = [];
  for (
    let index = lowerBound(spans.length, (i) => spans[i].end < range.start);
    index < spans.length && spans[index].start <= range.end;
    index += 1
  )
    if (editTouches(range, spans[index])) indices.push(index);
  return indices;
}

/** The repairs applied: their edits and the position mappers both ways. */
export function repairShadow(repairs: readonly ReviewDiagnostic[]): RepairShadow {
  const edits = repairs.flatMap((repair) => repair.alternatives[0].edits);
  const toShadow = positionMapper(edits);
  const inverse = edits.map((edit) => {
    // An insertion stays after its position, so this is where its text starts.
    const start = toShadow(edit.start);
    return {
      start,
      end: start + edit.replacement.length,
      original: edit.replacement,
      replacement: edit.original,
    };
  });
  const fromShadow = positionMapper(inverse);
  return {
    repairs,
    edits,
    fromShadow,
    spans: repairs.map((repair) => ({
      start: toShadow(repair.range.start),
      end: toShadow(repair.range.end),
    })),
    inserted: inverse.map(({ start, end }) => ({ start, end })),
  };
}

/**
 * The shadow text to scan: REPAIR_WINDOW around each repaired word, clipped to the
 * scope, joined where windows overlap, and split into parts of at most
 * REVIEW_CHUNK_CHARS. A scan owns the findings that start in its range, so any
 * split point is correct.
 */
export function repairWindows(spans: readonly TextRange[], scope: TextRange): TextRange[] {
  const windows = spans
    .map((span) => ({
      start: Math.max(scope.start, span.start - REPAIR_WINDOW),
      end: Math.min(scope.end, span.end + REPAIR_WINDOW),
    }))
    .filter((window) => window.start < window.end);
  return mergeRanges(windows, true).flatMap((window) => {
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

/**
 * One fix of the original text. `repairs` are the repairs the fix includes (its
 * edit changes a repaired word: "cant" -> "can"); empty when the fix changes
 * other words only and stands next to the repairs.
 */
export interface Composite {
  finding: RawFinding;
  repairs: ReviewDiagnostic[];
}

const editsKey = (edits: readonly ReviewEdit[]) =>
  JSON.stringify(edits.map(({ start, end, replacement }) => [start, end, replacement]));

/**
 * The shadow findings that depend on a repair, as findings of the original text.
 * A finding depends on the repairs when its evidence reads a repaired word and the
 * original scan does not propose the same edits. When its edit changes a repaired
 * word, its fix includes that repair. Otherwise its fix changes only its own words,
 * and the repair keeps its own finding. A choice between fixes stays a choice.
 * Style advice, quote-style fixes, warnings and dictionary findings are never
 * taken from the shadow.
 */
export function composeRepairs(
  shadow: RepairShadow,
  original: readonly ReviewDiagnostic[],
  found: readonly ShadowFinding[],
  shadowText: string,
  sourceText: string,
): Composite[] {
  const known = new Set(original.flatMap((d) => d.alternatives.map((a) => editsKey(a.edits))));
  const composites: Composite[] = [];
  for (const { finding, diagnostic } of found) {
    if (
      diagnostic.warningOnly ||
      diagnostic.category === "style" ||
      // A quote-style fix of the apostrophe a repair inserts is not a second error.
      isMarksOnlyFix(diagnostic) ||
      diagnostic.alternatives.length === 0 ||
      finding.terminology ||
      finding.dictionaryWord ||
      spansAt(shadow.spans, diagnostic.context).length === 0
    )
      continue;
    // Away from the inserted apostrophes, positions map back exactly. Edits the
    // original scan already proposes there ("d" -> "D" at a sentence start) are
    // not new, even when they change a repaired word.
    const mapped = diagnostic.alternatives.map((a) =>
      a.edits.map((edit) => ({
        ...edit,
        start: shadow.fromShadow(edit.start),
        end: shadow.fromShadow(edit.end),
      })),
    );
    if (
      diagnostic.alternatives.some(
        (a, index) =>
          a.edits.every((edit) => spansAt(shadow.inserted, edit).length === 0) &&
          known.has(editsKey(mapped[index])),
      )
    )
      continue;
    const { range } = diagnostic;
    const base = {
      ruleId: finding.ruleId,
      messageKey: finding.messageKey,
      bulkBlock: "context-dependent" as const,
      ...(finding.requiresChoice ? { requiresChoice: true as const } : {}),
    };
    const touched = new Set(
      diagnostic.alternatives.flatMap((a) =>
        a.edits.flatMap((edit) => spansAt(shadow.spans, edit)),
      ),
    );
    if (touched.size === 0) {
      const start = shadow.fromShadow(range.start);
      const end = shadow.fromShadow(range.end);
      const typed = sourceText.slice(start, end);
      const alternatives = mapped.map((edits) =>
        applyEdits(
          typed,
          edits.map((edit) => ({ ...edit, start: edit.start - start, end: edit.end - start })),
        ),
      );
      if (alternatives.some((alternative) => alternative === null)) continue;
      composites.push({
        finding: {
          ...base,
          range: { start, end },
          alternatives: alternatives as string[],
          context: {
            start: shadow.fromShadow(diagnostic.context.start),
            end: shadow.fromShadow(diagnostic.context.end),
          },
        },
        repairs: [],
      });
      continue;
    }
    // The finding and the repaired words it changes, grown over any repair inside them.
    const union = { start: range.start, end: range.end };
    for (let size = -1; size !== touched.size;) {
      size = touched.size;
      for (const index of touched) {
        union.start = Math.min(union.start, shadow.spans[index].start);
        union.end = Math.max(union.end, shadow.spans[index].end);
      }
      for (const index of spansAt(shadow.spans, union)) touched.add(index);
    }
    const before = shadowText.slice(union.start, range.start);
    const after = shadowText.slice(range.end, union.end);
    composites.push({
      finding: {
        ...base,
        range: { start: shadow.fromShadow(union.start), end: shadow.fromShadow(union.end) },
        alternatives: diagnostic.alternatives.map(({ preview }) => before + preview + after),
        context: {
          start: shadow.fromShadow(Math.min(diagnostic.context.start, union.start)),
          end: shadow.fromShadow(Math.max(diagnostic.context.end, union.end)),
        },
      },
      repairs: [...touched].map((index) => shadow.repairs[index]),
    });
  }
  return composites;
}
