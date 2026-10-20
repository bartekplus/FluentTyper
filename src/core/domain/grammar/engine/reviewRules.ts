import type { CatalogRuleId } from "../ruleCatalog";
import { cacheable } from "../review/nativeReviewCache";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../review/reviewDetectors";
import type { ReviewMessageKey } from "../review/types";
import { findMatches, type PatternSet } from "./matcher";
import { REVIEW_PATTERNS, REVIEW_RULES } from "./review.generated";
import { tokenize } from "./tokenizer";

/** A named Review detector: a predicate a rule file names with `predicate:`. */
export type Detector = ReviewDetectorEntry["detect"];

/** Named Review detectors by rule file ("common", "en", "de", ...), then by name. */
export type ReviewPredicates = Readonly<Record<string, Readonly<Record<string, Detector>>>>;

/** The detectors of several modules as one record; a name defined twice is an error. */
export function mergePredicates(
  ...records: readonly Readonly<Record<string, Detector>>[]
): Readonly<Record<string, Detector>> {
  const merged: Record<string, Detector> = {};
  for (const record of records)
    for (const [name, detect] of Object.entries(record)) {
      if (Object.hasOwn(merged, name)) throw new Error(`Detector "${name}" is defined twice`);
      merged[name] = detect;
    }
  return merged;
}

// Context read around a chunk for pattern rules; a pattern is far shorter.
const WINDOW = 256;
// One tokenizer pass and one match walk per chunk serve every pattern rule.
const SCANS = new WeakMap<DetectContext, Map<number, RawFinding[]>>();

/** The findings of every pattern rule in the chunk of `ctx`, by pattern index. */
function scan(ctx: DetectContext, set: PatternSet): Map<number, RawFinding[]> {
  let from = Math.max(0, ctx.from - WINDOW);
  // Start at whitespace, so the window does not cut a token in two.
  while (from > 0 && !/\s/.test(ctx.text[from - 1])) from -= 1;
  const to = Math.min(ctx.scanText.length, ctx.to + WINDOW);
  const tokens = tokenize(ctx.scanText, from, to);
  const byPattern = new Map<number, RawFinding[]>();
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

/**
 * The Review detector entries of the rule files, in evaluation order. A rule names a
 * detector of `predicates` ("<file>:<name>") or is a compiled pattern. A name that no
 * module defines is an error at load, not a silent gap.
 */
export function buildReviewDetectors(predicates: ReviewPredicates): ReviewDetectorEntry[] {
  return REVIEW_RULES.map((rule) => {
    let detect: Detector;
    if (rule.pattern !== undefined) detect = patternDetector(rule.pattern);
    else {
      const [namespace, name] = rule.predicate!.split(":");
      const found = predicates[namespace]?.[name];
      if (!found) throw new Error(`Grammar rule ${rule.id}: no detector "${rule.predicate}"`);
      detect = found;
    }
    const entry: ReviewDetectorEntry = {
      rules: rule.checks as CatalogRuleId[],
      detect,
      ...(rule.lang ? { lang: rule.lang } : {}),
      source: rule.source,
    };
    return rule.cacheable ? cacheable(entry) : entry;
  });
}
