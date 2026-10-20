import type { CatalogRuleId } from "../ruleCatalog";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { quotedSpan } from "../review/exampleCues";
import { recase, type Fix, type FixResult } from "../review/english/idioms5";
import { likeTyped } from "../review/german/shared";
import { findingAt, isPl, owned, sentenceStartAt, userOrNamed } from "../review/polish/shared";
import { CLAUSE_BEFORE, pushFinding } from "../review/portuguese/confusions";
import { userWord } from "../review/portuguese/typography";
import {
  caseLike,
  FRAME_AUDIT,
  found,
  frameMatches,
  group,
  hasUserOrCasedWord,
  isLang,
  opensSentence,
  type PhraseTemplate,
  WORD_START,
} from "../review/phraseTemplates";
import type { DetectContext, RawFinding } from "../review/reviewDetectors";
import type { MatchResult } from "./reviewRules";
import type { ReviewMessageKey } from "../review/types";
import type { CompiledFrame, FrameStyle } from "./types";

/** A frame of a rule file, ready to run: its scan, its fix and the check it reports. */
export interface RunFrame {
  readonly pattern: string | RegExp;
  /** A fix, the alternatives, or a named fixer; each style passes the fixer its own arguments. */
  readonly fix: unknown;
  readonly ruleId: CatalogRuleId;
  readonly messageKey: ReviewMessageKey;
  readonly cue?: readonly string[];
  readonly owner: string | ((m: RegExpExecArray) => number) | null;
  readonly scan: NonNullable<CompiledFrame["scan"]>;
  readonly gate?: RegExp;
  readonly frame: CompiledFrame;
}

type AnyFix = (...args: unknown[]) => unknown;
const fixOf = (frame: RunFrame, ...args: unknown[]) =>
  typeof frame.fix === "function" ? (frame.fix as AnyFix)(...args) : frame.fix;

/** How one frame style reads its matches; the frame loop is shared. */
interface Style {
  /** The text the style runs on. */
  runs: (ctx: DetectContext) => boolean;
  /** The scan of a frame: a complete regex, or none for a frame pattern (WORD_START, `gidu`). */
  regex?: (frame: CompiledFrame) => RegExp | undefined;
  /** The group whose start owns a match (default: `target`). */
  owner?: (frame: CompiledFrame) => RunFrame["owner"];
  /** The scan of every frame of the style (default: the frame's own `scan`, or "frame"). */
  scan?: NonNullable<CompiledFrame["scan"]>;
  /** Adds the findings of one match. */
  find: (ctx: DetectContext, m: RegExpExecArray, frame: RunFrame, findings: RawFinding[]) => void;
}

const target = (m: RegExpExecArray) => m.indices!.groups!.target;
const matchEnd = (m: RegExpExecArray) => m.index + m[0].length;
// The context of a finding: 40 characters before the match, 20 after it.
const near = (ctx: DetectContext, m: RegExpExecArray) => ({
  start: Math.max(0, m.index - 40),
  end: Math.min(ctx.text.length, matchEnd(m) + 20),
});
const choice = (alternatives: readonly unknown[]) =>
  alternatives.length > 1 ? { requiresChoice: true as const } : {};

// The lowercase words from 256 characters before the chunk to 256 after it: the cue words of
// slot frames are looked up here, once per chunk.
const WORDS_NEAR = new WeakMap<DetectContext, Set<string>>();
function wordsNear(ctx: DetectContext): Set<string> {
  let words = WORDS_NEAR.get(ctx);
  if (!words) {
    words = new Set(
      ctx.scanText
        .slice(Math.max(0, ctx.from - 256), ctx.to + 256)
        .toLowerCase()
        .match(/\p{L}+/gu),
    );
    WORDS_NEAR.set(ctx, words);
  }
  return words;
}

/** The first named group other than `noun` that matched (German frames). */
const germanGroup = (m: RegExpExecArray) =>
  Object.keys(m.groups!).find((name) => name !== "noun" && m.groups![name]);

