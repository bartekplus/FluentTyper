import type { CatalogRuleId } from "../ruleCatalog";
import { cacheable } from "../review/nativeReviewCache";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../review/reviewDetectors";
import type { ReviewMessageKey } from "../review/types";
import { detectFrames, prepareFrames } from "./frameStyles";
import { findMatches, type PatternSet } from "./matcher";
import { REVIEW_FRAMES, REVIEW_PATTERNS, REVIEW_RULES } from "./review.generated";
import { primeFrameLiterals, WORD_START } from "../review/phraseTemplates";
import { chunkTokens } from "./reviewTokens";
import { tokenKey } from "./tokenizer";
import type { CompiledFrame } from "./types";

/** A named Review detector: a predicate a rule file names with `predicate:`. */
export type Detector = ReviewDetectorEntry["detect"];

/** Named Review detectors by rule file ("common", "en", "de", ...), then by name. */
export type ReviewPredicates = Readonly<Record<string, Readonly<Record<string, Detector>>>>;

/**
 * A named frame fix: the fix of one match, or null to veto it. Slot rules also pass the chunk
 * context, and their fixers may give the range to replace.
 */
export type Fixer = (m: RegExpExecArray, ctx: DetectContext) => unknown;

/** Any named fix: each frame style passes its own arguments (portuguese: the typed target). */
export type AnyFixer = (...args: never[]) => unknown;

/** Named frame fixes by rule file, then by name. */
export type ReviewFixers = Readonly<Record<string, Readonly<Record<string, AnyFixer>>>>;

/** A named filter of a frame rule's findings: it sees them all, in order. */
export type FindingsFilter = (ctx: DetectContext, findings: RawFinding[]) => RawFinding[];

/** Named findings filters by rule file, then by name. */
export type ReviewFilters = Readonly<Record<string, Readonly<Record<string, FindingsFilter>>>>;

/** The detectors (or fixers) of several modules as one record; a name defined twice is an error. */
export function mergePredicates<T = Detector>(
  ...records: readonly Readonly<Record<string, T>>[]
): Readonly<Record<string, T>> {
  const merged: Record<string, T> = {};
  for (const record of records)
    for (const [name, value] of Object.entries(record)) {
      if (Object.hasOwn(merged, name)) throw new Error(`"${name}" is defined twice`);
      merged[name] = value;
    }
  return merged;
}

// One match walk per chunk serves every pattern rule.
const SCANS = new WeakMap<DetectContext, Map<number, RawFinding[]>>();

// The anchor literals of a small anchored pattern set, for a test before tokenizing.
const LITERALS = new WeakMap<PatternSet, string[] | null>();
const literalsOf = (set: PatternSet) => {
  let literals = LITERALS.get(set);
  if (literals === undefined) {
    const keys = Object.keys(set.anchors);
    literals = set.structural.length === 0 && keys.length <= 64 ? keys : null;
    LITERALS.set(set, literals);
  }
  return literals;
};

/** The findings of every pattern rule in the chunk of `ctx`, by pattern index. */
function scan(ctx: DetectContext, set: PatternSet): Map<number, RawFinding[]> {
  const byPattern = new Map<number, RawFinding[]>();
  // No anchor literal in the chunk and its margins: no pattern can match, so no tokens.
  const literals = literalsOf(set);
  if (literals) {
    const lower = tokenKey(ctx.scanText.slice(Math.max(0, ctx.from - 32), ctx.to + 96));
    if (!literals.some((literal) => lower.includes(literal))) return byPattern;
  }
  const tokens = chunkTokens(ctx);
  const matches = findMatches(
    set,
    tokens,
    ctx.text,
    ctx.lang,
    (pattern) => !ctx.rules || ctx.rules.has(pattern.check),
  );
  for (const match of matches) {
    if (match.targetStart < ctx.from || match.targetStart >= ctx.to) continue;
    // A user-dictionary word in the replaced text is the writer's choice.
    if (
      tokens.some(
        (token) =>
          token.start >= match.targetStart &&
          token.end <= match.targetEnd &&
          ctx.dictionary.has(token.key),
      )
    )
      continue;
    const { pattern, alternatives } = match;
    const list = byPattern.get(pattern.index) ?? [];
    list.push({
      ruleId: pattern.check as CatalogRuleId,
      messageKey: pattern.message as ReviewMessageKey,
      range: { start: match.targetStart, end: match.targetEnd },
      alternatives,
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
      context: { start: match.start, end: match.end },
      ...(pattern.bulkBlock ? { bulkBlock: pattern.bulkBlock } : {}),
    });
    byPattern.set(pattern.index, list);
  }
  return byPattern;
}

