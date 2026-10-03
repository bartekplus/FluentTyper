import { proseQuotations } from "./proseQuotations";
import { redundantAcronyms } from "./styleAdvice";
import { longSentenceRanges } from "./readability";
import { matchTerminology } from "./terminologyMatcher";
import type { NativeReviewCache } from "./nativeReviewCache";
import { unclosedQuotations } from "./quotationWarnings";
import { GRAMMAR_RULE_CATALOG, type CatalogRuleId } from "../ruleCatalog";
import { findMarkdownCodeRanges } from "../implementations/helpers/ProtectedSpanShared";
import { isTechnicalToken, normalizeWordSet } from "../implementations/helpers/GenericRuleShared";
import { isReviewSupportedRule, runsInReviewLanguage } from "./reviewCatalog";
import { REVIEW_DETECTORS, type RawFinding } from "./reviewDetectors";
import { toDiagnostic } from "./reviewFindings";
import { PartialDetection } from "./phraseTemplates";
import { PROSE_DOTTED_TOKEN } from "./english/grammarStyle1";
import { isGermanAbbreviationToken } from "./german/abbreviations";
import { GERMAN_SLASH_PAIR } from "./german/suspendedHyphen";
import { SPANISH_PROSE_DOTTED_TOKEN } from "./spanish/typography";
import { PROSE_SLASH_TOKEN } from "./english/dialects";
import { NUMERIC_DATE_TOKEN } from "./english/dates";
import { digitValue, ISO_DATE_TOKEN, versionWordBefore } from "./isoDates";
import { TOKEN_LEAD, TOKEN_TRAIL, unwrapEmphasis } from "./markdownEmphasis";
import { notationToken } from "./english/typography";
import { slashedProseWord } from "./english/remaining";
import { PLACE_STATE_TOKEN } from "./portuguese/typography";
import { SLASH_ABBREVIATION } from "./polish/shared";
import { applyEdits, positionMapper } from "./textRanges";
import {
  MASK_CHAR,
  MAX_REVIEW_CHARS,
  REVIEW_CHUNK_CHARS,
  type CoverageGap,
  type ProtectedRange,
  type ReviewDiagnostic,
  type ReviewEdit,
  type ReviewOptions,
  type ReviewScanResult,
  type ReviewSourceSnapshot,
  type TextRange,
} from "./types";

export { casingDiagnostic, spellingDiagnostic } from "./reviewFindings";
export { MAX_REVIEW_CHARS, REVIEW_CHUNK_CHARS };
// Above this many proofs in one chunk, scanning the chunk once is cheaper.
const PROOF_WINDOWS_PER_CHUNK = 8;
// How far past its chunk a detector's forward scan may need to read.
const SCAN_LOOKAHEAD = 1_024;
// Context read around the scope; enough for every rule's look-behind.
const CONTEXT_MARGIN = 512;

export interface PreparedReview {
  snapshot: ReviewSourceSnapshot;
  options: ReviewOptions;
  /** Source with protected (non-prose) characters masked; same length. */
  text: string;
  protectedRanges: ProtectedRange[];
  rules: ReadonlySet<CatalogRuleId>;
  /** Enabled review rules not run because they do not cover this language. */
  languageSkipped: CatalogRuleId[];
  /**
   * The English checks in `languageSkipped`: this language has no support for them.
   * They are a coverage gap: the check is partial and the panel shows a note. A rule
   * for a different language is not in this list. It does not apply to this text, so
   * it is not a gap.
   */
  englishChecksSkipped: CatalogRuleId[];
  dictionary: ReadonlySet<string>;
  quotationFindings: RawFinding[];
  quotations: ReturnType<typeof proseQuotations>;
  styleFindings: RawFinding[];
  styleFailedRules: CatalogRuleId[];
  terminology: { findings: RawFinding[]; ranges: TextRange[]; limitedChars?: number };
}

