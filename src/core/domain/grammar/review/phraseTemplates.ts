import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { namedExampleBefore } from "./exampleCues";
import type { DetectContext, RawFinding } from "./reviewDetectors";

// Shared English frame fragments. EDGE continues a word or a technical token.
export const SPACE = "[ \\t\\u00a0]{1,8}";
export const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
export const WORD_START = `(?<![.])(?<!${EDGE})`;
export const WORD_END = `(?!${EDGE})`;
/** The frame closes its clause: only spaces before closing punctuation or the end. */
export const COMPLETE = `${WORD_END}(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;

/** A frame regex, compiled once: WORD_START and the `gidu` flags frameMatches gives strings. */
export const frame = (pattern: string) => new RegExp(`${WORD_START}${pattern}`, "gidu");

/** A `.name` or protected text (U+FFFC) right after a frame makes it part of a token. */
export const gluedAfter = (text: string, end: number) =>
  /^\uFFFC|^\.[\p{L}\p{N}_]/u.test(text.slice(end, end + 2));

/** A user-dictionary word, or casing that names something ("iOS", "DON't"): the frame abstains. */
export function hasUserOrCasedWord(ctx: DetectContext, text: string): boolean {
  return (text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? []).some(
    (word) =>
      [word, ...word.split(/['’]/)].some((part) => ctx.dictionary.has(part.toLowerCase())) ||
      applyWordCase(word, detectWordCase(word)) !== word,
  );
}

// String patterns come from static rule tables, so the cache stays bounded.
const COMPILED = new Map<string, RegExp>();
// A regex mid-scan in an unfinished generator; a nested scan of it gets its own copy.
const SCANNING = new WeakSet<RegExp>();

/**
 * One English frame scan. A string pattern gets WORD_START and the `gidu` flags.
 * Scanning starts 256 characters before the chunk, so a frame that began in the
 * previous chunk consumes its text there too; only frames whose `owner` group
 * (or computed start) lies in [from, to) are yielded, every frame for `null`.
 * Frames glued to a token after them or inside a named example abstain.
 * Reads from-384 (the example guard's 128 behind a match) through scanText:
 * changes must also audit NativeReviewCache's read contract.
 */
export function* frameMatches(
  ctx: DetectContext,
  pattern: string | RegExp,
  owner: string | ((match: RegExpExecArray) => number) | null = "target",
): Generator<RegExpExecArray> {
  let regex: RegExp;
  if (typeof pattern === "string") {
    regex = COMPILED.get(pattern) ?? frame(pattern);
    COMPILED.set(pattern, regex);
  } else regex = pattern;
  if (SCANNING.has(regex)) regex = new RegExp(regex);
  SCANNING.add(regex);
  try {
    regex.lastIndex = Math.max(0, ctx.from - 256);
    for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
      const start =
        owner === null
          ? ctx.from
          : typeof owner === "string"
            ? m.indices!.groups![owner][0]
            : owner(m);
      if (start < ctx.from || start >= ctx.to) continue;
      if (gluedAfter(ctx.text, m.index + m[0].length) || namedExampleBefore(ctx.text, m.index))
        continue;
      yield m;
    }
  } finally {
    SCANNING.delete(regex);
  }
}
export type PhraseTemplate = {
  pattern: string;
  replacement: string;
  messageKey: RawFinding["messageKey"];
  clauseStart?: true;
};

/**
 * Shared bounded phrase matching; templates provide explicit grammatical context.
 * Changes to reads/pattern bounds must also audit NativeReviewCache's read contract.
 */
export function detectPhraseTemplates(
  ctx: DetectContext,
  templates: readonly PhraseTemplate[],
  ruleId: RawFinding["ruleId"],
): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { pattern, replacement, messageKey, clauseStart } of templates) {
    for (const match of frameMatches(ctx, pattern)) {
      const [start, end] = match.indices!.groups!.target;
      const before = ctx.scanText.slice(Math.max(0, match.index - 96), match.index);
      if (
        clauseStart &&
        !(match.index <= 96 && /^[ \t\u00a0]*$/.test(before)) &&
        !/(?:[.!?;:][ \t\r\n\u00a0]{0,8}|\n\r?\n[ \t\u00a0]{0,8})$/.test(before)
      )
        continue;
      // "TypeScript" is the one mixed-case word a template names itself.
      if (hasUserOrCasedWord(ctx, match[0].replace(/\bTypeScript\b/g, ""))) continue;
      findings.push({
        ruleId,
        messageKey,
        range: { start, end },
        alternatives: [
          replacement ? applyWordCase(replacement, detectWordCase(match.groups!.target)) : "",
        ],
        context: {
          start: Math.max(0, match.index - 96),
          end: Math.min(ctx.text.length, match.index + match[0].length + 9),
        },
      });
    }
  }
  return findings;
}
