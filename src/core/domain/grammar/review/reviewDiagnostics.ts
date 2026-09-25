import { GRAMMAR_RULE_CATALOG, type CatalogRuleId } from "../ruleCatalog";
import { findMarkdownCodeRanges } from "../implementations/helpers/ProtectedSpanShared";
import { isTechnicalToken, normalizeWordSet } from "../implementations/helpers/GenericRuleShared";
import { REVIEW_RULE_METADATA, isReviewSupportedRule } from "./reviewCatalog";
import { MASK_CHAR, REVIEW_DETECTORS, minimalEdits, type RawFinding } from "./reviewDetectors";
import { applyEdits, editTouches, isGraphemeBoundary, rangesOverlap } from "./textRanges";
import type {
  BulkDecision,
  CoverageGap,
  ProtectedRange,
  ReviewDiagnostic,
  ReviewEdit,
  ReviewOptions,
  ReviewScanResult,
  ReviewSourceSnapshot,
  TextRange,
} from "./types";

/** Largest scope reviewed at once (UTF-16 code units). Larger scopes are cut and reported. */
export const MAX_REVIEW_CHARS = 50_000;
/** Scan unit between yields; chunks end on line breaks so no token straddles two. */
export const REVIEW_CHUNK_CHARS = 4_000;
// Above this many proofs in one chunk, scanning the chunk once is cheaper.
const PROOF_WINDOWS_PER_CHUNK = 8;
// How far past its chunk a detector's forward scan may need to read.
const SCAN_LOOKAHEAD = 1_024;
// Context read around the scope; enough for every rule's look-behind.
const CONTEXT_MARGIN = 512;

const LANGUAGE_SCOPE = new Map(
  GRAMMAR_RULE_CATALOG.map((entry) => [entry.id, entry.languageScope]),
);

export interface PreparedReview {
  snapshot: ReviewSourceSnapshot;
  options: ReviewOptions;
  /** Source with protected (non-prose) characters masked; same length. */
  text: string;
  protectedRanges: ProtectedRange[];
  rules: ReadonlySet<CatalogRuleId>;
  /** Enabled review rules not run because they do not cover this language. */
  languageSkipped: CatalogRuleId[];
  dictionary: ReadonlySet<string>;
}

/** Resolves rules, protection and the masked analysis text. Pure; no DOM. */
export function prepareReview(
  snapshot: ReviewSourceSnapshot,
  options: ReviewOptions,
): PreparedReview {
  const source = snapshot.text;
  const rules = new Set<CatalogRuleId>();
  const languageSkipped: CatalogRuleId[] = [];
  for (const ruleId of options.enabledRules) {
    if (!isReviewSupportedRule(ruleId)) continue;
    if (LANGUAGE_SCOPE.get(ruleId) === "en_US" && options.lang !== "en_US") {
      languageSkipped.push(ruleId);
      continue;
    }
    rules.add(ruleId);
  }

  const readStart = Math.max(0, snapshot.scope.start - CONTEXT_MARGIN);
  const readEnd = Math.min(source.length, snapshot.scope.end + CONTEXT_MARGIN);
  const protectedRanges: ProtectedRange[] = [
    ...snapshot.protectedRanges,
    // Markdown needs the whole text: a fence opened far above still applies.
    ...findMarkdownCodeRanges(source).map(([start, end]) => ({
      start,
      end,
      reason: "code" as const,
    })),
    ...technicalRanges(source, readStart, readEnd),
  ].sort((a, b) => a.start - b.start);

  let text = source;
  // Technical tokens stay visible ("e.g." must still read as an abbreviation);
  // overlong ones carry no prose and are masked so no detector walks them.
  const masked = protectedRanges.filter(
    (range) => range.reason !== "technical" || range.end - range.start > MAX_PROSE_TOKEN_CHARS,
  );
  if (masked.length > 0) {
    const parts: string[] = [];
    let cursor = 0;
    for (const range of masked) {
      const start = Math.max(cursor, range.start);
      if (range.end <= start) continue;
      parts.push(source.slice(cursor, start));
      // Line breaks survive masking so line and paragraph logic still works.
      parts.push(source.slice(start, range.end).replace(/[^\n]/g, MASK_CHAR));
      cursor = range.end;
    }
    parts.push(source.slice(cursor));
    text = parts.join("");
  }

  return {
    snapshot,
    options,
    text,
    protectedRanges,
    rules,
    languageSkipped,
    dictionary: normalizeWordSet(options.userDictionary),
  };
}

