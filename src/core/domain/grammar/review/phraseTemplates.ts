import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { namedExampleBefore } from "./exampleCues";
import type { DetectContext, RawFinding } from "./reviewDetectors";

// Shared English frame fragments. EDGE continues a word or a technical token.
export const SPACE = "[ \\t\\u00a0]{1,8}";
export const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
export const WORD_END = `(?!${EDGE})`;
// A contraction clitic starts a word after its host ("I'm", "don't"); "'s" and "'d" stay
// out: they are also possessives and past forms.
export const WORD_START = `(?<![.])(?:(?<!${EDGE})|(?<=\\p{L})(?=(?:['’](?:m|re|ll|ve)|n['’]t)${WORD_END}))`;
/** Text before a pair of be-forms that opens a pseudo-cleft: "What it is is", "Who they are is". */
export const PSEUDO_CLEFT_BEFORE =
  /(?:^|[^\p{L}'’])(?:what|whatever|who|whoever|where|how|why)[ \t\u00a0]+\p{L}[^.!?;:\n]*$/iu;
/** The frame closes its clause: only spaces before closing punctuation or the end. */
export const COMPLETE = `${WORD_END}(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;

/** True when the text language is `lang`, a two-letter code ("pt" for pt_BR). */
export const isLang = (ctx: DetectContext, lang: string) => ctx.lang.slice(0, 2) === lang;

/** The space-separated words of `list` as a set. */
export const wordSet = (list: string) => new Set(list.split(" "));

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

/** Thrown by detectAll when a part failed: the scan keeps the other parts' findings. */
export class PartialDetection extends Error {
  constructor(
    readonly findings: RawFinding[],
    cause: unknown,
  ) {
    super("A detector part failed", { cause });
  }
}

/** Runs every part; one part throwing loses only its own findings, and the entry still fails. */
export function detectAll<F extends RawFinding>(
  ctx: DetectContext,
  parts: readonly ((ctx: DetectContext) => F[])[],
): F[] {
  const findings: F[] = [];
  let failed: { cause: unknown } | undefined;
  for (const detect of parts) {
    try {
      findings.push(...detect(ctx));
    } catch (cause) {
      if (cause instanceof PartialDetection) findings.push(...(cause.findings as F[]));
      failed ??= { cause };
    }
  }
  if (failed) throw new PartialDetection(findings, failed.cause);
  return findings;
}

// String patterns come from static rule tables, so the cache stays bounded.
const COMPILED = new Map<string, RegExp>();
// A RegExp builds its source again at each read; a frame reads it one time.
const READ_PATTERNS = new WeakMap<RegExp, string | null>();
// A regex mid-scan in an unfinished generator; a nested scan of it gets its own copy.
const SCANNING = new WeakSet<RegExp>();

// An escape after its backslash: \p{L}, \u{…}, \k<name>, \u00a0, \x2d, \cJ or one character.
const ESCAPE = /^(?:[pPu]\{[^}]*\}|k<[^>]*>|u[\dA-Fa-f]{4}|x[\dA-Fa-f]{2}|c[A-Za-z]|.)/su;
// Letters a literal may hold: ASCII and Latin-1/Extended-A/B, whose case-insensitive matches
// String#toLowerCase mirrors. Not sharp s, dotted or dotless i or long s: they fold otherwise.
const LITERAL_LETTER =
  /[A-Za-z\u00c0-\u00d6\u00d8-\u00de\u00e0-\u00f6\u00f8-\u012f\u0132-\u017e\u0180-\u024f]/;

/** The best of several requirements: the one whose shortest literal is longest. */
const best = (sets: readonly string[][]) =>
  sets.reduce<string[]>((a, b) => (shortest(b) > shortest(a) ? b : a), []);
const shortest = (set: readonly string[]) =>
  set.length ? Math.min(...set.map((literal) => literal.length)) : 0;

/**
 * Lowercase literals of which every match of `source` consumes at least one: runs of plain
 * letters outside escapes, lookarounds and optional parts, where a class of one letter in both
 * cases ("[sS]") counts as that letter, and an alternation contributes one literal for each
 * branch. Empty when some branch has no literal of 3 letters or more.
 */
export function requiredLiterals(source: string): string[] {
  // Each open group collects its required sets; "|" closes a branch into `branches`.
  type Group = { sets: string[][]; branches: string[][] | null; lookaround: boolean };
  const groups: Group[] = [{ sets: [], branches: null, lookaround: false }];
  let run = "";
  const endRun = () => {
    if (run) groups.at(-1)!.sets.push([run]);
    run = "";
  };
  const closeBranch = (group: Group) => {
    const required = best(group.sets);
    group.branches?.push(shortest(required) >= 3 ? required : []);
    group.sets = [];
  };
  // A group's requirement: its one branch's sets, or one literal set across its branches.
  const required = (group: Group): string[][] => {
    if (!group.branches) return group.sets;
    closeBranch(group);
    return group.branches.every((b) => b.length) ? [group.branches.flat()] : [];
  };
  const optionalAt = (i: number) => /^(?:[?*]|\{0[,}])/.test(source.slice(i, i + 3));
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (LITERAL_LETTER.test(char)) {
      if (optionalAt(i + 1)) endRun();
      else run += char.toLowerCase();
      continue;
    }
    if (char === "[") {
      const close = source.indexOf("]", i);
      const pair = source.slice(i + 1, close);
      const letter =
        pair.length === 2 &&
        LITERAL_LETTER.test(pair[0]) &&
        pair[0] !== pair[1] &&
        pair[0].toLowerCase() === pair[1].toLowerCase();
      if (letter && !optionalAt(close + 1)) {
        run += pair[0].toLowerCase();
        i = close;
        continue;
      }
    }
    endRun();
    if (char === "\\") {
      i += ESCAPE.exec(source.slice(i + 1))![0].length;
    } else if (char === "[") {
      for (i++; i < source.length && source[i] !== "]"; i++) if (source[i] === "\\") i++;
    } else if (char === "(") {
      const lookaround = /^\(\?<?[=!]/.test(source.slice(i, i + 4));
      if (source.startsWith("(?", i))
        i = lookaround || source[i + 2] === ":" ? i + 2 : source.indexOf(">", i);
      groups.push({ sets: [], branches: null, lookaround });
    } else if (char === ")") {
      const group = groups.pop()!;
      if (!group.lookaround && !optionalAt(i + 1)) groups.at(-1)!.sets.push(...required(group));
    } else if (char === "|") {
      const group = groups.at(-1)!;
      group.branches ??= [];
      closeBranch(group);
    }
  }
  endRun();
  const top = best(required(groups[0]));
  return shortest(top) >= 3 ? top : [];
}
const LITERALS = new Map<string, string[]>();
// The text a frame scan can match in, lowercased; null when the text holds a character whose
// case-insensitive match is another letter than its lowercase (U+017F long s ~ s, U+212A
// Kelvin sign ~ k, U+212B Angstrom sign, capital sharp s).
const SCANNED = new WeakMap<
  DetectContext,
  { lower: string | null; grams: Set<string>; found: Map<string, boolean> }
>();

/**
 * False when a frame cannot match in this chunk's scan: the text from from-256 (where
 * scans start), lowercased, holds none of the literals of which every match consumes one. Such a frame is neither compiled nor run, which spares most frames on most text.
 */
function mayMatch(ctx: DetectContext, source: string): boolean {
  let literals = LITERALS.get(source);
  if (literals === undefined) LITERALS.set(source, (literals = requiredLiterals(source)));
  if (literals.length === 0) return true;
  let scanned = SCANNED.get(ctx);
  if (scanned === undefined) {
    const raw = ctx.scanText.slice(Math.max(0, ctx.from - 256));
    const lower = /[\u017f\u212a\u212b\u1e9e]/.test(raw) ? null : raw.toLowerCase();
    // Its three-letter runs: most literals fail there, before a search of the whole text.
    const grams = new Set<string>();
    for (let i = 0; lower !== null && i + 3 <= lower.length; i++) grams.add(lower.slice(i, i + 3));
    SCANNED.set(ctx, (scanned = { lower, grams, found: new Map() }));
  }
  const { lower, grams, found } = scanned;
  if (lower === null) return true;
  return literals.some((literal) => {
    let has = found.get(literal);
    if (has === undefined) {
      has =
        grams.has(literal.slice(0, 3)) && grams.has(literal.slice(-3)) && lower.includes(literal);
      found.set(literal, has);
    }
    return has;
  });
}

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
    if (!mayMatch(ctx, pattern)) return;
    regex = COMPILED.get(pattern) ?? frame(pattern);
    COMPILED.set(pattern, regex);
  } else {
    let read = READ_PATTERNS.get(pattern);
    if (read === undefined) {
      read = pattern.flags.includes("v") ? null : pattern.source;
      READ_PATTERNS.set(pattern, read);
    }
    if (read !== null && !mayMatch(ctx, read)) return;
    regex = pattern;
  }
  if (SCANNING.has(regex)) regex = new RegExp(regex);
  SCANNING.add(regex);
  try {
    regex.lastIndex = Math.max(0, ctx.from - 256);
    for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
      let start: number;
      if (owner === null) start = ctx.from;
      else if (typeof owner === "string") {
        const [ownerStart, ownerEnd] = m.indices!.groups![owner];
        // Trailing context after the owner may open the next frame ("a cats is"):
        // resume right after the owner rather than after the whole match.
        if (ownerEnd < m.index + m[0].length) regex.lastIndex = Math.max(m.index + 1, ownerEnd);
        start = ownerStart;
      } else start = owner(m);
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
