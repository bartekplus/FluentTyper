import type { PreparedReview } from "./reviewDiagnostics";
import type { RawFinding } from "./reviewDetectors";
import { reviewMetadataFor } from "./reviewCatalog";
import { isReadabilityLiteral } from "./readability";
import type { SpellingCandidate } from "./reviewSpelling";
import {
  editTouches,
  hashText,
  isGraphemeBoundary,
  minimalEdits,
  overlapsSortedRanges,
  rangesOverlap,
  withTextApostrophes,
} from "./textRanges";
import {
  REVIEW_SPELLING_CHECK,
  type BulkDecision,
  type ReviewCheckId,
  type ReviewDiagnostic,
} from "./types";

/*
 * Findings to diagnostics: the validation every finding passes, and review's
 * own dictionary findings. Kept apart from the detectors so the page side of a
 * review (spelling, Local AI) can build diagnostics without loading them.
 */

/** A finding from a detector, or from review's own dictionary check. */
type Finding =
  RawFinding | (Omit<RawFinding, "ruleId"> & { ruleId: ReviewCheckId; requiresChoice?: true });

/**
 * An unknown word as a finding: its suggestions (best first) are the
 * alternatives, none preselected, and it can be added to the dictionary.
 */
export function spellingDiagnostic(
  prepared: PreparedReview,
  candidate: SpellingCandidate,
  suggestions: readonly string[],
): ReviewDiagnostic | null {
  if (suggestions.length === 0) return null;
  return toDiagnostic(prepared, {
    ruleId: REVIEW_SPELLING_CHECK,
    messageKey: "review_msg_unknown_word",
    range: candidate.range,
    alternatives: [...suggestions],
    dictionaryWord: candidate.word,
    requiresChoice: true,
  });
}

