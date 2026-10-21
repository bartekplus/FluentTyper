import { detectAll } from "../review/phraseTemplates";
import type { CatalogRuleId } from "../ruleCatalog";
import { cacheable } from "../review/nativeReviewCache";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../review/reviewDetectors";
import type { ReviewMessageKey } from "../review/types";
import { detectFrames, prepareFrames } from "./frameStyles";
import { REVIEW_FRAMES, REVIEW_RULES } from "./review.generated";
import { RULE_DETECTORS, RULE_FILTERS, RULE_FIXERS } from "../review/rules/index.generated";
import { primeFrameLiterals, WORD_START } from "../review/phraseTemplates";
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

/** The code a compiled rule names ("<file>:<name>"), in the generated module of its file. */
const named = <T>(table: Readonly<Record<string, Readonly<Record<string, T>>>>, ref: string) => {
  const [namespace, name] = ref.split(":");
  return table[namespace]?.[name];
};

/**
 * The detector of the frame rule `id` of the rule files: its frames, tried in order, with the
 * literals the compiler found and the code of its rule file.
 */
function frameRuleDetector(id: string): Detector {
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
 * The Review detector entries of the rule files, in evaluation order: the frames and the code of
 * a rule, or the findings of an earlier pass. Code that the generated
 * modules do not hold is an error at load, not a silent gap.
 */
export function buildReviewDetectors(): ReviewDetectorEntry[] {
  const entries = REVIEW_RULES.map((rule) => {
    // One shape for every entry: the scan reads them all for each chunk.
    const entry: ReviewDetectorEntry = {
      rules: rule.checks as CatalogRuleId[],
      detect: detectorOf(rule),
      lang: rule.lang,
      source: rule.source,
    };
    return rule.cacheable ? cacheable(entry) : entry;
  });
  return grouped(entries);
}

/** The detector of the Review rule `id`, as the Review scan runs it (rule code: enRuleFindings). */
export function ruleDetector(id: string): Detector {
  const rule = REVIEW_RULES.find((entry) => entry.id === id);
  if (!rule) throw new Error(`No Review rule ${id}`);
  return detectorOf(rule);
}

/** A rule's detector: its frames and then its own code, or earlier findings. */
function detectorOf(rule: (typeof REVIEW_RULES)[number]): Detector {
  if (rule.findings !== undefined) {
    const field = FINDINGS_FIELDS[rule.findings];
    // The findings whose range starts in the chunk.
    return (ctx) =>
      (ctx[field] ?? []).filter((f) => f.range.start >= ctx.from && f.range.start < ctx.to);
  }
  if (rule.frames !== undefined) {
    const frames = frameRuleDetector(rule.id);
    if (rule.predicate === undefined) return frames;
    // The frames, then the rule's own code: one composite whose parts keep their findings
    // when the other throws.
    const after = named(RULE_DETECTORS, rule.predicate);
    if (!after) throw new Error(`Grammar rule ${rule.id}: no detector "${rule.predicate}"`);
    return (ctx) => detectAll(ctx, [frames, after]);
  }
  const found = named(RULE_DETECTORS, rule.predicate!);
  if (!found) throw new Error(`Grammar rule ${rule.id}: no detector "${rule.predicate}"`);
  return found;
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
      const entry: ReviewDetectorEntry = {
        rules,
        detect: (ctx) => parts.flatMap((part) => part.detect(ctx)),
        lang: parts[0].lang,
        source: parts[0].source,
      };
      // The group is cacheable only when each of its rules is.
      out.push(
        REVIEW_RULES.slice(i, end).every((rule) => rule.cacheable) ? cacheable(entry) : entry,
      );
    }
    i = end;
  }
  return out;
}
