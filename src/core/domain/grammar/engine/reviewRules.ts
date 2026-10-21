import { detectAll } from "../review/phraseTemplates";
import type { CatalogRuleId } from "../ruleCatalog";
import { cacheable } from "../review/nativeReviewCache";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../review/reviewDetectors";
import type { ReviewMessageKey } from "../review/types";
import { detectFrames, prepareFrames } from "./frameStyles";
import { findMatches, type PatternSet } from "./matcher";
import { REVIEW_FRAMES, REVIEW_PATTERNS, REVIEW_RULES } from "./review.generated";
import { RULE_DETECTORS, RULE_FILTERS, RULE_FIXERS } from "../review/rules/index.generated";
import { primeFrameLiterals, WORD_START } from "../review/phraseTemplates";
import { chunkTokens } from "./reviewTokens";
import { tokenKey } from "./tokenizer";
import type { CompiledFrame } from "./types";

/** A Review detector: the code of a rule (`let`, `when`, `return`) and of its frames. */
export type Detector = ReviewDetectorEntry["detect"];

/** The check and message a frame reports. */
export interface FrameRef {
  readonly ruleId: CatalogRuleId;
  readonly messageKey: ReviewMessageKey;
  /**
   * Owned, text and polish scans: the scan reads its next match from `index` (for frames whose
   * matches overlap). Call it before the fixer returns.
   */
  readonly resume?: (index: number) => void;
}

/**
 * What the fixer of a match rule gives for one match: a fix or the fixes to choose from (a
 * finding on the `target` group), its own findings, or nothing (null, undefined or []).
 */
export type MatchResult =
  string | readonly string[] | RawFinding | readonly RawFinding[] | null | undefined;

/** Any named fix: each frame style passes its own arguments (portuguese: the typed target). */
export type AnyFixer = (...args: never[]) => unknown;

/** A named filter of a frame rule's findings: it sees them all, in order. */
export type FindingsFilter = (ctx: DetectContext, findings: RawFinding[]) => RawFinding[];

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

/** The code a compiled rule names ("<file>:<name>"), in the generated module of its file. */
const named = <T>(table: Readonly<Record<string, Readonly<Record<string, T>>>>, ref: string) => {
  const [namespace, name] = ref.split(":");
  return table[namespace]?.[name];
};

/**
 * The detector of the frame rule `id` of the rule files: its frames, tried in order, with the
 * literals the compiler found and the code of its rule file.
 */
export function frameRuleDetector(id: string): Detector {
  const rule = REVIEW_RULES.find((entry) => entry.id === id);
  if (!rule?.frames) throw new Error(`Grammar rule ${id} is not a frame rule`);
  const ruleId = rule.checks[0] as CatalogRuleId;
  const messageKey = rule.message as ReviewMessageKey;
  const compiled = rule.frames.map((index) => REVIEW_FRAMES[index]);
  for (const { pattern, literals } of compiled) primeFrameLiterals(pattern, [...literals]);
  const filter = rule.filter === undefined ? undefined : named(RULE_FILTERS, rule.filter);
  if (rule.filter !== undefined && !filter)
    throw new Error(`Grammar rule ${id}: no filter "${rule.filter}"`);
  const fixOf = (fix: CompiledFrame["fix"], fixer: string | undefined) => {
    if (fixer === undefined) return fix!;
    const found = named(RULE_FIXERS, fixer);
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
 * The Review detector entries of the rule files, in evaluation order: a compiled pattern, the
 * frames and the code of a rule, or the findings of an earlier pass. Code that the generated
 * modules do not hold is an error at load, not a silent gap.
 */
export function buildReviewDetectors(): ReviewDetectorEntry[] {
  const entries = REVIEW_RULES.map((rule) => {
    let detect: Detector;
    if (rule.findings !== undefined) {
      const field = FINDINGS_FIELDS[rule.findings];
      // The findings whose range starts in the chunk.
      detect = (ctx) =>
        (ctx[field] ?? []).filter((f) => f.range.start >= ctx.from && f.range.start < ctx.to);
    } else if (rule.pattern !== undefined) detect = patternDetector(rule.pattern);
    else if (rule.frames !== undefined) {
      detect = frameRuleDetector(rule.id);
      if (rule.predicate !== undefined) {
        // The frames, then the rule's own code: one composite whose parts keep their findings
        // when the other throws.
        const after = named(RULE_DETECTORS, rule.predicate);
        if (!after) throw new Error(`Grammar rule ${rule.id}: no detector "${rule.predicate}"`);
        const frames = detect;
        detect = (ctx) => detectAll(ctx, [frames, after]);
      }
    } else {
      const found = named(RULE_DETECTORS, rule.predicate!);
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
  return grouped(entries);
}

// The context field of each findings rule.
const FINDINGS_FIELDS = {
  style: "styleFindings",
  terminology: "terminologyFindings",
  quotation: "quotationFindings",
} as const;

/**
 * Consecutive entries of one rule group (same file, same `group`) as one entry: the parts run
 * in order and their findings join; a part that throws stops the group, as one composite check.
 */
function grouped(entries: ReviewDetectorEntry[]): ReviewDetectorEntry[] {
  const out: ReviewDetectorEntry[] = [];
  for (let i = 0; i < entries.length;) {
    const group = REVIEW_RULES[i].group;
    let end = i + 1;
    while (
      group !== undefined &&
      end < entries.length &&
      REVIEW_RULES[end].group === group &&
      REVIEW_RULES[end].source === REVIEW_RULES[i].source
    )
      end++;
    if (end === i + 1) out.push(entries[i]);
    else {
      const parts = entries.slice(i, end);
      const rules = [...new Set(parts.flatMap((part) => part.rules))];
      out.push({
        rules,
        detect: (ctx) => parts.flatMap((part) => part.detect(ctx)),
        lang: parts[0].lang,
        source: parts[0].source,
      });
    }
    i = end;
  }
  return out;
}