/** The detector of compiled pattern `index`: it reads the shared scan of the chunk. */
export function patternDetector(index: number, set: PatternSet = REVIEW_PATTERNS): Detector {
  return (ctx) => {
    let byPattern = SCANS.get(ctx);
    if (!byPattern) SCANS.set(ctx, (byPattern = scan(ctx, set)));
    return byPattern.get(index) ?? [];
  };
}

const named = <T>(table: Readonly<Record<string, Readonly<Record<string, T>>>>, ref: string) => {
  const [namespace, name] = ref.split(":");
  return table[namespace]?.[name];
};

/**
 * The detector of the frame rule `id` of the rule files: its frames, tried in order, with the
 * literals the compiler found and the named fixers of `fixers`.
 */
export function frameRuleDetector(
  id: string,
  fixers: ReviewFixers,
  filters: ReviewFilters = {},
): Detector {
  const rule = REVIEW_RULES.find((entry) => entry.id === id);
  if (!rule?.frames) throw new Error(`Grammar rule ${id} is not a frame rule`);
  const ruleId = rule.checks[0] as CatalogRuleId;
  const messageKey = rule.message as ReviewMessageKey;
  const compiled = rule.frames.map((index) => REVIEW_FRAMES[index]);
  for (const { pattern, literals } of compiled) primeFrameLiterals(pattern, [...literals]);
  const filter = rule.filter === undefined ? undefined : named(filters, rule.filter);
  if (rule.filter !== undefined && !filter)
    throw new Error(`Grammar rule ${id}: no filter "${rule.filter}"`);
  const fixOf = (fix: CompiledFrame["fix"], fixer: string | undefined) => {
    if (fixer === undefined) return fix!;
    const found = named(fixers, fixer);
    if (!found) throw new Error(`Grammar rule ${id}: no fixer "${fixer}"`);
    return found;
  };
  const style = rule.style ?? "frame";
  // A cased frame runs behind WORD_START: its literals are the same.
  if (style === "cased")
    for (const { pattern, literals } of compiled)
      primeFrameLiterals(`${WORD_START}${pattern}`, [...literals]);
  const frames = prepareFrames(style, compiled, ruleId, messageKey, (frame) =>
    fixOf(frame.fix, frame.fixer),
  );
  const detect: Detector = (ctx) => detectFrames(ctx, style, frames);
  return filter ? (ctx) => filter(ctx, detect(ctx)) : detect;
}

/**
 * The Review detector entries of the rule files, in evaluation order. A rule names a
 * detector of `predicates` ("<file>:<name>") or is a compiled pattern. A name that no
 * module defines is an error at load, not a silent gap.
 */
export function buildReviewDetectors(
  predicates: ReviewPredicates,
  fixers: ReviewFixers = {},
  filters: ReviewFilters = {},
): ReviewDetectorEntry[] {
  return REVIEW_RULES.map((rule) => {
    let detect: Detector;
    if (rule.pattern !== undefined) detect = patternDetector(rule.pattern);
    else if (rule.frames !== undefined) detect = frameRuleDetector(rule.id, fixers, filters);
    else {
      const found = named(predicates, rule.predicate!);
      if (!found) throw new Error(`Grammar rule ${rule.id}: no detector "${rule.predicate}"`);
      detect = found;
    }
    // One shape for every entry: the scan reads them all for each chunk.
    const entry: ReviewDetectorEntry = {
      rules: rule.checks as CatalogRuleId[],
      detect,
      lang: rule.lang,
      source: rule.source,
    };
    return rule.cacheable ? cacheable(entry) : entry;
  });
}