/**
 * No prose word is this long; longer tokens (hashes, base64, minified code) are
 * protected outright, which also keeps per-token pattern checks linear.
 */
export const MAX_PROSE_TOKEN_CHARS = 100;

/** URLs, e-mail addresses, paths, mentions, dotted names and overlong tokens in [from, to). */
function technicalRanges(source: string, from: number, to: number): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  const token = /\S+/g;
  token.lastIndex = from;
  // Back up to the start of a token cut by `from`.
  while (token.lastIndex > 0 && /\S/.test(source[token.lastIndex - 1])) token.lastIndex -= 1;
  for (let match = token.exec(source); match && match.index < to; match = token.exec(source)) {
    if (match[0].length > MAX_PROSE_TOKEN_CHARS) {
      ranges.push({ start: match.index, end: match.index + match[0].length, reason: "technical" });
      continue;
    }
    const lead = match[0].match(/^["'(“‘[<]*/)![0].length;
    const bare = match[0].slice(lead).replace(/[.,;:!?)\]"'”’>]+$/u, "");
    if (bare && isTechnicalToken(bare)) {
      const start = match.index + lead;
      ranges.push({ start, end: start + bare.length, reason: "technical" });
    }
  }
  return ranges;
}

/** Scope split into line-aligned chunks of about REVIEW_CHUNK_CHARS. */
export function reviewChunks(prepared: PreparedReview): TextRange[] {
  const { start, end } = prepared.snapshot.scope;
  const chunks: TextRange[] = [];
  let cursor = start;
  while (cursor < end) {
    let chunkEnd = Math.min(end, cursor + REVIEW_CHUNK_CHARS);
    if (chunkEnd < end) {
      // Prefer a line end; a long line (one-line fields) splits at a space so
      // the scan still yields. Ownership makes any split point correct.
      const limit = Math.min(end, chunkEnd + REVIEW_CHUNK_CHARS);
      const newline = prepared.text.indexOf("\n", chunkEnd);
      if (newline >= 0 && newline < limit) {
        chunkEnd = newline + 1;
      } else {
        const space = prepared.text.slice(chunkEnd, limit).search(/\s/);
        chunkEnd = space < 0 ? limit : chunkEnd + space + 1;
      }
    }
    chunks.push({ start: cursor, end: chunkEnd });
    cursor = chunkEnd;
  }
  return chunks;
}

export interface ChunkScan {
  findings: RawFinding[];
  failedRules: CatalogRuleId[];
}

/** Runs every enabled detector over one chunk. A throwing detector is reported, not fatal. */
export function scanReviewChunk(prepared: PreparedReview, chunk: TextRange): ChunkScan {
  const findings: RawFinding[] = [];
  const failedRules: CatalogRuleId[] = [];
  const scanEnd = chunk.end + SCAN_LOOKAHEAD;
  const context = {
    source: prepared.snapshot.text,
    text: prepared.text,
    // Masked at the cut: nothing matches across it or mistakes it for the end.
    scanText:
      scanEnd < prepared.text.length
        ? `${prepared.text.slice(0, scanEnd)}${MASK_CHAR}`
        : prepared.text,
    from: chunk.start,
    to: chunk.end,
    lang: prepared.options.lang,
    dictionary: prepared.dictionary,
    insertSpaceAfterAutocomplete: prepared.options.insertSpaceAfterAutocomplete,
  };
  for (const detector of REVIEW_DETECTORS) {
    const active = detector.rules.filter((ruleId) => prepared.rules.has(ruleId));
    if (active.length === 0) continue;
    try {
      for (const finding of detector.detect(context)) {
        if (prepared.rules.has(finding.ruleId)) findings.push(finding);
      }
    } catch {
      failedRules.push(...active);
    }
  }
  return { findings, failedRules };
}

/**
 * Validates raw findings against the snapshot and turns them into diagnostics.
 * Anything outside the scope, touching protected text, splitting a grapheme or
 * not matching the snapshot is dropped here, whatever the detector said.
 */
export function finalizeReview(
  prepared: PreparedReview,
  scans: readonly ChunkScan[],
  extraGaps: Partial<Record<CoverageGap, number>> = {},
): ReviewScanResult {
  const seen = new Set<string>();
  const diagnostics: ReviewDiagnostic[] = [];
  const failed = new Set<CatalogRuleId>();

  for (const scan of scans) {
    scan.failedRules.forEach((ruleId) => failed.add(ruleId));
    for (const finding of scan.findings) {
      const diagnostic = toDiagnostic(prepared, finding);
      if (!diagnostic || seen.has(diagnostic.id)) continue;
      seen.add(diagnostic.id);
      diagnostics.push(diagnostic);
    }
  }
  diagnostics.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  const unique = dropDuplicateFixes(diagnostics);

  const skipped: Partial<Record<CoverageGap, number>> = { ...extraGaps };
  for (const [reason, count] of Object.entries(protectedCharsInScope(prepared))) {
    if (count > 0) skipped[reason as CoverageGap] = (skipped[reason as CoverageGap] ?? 0) + count;
  }
  if (failed.size > 0) skipped["rule-error"] = failed.size;

  return {
    diagnostics: unique,
    coverage: {
      checkedRules: [...prepared.rules].filter((ruleId) => !failed.has(ruleId)),
      failedRules: [...failed],
      skipped,
    },
  };
}

const PRIORITY = new Map(GRAMMAR_RULE_CATALOG.map((entry) => [entry.id, entry.priority]));

/**
 * Two rules proposing exactly the same change ("i" at a sentence start is both
 * a sentence start and the pronoun) are one issue for the user. The more
 * specific rule (later in the catalog) explains it.
 */
function dropDuplicateFixes(diagnostics: ReviewDiagnostic[]): ReviewDiagnostic[] {
  const byFix = new Map<string, ReviewDiagnostic>();
  const keyOf = (diagnostic: ReviewDiagnostic) =>
    JSON.stringify(diagnostic.alternatives.map((alternative) => alternative.edits));
  for (const diagnostic of diagnostics) {
    const key = keyOf(diagnostic);
    const existing = byFix.get(key);
    if (
      !existing ||
      (PRIORITY.get(diagnostic.ruleId) ?? 0) > (PRIORITY.get(existing.ruleId) ?? 0)
    ) {
      byFix.set(key, diagnostic);
    }
  }
  const kept = new Set(byFix.values());
  return diagnostics.filter((diagnostic) => kept.has(diagnostic));
}

function protectedCharsInScope(prepared: PreparedReview): Record<string, number> {
  const { scope } = prepared.snapshot;
  const counts: Record<string, number> = {};
  let covered = scope.start;
  for (const range of prepared.protectedRanges) {
    if (range.reason === "technical") continue;
    const start = Math.max(range.start, scope.start, covered);
    const end = Math.min(range.end, scope.end);
    if (end <= start) continue;
    counts[range.reason] = (counts[range.reason] ?? 0) + (end - start);
    covered = end;
  }
  return counts;
}

function toDiagnostic(prepared: PreparedReview, finding: RawFinding): ReviewDiagnostic | null {
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
  // The underline itself may not cross code or a structural boundary.
  if (
    prepared.protectedRanges.some(
      (protectedRange) =>
        protectedRange.reason !== "technical" && rangesOverlap(range, protectedRange),
    )
  ) {
    return null;
  }

  const alternatives = [];
  for (const replacement of finding.alternatives) {
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
  if (alternatives.length === 0) return null;

  const metadata = REVIEW_RULE_METADATA[finding.ruleId];
  if (metadata.review !== "supported") return null;
  let bulk: BulkDecision;
  if (metadata.bulk !== "eligible") bulk = { eligible: false, reason: "rule-not-batch-approved" };
  else if (alternatives.length !== 1) bulk = { eligible: false, reason: "ambiguous" };
  else if (finding.bulkBlock) bulk = { eligible: false, reason: finding.bulkBlock };
  else bulk = { eligible: true, alternative: 0 };

  const context = finding.context ?? range;
  const signature = alternatives.map((alternative) => alternative.preview).join("\u0000");
  return {
    id: `${snapshot.id}/${finding.ruleId}@${range.start}-${range.end}#${hash(signature)}`,
    snapshotId: snapshot.id,
    ruleId: finding.ruleId,
    category: metadata.category,
    messageKey: finding.messageKey,
    lang: options.lang,
    range: { start: range.start, end: range.end },
    original: source.slice(range.start, range.end),
    alternatives,
    bulk,
    context: {
      start: Math.max(0, Math.min(context.start, range.start)),
      end: Math.min(source.length, Math.max(context.end, range.end)),
    },
    ...(finding.dictionaryWord && /^\p{L}+$/u.test(finding.dictionaryWord)
      ? { dictionaryWord: finding.dictionaryWord }
      : {}),
  };
}

function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Synchronous whole-scope review: prepare, scan every chunk, finalize. */
export function detectReviewDiagnostics(
  snapshot: ReviewSourceSnapshot,
  options: ReviewOptions,
): ReviewScanResult {
  const prepared = prepareReview(snapshot, options);
  return finalizeReview(
    prepared,
    reviewChunks(prepared).map((chunk) => scanReviewChunk(prepared, chunk)),
  );
}

/**
 * Proof step for bulk planning: re-runs detection once on the text as it would
 * be after `otherEdits`, and checks each diagnostic is found there with the
 * same edits (shifted). Protected ranges and the scope move with the edits;
 * the edits never touch protected text, so the shift is exact. Only the chunks
 * holding a checked diagnostic are scanned.
 */
export function stillDetectedAfter(
  prepared: PreparedReview,
  diagnostics: readonly ReviewDiagnostic[],
  otherEdits: readonly ReviewEdit[],
): boolean[] {
  const steps = proofSteps(prepared, diagnostics, otherEdits);
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done) return step.value;
  }
}