const STYLES: Record<FrameStyle, Style> = {
  // English: the `target` group, in the casing of the typed words unless the fix is `raw`.
  frame: {
    runs: (ctx) => ctx.lang.startsWith("en"),
    find(ctx, m, frame, findings) {
      const [start, end] = target(m);
      if (hasUserOrCasedWord(ctx, ctx.text.slice(m.index, Math.max(end, matchEnd(m))))) return;
      const value = fixOf(frame, m) as string | readonly string[] | null;
      if (value === null) return;
      const style = detectWordCase(m.groups!.target.trim());
      const alternatives = [value]
        .flat()
        .map((alt) => (frame.frame.raw ? alt : applyWordCase(alt, style)));
      findings.push({
        ruleId: frame.ruleId,
        messageKey: frame.messageKey,
        range: { start, end },
        alternatives,
        ...choice(alternatives),
        context: near(ctx, m),
      });
    },
  },
  // Any language: one replacement in the casing of the target; a clause start when asked.
  template: {
    runs: () => true,
    find(ctx, m, frame, findings) {
      if (frame.frame.clauseStart && !opensSentence(ctx.scanText, m.index)) return;
      // "TypeScript" is the one mixed-case word a template names itself.
      if (hasUserOrCasedWord(ctx, m[0].replace(/\bTypeScript\b/g, ""))) return;
      const replacement = frame.fix as string;
      findings.push(
        found(ctx, m, frame.ruleId, frame.messageKey, [
          replacement ? applyWordCase(replacement, detectWordCase(m.groups!.target)) : "",
        ]),
      );
    },
  },
  // English: a fix may give its own range (`target2` is a second owner); quoted examples abstain.
  slot: {
    runs: (ctx) => isLang(ctx, "en"),
    regex: (frame) => (frame.wordStart === false ? new RegExp(frame.pattern, "gidu") : undefined),
    owner: ({ pattern }) =>
      /\(\?<target2>/.test(pattern)
        ? (m) => (m.indices!.groups!.target ?? m.indices!.groups!.target2)[0]
        : "target",
    find(ctx, m, frame, findings) {
      if (hasUserOrCasedWord(ctx, m[0])) return;
      // A quoted example ("need to backup") is mentioned, not used.
      if (quotedSpan(ctx.text, m.index, matchEnd(m))) return;
      const result = fixOf(frame, m, ctx) as FixResult;
      if (result === null) return;
      const {
        alternatives,
        range = group(m, "target") ?? group(m, "target2"),
        raw,
      }: Fix = typeof result === "string"
        ? { alternatives: [result] }
        : "alternatives" in result
          ? result
          : { alternatives: result };
      const [start, end] = range;
      const typed = ctx.text.slice(start, end);
      const cased = alternatives.map((alt) => (raw ? alt : recase(typed, alt, m[0])));
      if (cased.includes(typed)) return;
      findings.push({
        ruleId: frame.ruleId,
        messageKey: frame.messageKey,
        range: { start, end },
        alternatives: cased,
        ...choice(cased),
        context: {
          start: Math.max(0, Math.min(start, m.index) - 40),
          end: Math.min(ctx.text.length, Math.max(end, matchEnd(m)) + 20),
        },
      });
    },
  },
  // English: the case of the target carried onto the fix; the user guard reads the whole match.
  carry: {
    runs: (ctx) => isLang(ctx, "en"),
    find(ctx, m, frame, findings) {
      const [start, end] = target(m);
      const typed = ctx.text.slice(start, end);
      if (hasUserOrCasedWord(ctx, frame.frame.targetOnly ? typed : m[0])) return;
      const value = fixOf(frame, m, ctx) as string | readonly string[] | null;
      if (value === null) return;
      const alternatives = [value]
        .flat()
        .map((alt) => (frame.frame.verbatim ? alt : caseLike(typed, alt)));
      findings.push({
        ruleId: frame.ruleId,
        messageKey: frame.messageKey,
        range: { start, end },
        alternatives,
        ...choice(alternatives),
        context: near(ctx, m),
      });
    },
  },
  // German: the first named group other than `noun`, in the typed capital unless `ownCase`.
  german: {
    runs: (ctx) => isLang(ctx, "de"),
    regex: (frame) => new RegExp(frame.pattern, "gdu"),
    owner: () => (m) => {
      const name = germanGroup(m);
      return name ? m.indices!.groups![name][0] : -1;
    },
    find(ctx, m, frame, findings) {
      const name = germanGroup(m);
      if (!name) return;
      const [start, end] = m.indices!.groups![name];
      const typed = m.groups![name];
      if (ctx.dictionary.has(typed.toLowerCase())) return;
      const fixed = fixOf(frame, m) as string | readonly string[] | null;
      const replacements = fixed === null ? [] : [fixed].flat().filter((r) => r !== typed);
      if (replacements.length === 0) return;
      findings.push({
        ruleId: frame.ruleId,
        messageKey: frame.messageKey,
        range: { start, end },
        alternatives: replacements.map((replacement) =>
          frame.frame.ownCase ? replacement : likeTyped(typed, replacement),
        ),
        ...choice(replacements),
        context: { start: Math.max(0, start - 60), end: Math.min(ctx.text.length, end + 40) },
      });
    },
  },
  // Portuguese: a fixer reads the typed target; a capitalized name inside a frame is not prose.
  portuguese: {
    runs: (ctx) => isLang(ctx, "pt"),
    find(ctx, m, frame, findings) {
      if (
        frame.frame.clauseStart &&
        !CLAUSE_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))
      )
        return;
      // Frames are matched ignoring case; a capitalized name inside one is not prose.
      if (/\s\p{Lu}/u.test(m[0])) return;
      if (frame.frame.capitalized && !/^\p{Lu}/u.test(m.groups!.target)) return;
      const alternatives = fixOf(frame, m.groups!.target) as string[];
      pushFinding(ctx, findings, m, alternatives, frame.messageKey, frame.ruleId);
    },
  },
  // Portuguese typography: case-sensitive, one replacement; the target's token may be a user word.
  cased: {
    runs: (ctx) => isLang(ctx, "pt"),
    regex: (frame) => new RegExp(`${WORD_START}${frame.pattern}`, "gdu"),
    find(ctx, m, frame, findings) {
      const [start, end] = target(m);
      if (userWord(ctx, start, end)) return;
      findings.push({
        ruleId: frame.ruleId,
        messageKey: frame.messageKey,
        range: { start, end },
        alternatives: [fixOf(frame, m) as string],
        context: { start: m.index, end: Math.max(end, matchEnd(m)) },
      });
    },
  },
  // Polish: the typed case carried onto the fix; `lowercase` frames skip a capital mid-sentence.
  polish: {
    runs: (ctx) => isPl(ctx),
    find(ctx, m, frame, findings) {
      const [start, end] = target(m);
      const typed = ctx.source.slice(start, end);
      if (userOrNamed(ctx, typed)) return;
      if (frame.frame.lowercase && /^\p{Lu}/u.test(typed) && !sentenceStartAt(ctx.text, start))
        return;
      const fixed = fixOf(frame, m) as string | readonly string[] | null;
      if (fixed === null) return;
      const alternatives = [fixed]
        .flat()
        .map((alt) => (frame.frame.verbatim ? alt : caseLike(typed, alt)))
        .filter((alt) => alt !== typed);
      if (alternatives.length === 0) return;
      findings.push(findingAt(ctx, start, end, alternatives, frame.ruleId, frame.messageKey));
    },
  },
  // Polish: an owned scan; the `target` group gets one fix (a comma, or its removal).
  comma: {
    runs: (ctx) => isPl(ctx),
    regex: (frame) => new RegExp(frame.pattern, frame.flags ?? "dgu"),
    scan: "polish",
    find(ctx, m, frame, findings) {
      const [start, end] = target(m);
      if (start < ctx.from || start >= ctx.to) return;
      const typed = ctx.source.slice(start, end);
      if (/\p{L}/u.test(typed) && userOrNamed(ctx, typed)) return;
      const fixed = fixOf(frame, m, ctx) as string | null;
      if (fixed === null || fixed === typed) return;
      findings.push(findingAt(ctx, start, end, [fixed], frame.ruleId, frame.messageKey));
    },
  },
  // Polish: an owned scan; the whole match gets one fix.
  swap: {
    runs: (ctx) => isPl(ctx),
    regex: (frame) => new RegExp(frame.pattern, frame.flags ?? "gu"),
    scan: "polish",
    find(ctx, m, frame, findings) {
      const typed = m[0];
      if (userOrNamed(ctx, typed)) return;
      const fixed = fixOf(frame, m, ctx) as string | null;
      if (fixed === null || fixed === typed) return;
      findings.push(
        findingAt(ctx, m.index, m.index + typed.length, [fixed], frame.ruleId, frame.messageKey),
      );
    },
  },
  // Any language: the fixer reads the match and gives fixes for `target`, findings or nothing.
  match: {
    runs: () => true,
    regex: (frame) =>
      (frame.scan ?? "frame") !== "frame" || frame.flags !== undefined || frame.wordStart === false
        ? new RegExp(frame.pattern, frame.flags ?? "gidu")
        : undefined,
    owner: ({ owner = "target" }) => {
      if (owner === "none") return null;
      if (!owner.includes("|")) return owner;
      const names = owner.split("|");
      return (m) => {
        const groups = m.indices!.groups!;
        const name = names.find((n) => groups[n]);
        return name ? groups[name][0] : -1;
      };
    },
    find(ctx, m, frame, findings) {
      const result = fixOf(frame, m, ctx, frame) as MatchResult;
      if (result === null || result === undefined) return;
      if (typeof result === "string")
        findings.push(found(ctx, m, frame.ruleId, frame.messageKey, [result]));
      else if (!isList(result)) findings.push(result);
      else if (result.length === 0) return;
      else if (typeof result[0] === "string")
        findings.push(found(ctx, m, frame.ruleId, frame.messageKey, [...(result as string[])]));
      else findings.push(...(result as readonly RawFinding[]));
    },
  },
};

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** Matches of a regex from `lookback` characters before the chunk until one starts after it. */
function* scanFrom(
  ctx: DetectContext,
  regex: RegExp,
  text: string,
  lookback: number,
): Generator<RegExpExecArray> {
  regex.lastIndex = Math.max(0, ctx.from - lookback);
  for (let m = regex.exec(text); m && m.index < ctx.to; m = regex.exec(text)) yield m;
}

