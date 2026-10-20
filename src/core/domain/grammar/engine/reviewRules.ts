import type { CatalogRuleId } from "../ruleCatalog";
import { cacheable } from "../review/nativeReviewCache";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../review/reviewDetectors";
import type { ReviewMessageKey } from "../review/types";
import { frameDetector as slotFrames, type Frame as SlotFrame } from "../review/english/idioms5";
import { runCarryFrames as carryFrames, type Frame as CarryFrame } from "../review/english/idioms3";
import { runCommaFrames as commaFrames, type CommaFrame } from "../review/polish/commaFrames";
import {
  runCasedFrames as casedFrames,
  type Frame as CasedFrame,
} from "../review/portuguese/typography";
import { runFrames as polishFrames, type Frame as PolishFrame } from "../review/polish/shared";
import {
  runGermanFrames as germanFrames,
  type Frame as GermanFrame,
} from "../review/german/confusions";
import {
  runConfusionFrames as portugueseFrames,
  type Frame as PortugueseFrame,
} from "../review/portuguese/confusions";
import { findMatches, type PatternSet } from "./matcher";
import { REVIEW_FRAMES, REVIEW_PATTERNS, REVIEW_RULES } from "./review.generated";
import {
  detectFrameList,
  detectPhraseTemplates,
  primeFrameLiterals,
  WORD_START,
  type Frame,
  type PhraseTemplate,
} from "../review/phraseTemplates";
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
  let detect: Detector;
  if (rule.style === "comma") {
    const frames: CommaFrame[] = compiled.map((frame) => ({
      ruleId: (frame.check ?? ruleId) as CommaFrame["ruleId"],
      messageKey: (frame.message ?? messageKey) as ReviewMessageKey,
      regex: new RegExp(frame.pattern, frame.flags ?? "dgu"),
      fix: fixOf(frame.fix, frame.fixer) as CommaFrame["fix"],
    }));
    detect = (ctx) => commaFrames(ctx, frames);
  } else if (rule.style === "cased") {
    // typography.ts compiles each frame behind WORD_START: its literals are the same.
    for (const { pattern, literals } of compiled)
      primeFrameLiterals(`${WORD_START}${pattern}`, [...literals]);
    const frames: CasedFrame[] = compiled.map((frame) => ({
      pattern: frame.pattern,
      replace: fixOf(frame.fix, frame.fixer) as CasedFrame["replace"],
      ruleId: (frame.check ?? ruleId) as CasedFrame["ruleId"],
      messageKey: (frame.message ?? messageKey) as ReviewMessageKey,
    }));
    detect = (ctx) => casedFrames(ctx, frames);
  } else if (rule.style === "carry") {
    const frames: CarryFrame[] = compiled.map((frame) => ({
      rule: {
        ruleId: (frame.check ?? ruleId) as CatalogRuleId,
        messageKey: (frame.message ?? messageKey) as ReviewMessageKey,
      },
      pattern: frame.pattern,
      fix: fixOf(frame.fix, frame.fixer) as CarryFrame["fix"],
      ...(frame.verbatim ? { verbatim: true as const } : {}),
      ...(frame.targetOnly ? { targetOnly: true as const } : {}),
    }));
    detect = (ctx) => carryFrames(ctx, frames);
  } else if (rule.style === "german") {
    const frames: GermanFrame[] = compiled.map((frame) => ({
      regex: new RegExp(frame.pattern, "gdu"),
      fix: fixOf(frame.fix, frame.fixer) as GermanFrame["fix"],
      ...(frame.ownCase ? { ownCase: true as const } : {}),
    }));
    detect = (ctx) => germanFrames(ctx, frames);
  } else if (rule.style === "portuguese") {
    const frames: PortugueseFrame[] = compiled.map((frame) => ({
      pattern: frame.pattern,
      alternatives: fixOf(frame.fix, frame.fixer) as PortugueseFrame["alternatives"],
      messageKey: (frame.message ?? messageKey) as ReviewMessageKey,
      ...(frame.clauseStart ? { clauseStart: true as const } : {}),
      ...(frame.capitalized ? { capitalized: true as const } : {}),
    }));
    detect = (ctx) => portugueseFrames(ctx, frames);
  } else if (rule.style === "polish") {
    const frames: PolishFrame[] = compiled.map((frame) => ({
      pattern: frame.pattern,
      fix: fixOf(frame.fix, frame.fixer) as PolishFrame["fix"],
      ruleId: (frame.check ?? ruleId) as CatalogRuleId,
      messageKey: (frame.message ?? messageKey) as ReviewMessageKey,
      ...(frame.verbatim ? { verbatim: true as const } : {}),
      ...(frame.lowercase ? { lowercase: true as const } : {}),
    }));
    detect = (ctx) => polishFrames(ctx, frames);
  } else if (rule.style === "slot") {
    const frames: SlotFrame[] = compiled.map((frame) => ({
      rule: {
        ruleId: (frame.check ?? ruleId) as CatalogRuleId,
        messageKey: (frame.message ?? messageKey) as ReviewMessageKey,
      },
      ...(frame.cue ? { cue: frame.cue } : {}),
      pattern: frame.wordStart === false ? new RegExp(frame.pattern, "gidu") : frame.pattern,
      fix: fixOf(frame.fix, frame.fixer) as SlotFrame["fix"],
    }));
    detect = slotFrames(frames);
  } else if (rule.style === "template") {
    const templates: PhraseTemplate[] = compiled.map((frame) => ({
      pattern: frame.pattern,
      replacement: frame.fix as string,
      messageKey: (frame.message ?? messageKey) as ReviewMessageKey,
      ...(frame.clauseStart ? { clauseStart: true as const } : {}),
    }));
    detect = (ctx) => detectPhraseTemplates(ctx, templates, ruleId);
  } else {
    const frames: Frame[] = compiled.map(({ pattern, fix, fixer, raw }) => ({
      pattern,
      fix: fixOf(fix, fixer) as Frame["fix"],
      ...(raw ? { raw } : {}),
    }));
    detect = (ctx) => detectFrameList(ctx, ruleId, messageKey, frames);
  }
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