/** stillDetectedAfter, pausing (`pause`) between its scans so the page stays responsive. */
export async function stillDetectedAfterAsync(
  prepared: PreparedReview,
  diagnostics: readonly ReviewDiagnostic[],
  otherEdits: readonly ReviewEdit[],
  pause: () => Promise<void>,
): Promise<boolean[]> {
  const steps = proofSteps(prepared, diagnostics, otherEdits);
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done) return step.value;
    await pause();
  }
}

/** The proof as steps: it yields after preparing and after each scan. */
function* proofSteps(
  prepared: PreparedReview,
  diagnostics: readonly ReviewDiagnostic[],
  otherEdits: readonly ReviewEdit[],
): Generator<void, boolean[], void> {
  const { snapshot } = prepared;
  const text = applyEdits(snapshot.text, otherEdits);
  if (text === null) return diagnostics.map(() => false);
  const shift = positionShifter(otherEdits);
  const shifted = {
    id: `${snapshot.id}~`,
    text,
    scope: { start: shift(snapshot.scope.start), end: shift(snapshot.scope.end) },
    protectedRanges: snapshot.protectedRanges.map((range) => ({
      ...range,
      start: shift(range.start),
      end: shift(range.end),
    })),
  };
  const next = prepareReview(shifted, prepared.options);
  yield;
  const expected = diagnostics.map((diagnostic) => ({
    start: shift(diagnostic.range.start),
    edits: JSON.stringify(
      diagnostic.alternatives[diagnostic.bulk.eligible ? diagnostic.bulk.alternative : 0].edits.map(
        (edit) => ({ ...edit, start: shift(edit.start), end: shift(edit.end) }),
      ),
    ),
  }));
  const found = new Map<number, Set<string>>();
  // A chunk with a few checked findings is scanned only where they start: the
  // findings a scan owns start in its range, and each detector reads its own
  // bounded context around them.
  const scans: TextRange[] = [];
  for (const chunk of reviewChunks(next)) {
    const starts = expected
      .map(({ start }) => start)
      .filter((start) => start >= chunk.start && start < chunk.end);
    if (starts.length > PROOF_WINDOWS_PER_CHUNK) scans.push(chunk);
    else {
      // From a little before, so a token that opens before its finding (a quote
      // before a capital) is matched from its start.
      for (const start of new Set(starts)) {
        scans.push({ start: Math.max(chunk.start, start - 64), end: start + 1 });
      }
    }
  }
  for (const scan of scans) {
    for (const finding of scanReviewChunk(next, scan).findings) {
      const diagnostic = toDiagnostic(next, finding);
      if (!diagnostic) continue;
      const edits = found.get(diagnostic.range.start) ?? new Set<string>();
      for (const alternative of diagnostic.alternatives)
        edits.add(JSON.stringify(alternative.edits));
      found.set(diagnostic.range.start, edits);
    }
    yield;
  }
  return expected.map(({ start, edits }) => found.get(start)?.has(edits) ?? false);
}

/**
 * Maps a snapshot position to the text after `edits` (non-overlapping). An
 * insertion exactly at the position stays after it.
 */
function positionShifter(edits: readonly ReviewEdit[]): (position: number) => number {
  const sorted = [...edits].sort((a, b) => a.end - b.end || a.start - b.start);
  const deltas: number[] = [0];
  for (const edit of sorted) {
    deltas.push(deltas[deltas.length - 1] + edit.replacement.length - (edit.end - edit.start));
  }
  return (position) => {
    // Edits ending at or before the position.
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle].end <= position) low = middle + 1;
      else high = middle;
    }
    let count = low;
    while (
      count > 0 &&
      sorted[count - 1].start === position &&
      sorted[count - 1].end === position
    ) {
      count -= 1;
    }
    return position + deltas[count];
  };
}