// Apostrophes and quotation marks: a fix that changes only these does not change a word.
const MARKS_ONLY = /^['"‘’‚‛“”„‟«»‹›]*$/u;

/**
 * A typography finding that changes only apostrophes or quotation marks
 * (typographicQuotes: "it's" -> "it’s"). It does not change the word around
 * the mark, so the word is still checked for spelling.
 */
export function isMarksOnlyFix(diagnostic: ReviewDiagnostic): boolean {
  return (
    diagnostic.category === "typography" &&
    !diagnostic.warningOnly &&
    diagnostic.alternatives.length > 0 &&
    diagnostic.alternatives.every((alternative) =>
      alternative.edits.every(
        (edit) => MARKS_ONLY.test(edit.original) && MARKS_ONLY.test(edit.replacement),
      ),
    )
  );
}

/**
 * True when `diagnostic` changes the words in its range: every finding except
 * style advice and a marks-only typography fix. The spelling pass does not
 * check a word inside such a finding, and a Local AI fix that disagrees with
 * it is left out.
 */
export function changesWords(diagnostic: ReviewDiagnostic): boolean {
  return diagnostic.category !== "style" && !isMarksOnlyFix(diagnostic);
}

/**
 * The shown findings without a marks-only typography fix inside a word that
 * has a spelling finding ("odn't": the spelling fix "don't", not also the
 * apostrophe fix). Each spelling suggestion already uses the text's
 * apostrophe style, so the word gets one fix and never two edits that
 * conflict. The apostrophe fix shows again when the spelling finding is
 * ignored or hidden, and after the spelling fix, on the next check.
 */
export function withoutMarksInsideSpelling(diagnostics: ReviewDiagnostic[]): ReviewDiagnostic[] {
  const words = diagnostics.filter((d) => d.ruleId === REVIEW_SPELLING_CHECK);
  if (words.length === 0) return diagnostics;
  const kept = diagnostics.filter(
    (d) => !isMarksOnlyFix(d) || !words.some((word) => rangesOverlap(word.range, d.range)),
  );
  return kept.length === diagnostics.length ? diagnostics : kept;
}

/** A known word typed with two initial capitals ("LEt's"): one fix, first capital only. */
export function casingDiagnostic(
  prepared: PreparedReview,
  candidate: SpellingCandidate,
): ReviewDiagnostic | null {
  if (!candidate.casing) return null;
  return toDiagnostic(prepared, {
    ruleId: REVIEW_SPELLING_CHECK,
    messageKey: "review_msg_two_initial_capitals",
    range: candidate.range,
    alternatives: [candidate.casing],
    dictionaryWord: candidate.word,
  });
}

export function toDiagnostic(prepared: PreparedReview, finding: Finding): ReviewDiagnostic | null {
  const { snapshot, options } = prepared;
  const source = snapshot.text;
  const { scope } = snapshot;
  const range = finding.range;
  if (
    range.start < scope.start ||
    range.end > scope.end ||
    range.end <= range.start ||
    !isGraphemeBoundary(source, range.start) ||
    !isGraphemeBoundary(source, range.end)
  ) {
    return null;
  }
  if (
    finding.ruleId !== "preferredTerminology" &&
    !(finding.ruleId === "styleLongSentence" && finding.warningOnly) &&
    overlapsSortedRanges(prepared.terminology.ranges, range)
  )
    return null;
  // A quoted example is cited on purpose: only the opt-in possible-mistakes check
  // and an unknown word (a choice, never applied in bulk) are shown in it.
  if (
    finding.ruleId !== "englishPossibleErrors" &&
    !(finding.ruleId === REVIEW_SPELLING_CHECK && finding.requiresChoice) &&
    overlapsSortedRanges(prepared.quotations.examples, range)
  )
    return null;
  // The underline itself may not cross code or a structural boundary.
  if (
    prepared.protectedRanges.some(
      (protectedRange) =>
        !(
          finding.ruleId === "styleLongSentence" &&
          finding.warningOnly &&
          protectedRange.reason === "technical" &&
          isReadabilityLiteral(source.slice(protectedRange.start, protectedRange.end))
        ) &&
        (finding.warningOnly ||
          finding.ruleId === "englishCanonicalCasing" ||
          finding.ruleId === "preferredTerminology" ||
          protectedRange.reason !== "technical") &&
        rangesOverlap(range, protectedRange),
    )
  ) {
    return null;
  }

  if (
    finding.warningOnly &&
    (finding.alternatives.length !== 0 || finding.requiresChoice || finding.dictionaryWord)
  )
    return null;
  const alternatives = [];
  for (const alternative of finding.alternatives) {
    // A new apostrophe follows the text's own style: "It’s … don’t", not "don't".
    const replacement = withTextApostrophes(source, range.start, alternative);
    const edits = minimalEdits(source, range.start, range.end, replacement);
    if (edits.length === 0) continue;
    const valid = edits.every(
      (edit) =>
        edit.start >= scope.start &&
        edit.end <= scope.end &&
        edit.end > edit.start &&
        source.slice(edit.start, edit.end) === edit.original &&
        isGraphemeBoundary(source, edit.start) &&
        isGraphemeBoundary(source, edit.end) &&
        !prepared.protectedRanges.some((protectedRange) => editTouches(edit, protectedRange)),
    );
    if (!valid) return null;
    alternatives.push({ edits, preview: replacement });
  }
  if (alternatives.length === 0 && !finding.warningOnly) return null;

  const metadata = reviewMetadataFor(finding.ruleId);
  if (metadata.review !== "supported") return null;
  let bulk: BulkDecision;
  if (finding.warningOnly) bulk = { eligible: false, reason: "warning-only" };
  else if (metadata.bulk !== "eligible")
    bulk = { eligible: false, reason: "rule-not-batch-approved" };
  else if (alternatives.length !== 1) bulk = { eligible: false, reason: "ambiguous" };
  else if (finding.bulkBlock) bulk = { eligible: false, reason: finding.bulkBlock };
  else bulk = { eligible: true, alternative: 0 };

  const context = finding.context ?? range;
  const signature = finding.warningOnly
    ? "warning-only"
    : alternatives.map((alternative) => alternative.preview).join("\u0000");
  return {
    id: `${snapshot.id}/${finding.ruleId}${finding.terminology ? ":" + finding.terminology.id : ""}@${range.start}-${range.end}#${hashText(signature)}`,
    ...(finding.terminology ? { terminology: finding.terminology } : {}),
    snapshotId: snapshot.id,
    ruleId: finding.ruleId,
    category: metadata.category,
    messageKey: finding.messageKey,
    lang: options.lang,
    range: { start: range.start, end: range.end },
    original: source.slice(range.start, range.end),
    alternatives,
    ...(finding.warningOnly ? { warningOnly: true as const } : {}),
    bulk,
    context: {
      start: Math.max(0, Math.min(context.start, range.start)),
      end: Math.min(source.length, Math.max(context.end, range.end)),
    },
    ...(finding.dictionaryWord && /^\p{L}+$/u.test(finding.dictionaryWord)
      ? { dictionaryWord: finding.dictionaryWord }
      : {}),
    ...("requiresChoice" in finding && finding.requiresChoice ? { requiresChoice: true } : {}),
  };
}