/** The chunk's text, from 256 characters before it to 64 after it, matches `gate`. */
function mentions(ctx: DetectContext, gate: RegExp): boolean {
  gate.lastIndex = Math.max(0, ctx.from - 256);
  const m = gate.exec(ctx.scanText);
  return !!m && m.index < ctx.to + 64;
}

/** The matches of one frame in the chunk of `ctx`. */
function matchesOf(ctx: DetectContext, frame: RunFrame): Iterable<RegExpExecArray> {
  switch (frame.scan) {
    case "owned":
      return scanFrom(ctx, frame.pattern as RegExp, ctx.scanText, frame.frame.lookback ?? 0);
    case "text":
      return scanFrom(ctx, frame.pattern as RegExp, ctx.text, frame.frame.lookback ?? 0);
    case "polish":
      return owned(ctx, frame.pattern as RegExp);
    default:
      return frameMatches(ctx, frame.pattern, frame.owner);
  }
}

/** Every slot frame the engine runs: the frame health test compiles each and checks its cues. */
export const FRAME_SETS: (readonly RunFrame[])[] = [];

/**
 * The frames of one rule, ready to run in `style`. `fix` gives each compiled frame its fix (a
 * named fixer resolved by the caller).
 */
export function prepareFrames(
  style: FrameStyle,
  compiled: readonly CompiledFrame[],
  ruleId: CatalogRuleId,
  messageKey: ReviewMessageKey,
  fix: (frame: CompiledFrame) => unknown,
): RunFrame[] {
  const { regex, owner } = STYLES[style];
  const frames = compiled.map((frame): RunFrame => ({
    pattern: regex?.(frame) ?? frame.pattern,
    fix: fix(frame),
    ruleId: (frame.check ?? ruleId) as CatalogRuleId,
    messageKey: (frame.message ?? messageKey) as ReviewMessageKey,
    ...(frame.cue ? { cue: frame.cue } : {}),
    owner: owner ? owner(frame) : "target",
    scan: style === "match" ? (frame.scan ?? "frame") : (STYLES[style].scan ?? "frame"),
    ...(frame.gate === undefined ? {} : { gate: new RegExp(frame.gate, frame.gateFlags ?? "gi") }),
    frame,
  }));
  if (style === "slot") FRAME_SETS.push(frames);
  return frames;
}