/** Resolves rules, protection and the masked analysis text. Pure; no DOM. */
export function prepareReview(
  snapshot: ReviewSourceSnapshot,
  options: ReviewOptions,
): PreparedReview {
  const source = snapshot.text;
  const rules = new Set<CatalogRuleId>();
  const languageSkipped: CatalogRuleId[] = [];
  const englishChecksSkipped: CatalogRuleId[] = [];
  for (const ruleId of options.enabledRules) {
    if (!isReviewSupportedRule(ruleId)) continue;
    if (!runsInReviewLanguage(ruleId, options.lang)) {
      languageSkipped.push(ruleId);
      if (runsInReviewLanguage(ruleId, "en_US")) englishChecksSkipped.push(ruleId);
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
    ...technicalRanges(source, readStart, readEnd, options.lang),
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
      // Line breaks (LF or CRLF) survive masking so line and paragraph logic still works.
      parts.push(source.slice(start, range.end).replace(/[^\r\n]/g, MASK_CHAR));
      cursor = range.end;
    }
    parts.push(source.slice(cursor));
    text = parts.join("");
  }

  const dictionary = normalizeWordSet(options.userDictionary);
  const styleFindings: RawFinding[] = [];
  const styleFailedRules: CatalogRuleId[] = [];
  for (const ruleId of ["styleRedundancy", "styleLongSentence"] as const) {
    if (!rules.has(ruleId)) continue;
    try {
      styleFindings.push(
        ...(ruleId === "styleRedundancy"
          ? redundantAcronyms(snapshot, protectedRanges, dictionary)
          : longSentenceRanges(
              snapshot,
              protectedRanges,
              text,
              options.longSentenceWords,
              options.lang,
            ).map((range) => ({
              ruleId,
              messageKey: "review_msg_style_long_sentence" as const,
              range,
              context: range,
              alternatives: [],
              warningOnly: true as const,
            }))),
      );
    } catch {
      styleFailedRules.push(ruleId);
    }
  }

  return {
    snapshot,
    options,
    text,
    protectedRanges,
    rules,
    languageSkipped,
    englishChecksSkipped,
    dictionary,
    quotations: proseQuotations(text),
    styleFindings,
    styleFailedRules,
    terminology: rules.has("preferredTerminology")
      ? matchTerminology(snapshot, options, protectedRanges, dictionary)
      : { findings: [], ranges: [] },
    quotationFindings:
      rules.has("unclosedQuotation") &&
      !snapshot.incomplete &&
      snapshot.scope.start === 0 &&
      snapshot.scope.end === source.length &&
      source.length <= MAX_REVIEW_CHARS &&
      protectedRanges.length === 0
        ? unclosedQuotations(text, options.lang)
        : [],
  };
}

/**
 * No prose word is this long; longer tokens (hashes, base64, minified code) are
 * protected outright, which also keeps per-token pattern checks linear.
 */
const MAX_PROSE_TOKEN_CHARS = 100;

/**
 * A period-decimal quantity ("2.5", "2.5kg", "3.50€", "21,349.56") is prose, not a dotted
 * name: language rules check its separators. Versions and IPs ("1.2.3") stay technical.
 */
const DECIMAL_QUANTITY =
  /^(?:\p{Nd}{1,9}|\p{Nd}{1,3}(?:,\p{Nd}{3}){1,6})\.\p{Nd}{1,9}(?:\p{L}{1,4}|[€$£¥%])?$/u;
/** A day.month(.year) date ("23.08.2014", "31.4.", Polish "11.XI.1918") is prose, not a dotted name. */
const DOTTED_DATE = /^\d{1,3}\.(?:\d{1,2}|[IVX]{1,4})\.(?:\d{2}|\d{4})?$/;

/**
 * A dotted number shaped like a date ("31.04.2026", "31.4.", "11.XI.1918") is prose, not a
 * version: the date rules check it, and an impossible date gets a warning. It stays technical
 * after a version word ("Version 32.13.2020"), and when neither of its first two parts can be
 * a day or a month ("45.67.2020").
 */
function dottedDate(source: string, start: number, bare: string): boolean {
  if (!DOTTED_DATE.test(bare) && !(NUMERIC_DATE_TOKEN.test(bare) && bare.includes("."))) {
    return false;
  }
  const dayOrMonth = (part: string) => {
    const value = digitValue(part);
    // A Roman numeral is always a month.
    return Number.isNaN(value) || (value >= 1 && value <= 31);
  };
  const [first, second] = bare.split(".");
  if (!dayOrMonth(first) && !dayOrMonth(second)) return false;
  return !versionWordBefore(source, start);
}