/**
 * The findings of `frames` on the chunk of `ctx`: the one frame loop of every frame style. A frame
 * whose check is off, or whose cue words do not occur near the chunk, does not run.
 */
export function detectFrames(
  ctx: DetectContext,
  style: FrameStyle,
  frames: readonly RunFrame[],
): RawFinding[] {
  const { runs, find } = STYLES[style];
  if (!runs(ctx)) return [];
  const findings: RawFinding[] = [];
  let words: Set<string> | undefined;
  for (const frame of frames) {
    if (ctx.rules && !ctx.rules.has(frame.ruleId)) continue;
    if (frame.gate && !mentions(ctx, frame.gate)) continue;
    if (frame.cue && !FRAME_AUDIT.all) {
      words ??= wordsNear(ctx);
      if (!frame.cue.some((word) => words!.has(word))) continue;
    }
    for (const m of matchesOf(ctx, frame)) find(ctx, m, frame, findings);
  }
  return findings;
}

/**
 * Phrase templates of a hand-written detector, run as template frames: the `target` group gets
 * the replacement in its casing (an empty one only warns).
 */
export function detectPhraseTemplates(
  ctx: DetectContext,
  templates: readonly PhraseTemplate[],
  ruleId: RawFinding["ruleId"],
): RawFinding[] {
  const frames = templates.map((template): RunFrame => ({
    pattern: template.pattern,
    fix: template.replacement,
    ruleId,
    messageKey: template.messageKey,
    owner: "target",
    scan: "frame",
    frame: {
      pattern: template.pattern,
      literals: [],
      ...(template.clauseStart ? { clauseStart: true as const } : {}),
    } as CompiledFrame,
  }));
  return detectFrames(ctx, "template", frames);
}