/**
 * A slash date ("31/12/2025", "31/سبتمبر/1969") is prose, not a path: the date rules check it,
 * and an impossible date gets a warning. It stays technical after a version word
 * ("Version 32/13/2020"), as a dotted date does.
 */
const slashDate = (source: string, start: number, bare: string) =>
  NUMERIC_DATE_TOKEN.test(bare) && !bare.includes(".") && !versionWordBefore(source, start);
/** A Portuguese ordinal written with a dot ("12.º", "3.ª", or with a letter, "12.o") is prose. */
const PORTUGUESE_DOTTED_ORDINAL = /^\d{1,4}\.(?:[ºªoa]s?)$/;

/** A weekday right before a token: "Monday, ", "Sexta ", "jeudi ". */
const WEEKDAY_BEFORE =
  /(?<!\p{L})(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun|(?:segunda|terça|quarta|quinta|sexta)(?:-feira)?|sábado|domingo|seg|ter|qua|qui|sex|sáb|dom|lunes|martes|miércoles|jueves|viernes|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\.?,?[ \t]{1,4}$/iu;

/**
 * A day and a month are a date, not a path: after a weekday ("Monday, 31/10"), and in French
 * after an article ("le 31/04", "du 2/11").
 */
function dayMonthDate(source: string, start: number, bare: string, lang: string): boolean {
  if (!/^\d{1,2}\/\d{1,2}$/.test(bare)) return false;
  const before = source.slice(Math.max(0, start - 24), start);
  return (
    WEEKDAY_BEFORE.test(before) ||
    (lang.startsWith("fr") && /(?:^|[^\p{L}])(?:le|du|au)[ \t]{1,8}$/iu.test(before))
  );
}

/**
 * URLs, e-mail addresses, paths, mentions, dotted names and overlong tokens in [from, to).
 * The prose checks (dates, decimals, prose slash words) read the token in Markdown emphasis
 * without the delimiters: "**31/04/2020**" is a date. A token that stays technical keeps its
 * delimiters in the range ("__init__").
 */
function technicalRanges(source: string, from: number, to: number, lang: string): ProtectedRange[] {
  const spanish = lang.startsWith("es");
  const polish = lang.startsWith("pl");
  const portuguese = lang.startsWith("pt");
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
    const lead = TOKEN_LEAD.exec(match[0])![0].length;
    const bare = match[0].slice(lead).replace(TOKEN_TRAIL, "");
    if (!bare || !isTechnicalToken(bare)) continue;
    // The text before the token is outside the emphasis ("version **32/13/2020**"). The text
    // after the inner token is inside it.
    const outer = match.index + lead;
    const { inner, offset } = unwrapEmphasis(bare);
    if (
      !DECIMAL_QUANTITY.test(inner) &&
      !ISO_DATE_TOKEN.test(inner) &&
      !dottedDate(source, outer, inner) &&
      !PROSE_DOTTED_TOKEN.test(inner) &&
      !(spanish && SPANISH_PROSE_DOTTED_TOKEN.test(inner)) &&
      !(polish && SLASH_ABBREVIATION.test(inner)) &&
      !(portuguese && PORTUGUESE_DOTTED_ORDINAL.test(inner)) &&
      !isGermanAbbreviationToken(inner) &&
      !(lang.startsWith("de") && GERMAN_SLASH_PAIR.test(inner)) &&
      !PROSE_SLASH_TOKEN.test(inner) &&
      !PLACE_STATE_TOKEN.test(inner) &&
      !slashDate(source, outer, inner) &&
      !dayMonthDate(source, outer, inner, lang) &&
      !notationToken(source, outer + offset, inner) &&
      !slashedProseWord(source, outer + offset, inner)
    ) {
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
export function scanReviewChunk(
  prepared: PreparedReview,
  chunk: TextRange,
  cache?: NativeReviewCache,
): ChunkScan {
  const findings: RawFinding[] = [];
  const failedRules: CatalogRuleId[] = [...prepared.styleFailedRules];
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
    quotationFindings: prepared.quotationFindings,
    quotationRanges: prepared.quotations.ranges,
    exampleRanges: prepared.quotations.examples,
    styleFindings: prepared.styleFindings,
    rules: prepared.rules,
    terminologyFindings: prepared.terminology.findings,
  };
  for (const detector of REVIEW_DETECTORS) {
    const active = detector.rules.filter((ruleId) => prepared.rules.has(ruleId));
    if (active.length === 0) continue;
    try {
      for (const finding of cache
        ? cache.detect(prepared, context, detector)
        : detector.detect(context)) {
        if (prepared.rules.has(finding.ruleId)) findings.push(finding);
      }
    } catch (error) {
      // A failed part of a composite detector keeps its siblings' findings.
      if (error instanceof PartialDetection)
        for (const finding of error.findings)
          if (prepared.rules.has(finding.ruleId)) findings.push(finding);
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
  const protectedChars = protectedCharsInScope(prepared);
  for (const reason of Object.keys(protectedChars) as CoverageGap[]) {
    skipped[reason] = (skipped[reason] ?? 0) + (protectedChars[reason] ?? 0);
  }
  if (prepared.terminology.limitedChars)
    skipped["size-limit"] = (skipped["size-limit"] ?? 0) + prepared.terminology.limitedChars;
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

const PRIORITY = new Map<string, number>(
  GRAMMAR_RULE_CATALOG.map((entry) => [entry.id, entry.priority]),
);

/**
 * Two rules proposing exactly the same change ("i" at a sentence start is both
 * a sentence start and the pronoun) are one issue for the user. The more
 * specific rule (later in the catalog) explains it.
 */
function dropDuplicateFixes(diagnostics: ReviewDiagnostic[]): ReviewDiagnostic[] {
  const byFix = new Map<string, ReviewDiagnostic>();
  const keyOf = (diagnostic: ReviewDiagnostic) =>
    diagnostic.warningOnly
      ? diagnostic.id
      : JSON.stringify(diagnostic.alternatives.map((alternative) => alternative.edits));
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
  // A canonical name owns its casing, including lower-camel names at sentence starts.
  const canonical = new Map(
    diagnostics
      .filter((d) => d.ruleId === "englishCanonicalCasing")
      .map((d) => [d.range.start, d.range.end]),
  );
  const kept = new Set(
    [...byFix.values()].filter(
      (d) =>
        !(
          (d.ruleId === "capitalizeSentenceStart" || d.ruleId === "capitalizeAfterLineBreak") &&
          d.range.end <= (canonical.get(d.range.start) ?? -1)
        ),
    ),
  );
  return diagnostics.filter((diagnostic) => kept.has(diagnostic));
}

function protectedCharsInScope(prepared: PreparedReview): Partial<Record<CoverageGap, number>> {
  const { scope } = prepared.snapshot;
  const counts: Partial<Record<CoverageGap, number>> = {};
  let covered = scope.start;
  for (const range of prepared.protectedRanges) {
    if (range.reason === "technical" || range.reason === "outside-window") continue;
    const start = Math.max(range.start, scope.start, covered);
    const end = Math.min(range.end, scope.end);
    if (end <= start) continue;
    counts[range.reason] = (counts[range.reason] ?? 0) + (end - start);
    covered = end;
  }
  return counts;
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
  const shift = positionMapper(otherEdits);
  const shifted = {
    id: `${snapshot.id}~`,
    incomplete: snapshot.incomplete,
    selection: snapshot.selection,
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
  const expected = diagnostics.map((diagnostic) => {
    const alternative = diagnostic.warningOnly
      ? undefined
      : diagnostic.alternatives[diagnostic.bulk.eligible ? diagnostic.bulk.alternative : 0];
    return {
      start: shift(diagnostic.range.start),
      edits: alternative
        ? JSON.stringify(
            alternative.edits.map((edit) => ({
              ...edit,
              start: shift(edit.start),
              end: shift(edit.end),
            })),
          )
        : null,
    };
  });
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
  return expected.map(
    ({ start, edits }) => edits !== null && (found.get(start)?.has(edits) ?? false),
  );
}
