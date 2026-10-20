import {
  applyWordCase,
  carryCase,
  detectWordCase,
} from "../implementations/helpers/GenericRuleShared";
import { startPrefixes } from "../engine/prefixes";
import { namedExampleBefore } from "./exampleCues";
import type { DetectContext, RawFinding } from "./reviewDetectors";

// Shared English frame fragments. EDGE continues a word or a technical token.
export const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE_CHARS = "\\p{L}\\p{M}\\p{N}_'’@/#\\\\-";
export const EDGE = `[${EDGE_CHARS}]`;
export const WORD_END = `(?!${EDGE})`;
/** A token ends here: no word character after it, and no ".name" ("file.txt"). */
export const TOKEN_END = `(?!${EDGE}|\\.[\\p{L}\\p{N}])`;
// A contraction clitic starts a word after its host ("I'm", "don't"); "'s" and "'d" stay
// out: they are also possessives and past forms. No word starts after a period. One
// lookbehind tests the period and EDGE: each frame runs this at every position.
export const WORD_START = `(?:(?<![.${EDGE_CHARS}])|(?<=\\p{L})(?=(?:['’](?:m|re|ll|ve)|n['’]t)${WORD_END}))`;
/** Text before a pair of be-forms that opens a pseudo-cleft: "What it is is", "Who they are is". */
export const PSEUDO_CLEFT_BEFORE =
  /(?:^|[^\p{L}'’])(?:what|whatever|who|whoever|where|how|why)[ \t\u00a0]+\p{L}[^.!?;:\n]*$/iu;
/** The frame closes its clause: only spaces before closing punctuation or the end. */
export const COMPLETE = `${WORD_END}(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;
/** COMPLETE, where a closing parenthesis also closes the clause. */
export const COMPLETE_OR_PAREN = `${WORD_END}(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:)]|$))`;

/** True when the text language is `lang`, a two-letter code ("pt" for pt_BR). */
export const isLang = (ctx: DetectContext, lang: string) => ctx.lang.slice(0, 2) === lang;

export { wordSet } from "../implementations/helpers/GenericRuleShared";

/** Phrase rows, one per line: "typed = fix", with "; " between fixes the writer picks from. */
export const rows = (text: string): Array<[string, string | string[]]> =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(" = ");
      const fix = line.slice(at + 3);
      return [line.slice(0, at), fix.includes("; ") ? fix.split("; ") : fix];
    });

/** A regex alternation of phrases, longest first, with any run of spaces between words. */
export const alternation = (phrases: Iterable<string>) =>
  [...new Set(phrases)]
    .sort((a, b) => b.length - a.length)
    .map((phrase) => phrase.replaceAll(" ", SPACE))
    .join("|");

/** A frame regex, compiled once: WORD_START and the `gidu` flags frameMatches gives strings. */
export const frame = (pattern: string) => new RegExp(`${WORD_START}${pattern}`, "gidu");

/** Matches of a global `regex` that start in the chunk, scanned on its bounded view. */
export function* ownedMatches(ctx: DetectContext, regex: RegExp): Generator<RegExpExecArray> {
  regex.lastIndex = ctx.from;
  for (
    let match = regex.exec(ctx.scanText);
    match && match.index < ctx.to;
    match = regex.exec(ctx.scanText)
  ) {
    yield match;
  }
}

/** The [start, end) of the named group of `m`. */
export const group = (m: RegExpExecArray, name: string) => m.indices!.groups![name];

/** The `chars` characters of the text before `index`. */
export const before = (ctx: DetectContext, index: number, chars: number) =>
  ctx.text.slice(Math.max(0, index - chars), index);

/** The evidence around a frame match: 96 characters before it, 9 after it. */
export const around = (ctx: DetectContext, m: RegExpExecArray) => ({
  start: Math.max(0, m.index - 96),
  end: Math.min(ctx.text.length, m.index + m[0].length + 9),
});

/** A finding that replaces the `name` group of `m`; two or more alternatives require a choice. */
export function found(
  ctx: DetectContext,
  m: RegExpExecArray,
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
  alternatives: string[],
  name = "target",
): RawFinding {
  const [start, end] = group(m, name);
  return {
    ruleId,
    messageKey,
    range: { start, end },
    alternatives,
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    context: around(ctx, m),
  };
}

/** `replacement` in the casing of the letters of `typed`: shouted, capitalized or as written. */
export const caseLike = (typed: string, replacement: string) => carryCase(typed, replacement, true);

/** A `.name` or protected text (U+FFFC) right after a frame makes it part of a token. */
export const gluedAfter = (text: string, end: number) =>
  (text[end] === "\uFFFC" || text[end] === ".") &&
  /^\uFFFC|^\.[\p{L}\p{N}_]/u.test(text.slice(end, end + 2));

// A clause mark or the text start, then spaces or tabs. In a lookbehind, put it after
// `(?=word)`: tried at every position of a long run of spaces, it rereads the run each time
// in JavaScriptCore.
export const CLAUSE = `(?:^|[.!?,;:(\\n])[ \\t]*`;
/**
 * A lookbehind: none of the whole `words` (an alternation) right before the frame. A letter
 * comes first: off words (on long runs of spaces), the lookbehind is never tried.
 */
export const notAfter = (words: string) => `(?=\\p{L})(?<!(?<![\\p{L}'’])(?:${words})${SPACE})`;
/** The word after `end`, or "" when punctuation or the text end comes first. */
export const nextWord = (ctx: DetectContext, end: number) =>
  /^[ \t\u00a0]{1,8}(\p{L}[\p{L}'’]*)/u.exec(ctx.text.slice(end, end + 48))?.[1] ?? "";
/** The word right after `end` (spaces only between), lowercased; "" for none. */
export const nextLowerWord = (ctx: DetectContext, end: number) =>
  /^[ \t\u00a0]{1,8}([A-Za-z]+)(?![\p{L}\p{N}_'’@/#\\-])/u
    .exec(ctx.scanText.slice(end, end + 40))?.[1]
    ?.toLowerCase() ?? "";

/** A verb token that is plain text: lowercase or all caps, not a user-dictionary word. */
export const plainToken = (ctx: DetectContext, token: string) =>
  (token === token.toLowerCase() || token === token.toUpperCase()) &&
  !ctx.dictionary.has(token.toLowerCase());

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
/** Test hook: frames run without the literal prefilter and cue words, so each one compiles. */
export const FRAME_AUDIT = { all: false };
// The chunk contexts in which a frame pattern did not compile.
const BROKEN_SCANS = new WeakSet<DetectContext>();
/** True when a frame did not compile since the last call: the caller reports its rules. */
export const takeFrameFailure = (ctx: DetectContext) => BROKEN_SCANS.delete(ctx);
// A RegExp builds its source again at each read; a frame reads it one time.
const READ_PATTERNS = new WeakMap<RegExp, string | null>();
// A regex mid-scan in an unfinished generator; a nested scan of it gets its own copy.
const SCANNING = new WeakSet<RegExp>();
// The sticky copy of a frame regex: it runs only at the frame's start positions.
const STICKY = new WeakMap<RegExp, RegExp>();
// The start prefixes of a frame source (null: a match may start anywhere).
const PREFIXES = new Map<string, readonly string[] | null>();
// A prefix holds only characters whose case-insensitive matches String#toLowerCase mirrors:
// printable ASCII and the LITERAL_LETTER ranges. It ends before any other character.
const PREFIX_CHAR =
  /[ -~\u00c0-\u00d6\u00d8-\u00de\u00e0-\u00f6\u00f8-\u012f\u0132-\u017e\u0180-\u024f]/;

function framePrefixes(source: string): readonly string[] | null {
  let found = PREFIXES.get(source);
  if (found === undefined) {
    const raw = startPrefixes(source);
    const safe = raw?.map((prefix) => {
      let end = 0;
      while (end < prefix.length && PREFIX_CHAR.test(prefix[end])) end++;
      return prefix.slice(0, end);
    });
    found = !safe || safe.includes("") ? null : [...new Set(safe)];
    PREFIXES.set(source, found);
  }
  return found;
}

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
/** Gives the literals of a frame compiled ahead of time (grammar/rules/*.yaml). */
export const primeFrameLiterals = (source: string, literals: string[]) =>
  LITERALS.set(source, literals);
// The text a frame scan can match in, lowercased; null when the text holds a character whose
// case-insensitive match is another letter than its lowercase (U+017F long s ~ s, U+212A
// Kelvin sign ~ k, U+212B Angstrom sign, capital sharp s).
const SCANNED = new WeakMap<
  DetectContext,
  {
    lower: string | null;
    grams: Uint8Array;
    found: Map<string, boolean>;
    aligned: boolean;
    starts: Map<string, number[]>;
  }
>();
// A three-letter run as a hash: no substring is made. Two runs can share a hash, so a hit
// is only a hint and the text search decides.
const gram = (text: string, at: number) =>
  (text.charCodeAt(at) * 961 + text.charCodeAt(at + 1) * 31 + text.charCodeAt(at + 2)) & 0x3fff;

/**
 * False when a frame cannot match in this chunk's scan: the text from from-256 (where
 * scans start), lowercased, holds none of the literals of which every match consumes one. Such a frame is neither compiled nor run, which spares most frames on most text.
 */
function scannedText(ctx: DetectContext) {
  let scanned = SCANNED.get(ctx);
  if (scanned === undefined) {
    const raw = ctx.scanText.slice(Math.max(0, ctx.from - 256));
    const lower = /[\u017f\u212a\u212b\u1e9e]/.test(raw) ? null : raw.toLowerCase();
    // Its three-letter runs: most literals fail there, before a search of the whole text.
    const grams = new Uint8Array(0x4000);
    for (let i = 0; lower !== null && i + 3 <= lower.length; i++) grams[gram(lower, i)] = 1;
    SCANNED.set(
      ctx,
      (scanned = {
        lower,
        grams,
        found: new Map(),
        // Positions line up with the text only when lowercasing kept every length.
        aligned: lower !== null && lower.length === raw.length,
        starts: new Map(),
      }),
    );
  }
  return scanned;
}

/** The positions in [from - 256, to) where `prefix` stands (lowercased). */
function prefixStarts(ctx: DetectContext, prefix: string): number[] {
  const scanned = scannedText(ctx);
  let starts = scanned.starts.get(prefix);
  if (starts === undefined) {
    starts = [];
    const base = Math.max(0, ctx.from - 256);
    const limit = ctx.to - base;
    for (let i = scanned.lower!.indexOf(prefix); i !== -1 && i < limit;) {
      starts.push(base + i);
      i = scanned.lower!.indexOf(prefix, i + 1);
    }
    scanned.starts.set(prefix, starts);
  }
  return starts;
}

/** Where a match of a frame may start in the chunk's scan, ascending; null: anywhere. */
function frameStarts(ctx: DetectContext, source: string | null): readonly number[] | null {
  if (source === null) return null;
  const prefixes = framePrefixes(source);
  if (prefixes === null || !scannedText(ctx).aligned) return null;
  if (prefixes.length === 1) return prefixStarts(ctx, prefixes[0]);
  // No prefix starts another one, so two prefixes never stand at one position.
  return prefixes.flatMap((prefix) => prefixStarts(ctx, prefix)).sort((a, b) => a - b);
}

function mayMatch(ctx: DetectContext, source: string): boolean {
  let literals = LITERALS.get(source);
  if (literals === undefined) LITERALS.set(source, (literals = requiredLiterals(source)));
  if (literals.length === 0) return true;
  const { lower, grams, found } = scannedText(ctx);
  if (lower === null) return true;
  for (const literal of literals) {
    // Most literals fail at the hashes, before the memo or a text search.
    if (grams[gram(literal, 0)] === 0 || grams[gram(literal, literal.length - 3)] === 0) continue;
    let has = found.get(literal);
    if (has === undefined) found.set(literal, (has = lower.includes(literal)));
    if (has) return true;
  }
  return false;
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
  let source: string | null;
  if (typeof pattern === "string") {
    source = pattern;
    if (!FRAME_AUDIT.all && !mayMatch(ctx, pattern)) return;
    let compiled = COMPILED.get(pattern);
    if (!compiled) {
      // A broken frame skips only itself: the other frames of its detector still run.
      try {
        compiled = frame(pattern);
      } catch {
        BROKEN_SCANS.add(ctx);
        return;
      }
      COMPILED.set(pattern, compiled);
    }
    regex = compiled;
  } else {
    let read = READ_PATTERNS.get(pattern);
    if (read === undefined) {
      read = pattern.flags.includes("v") ? null : pattern.source;
      READ_PATTERNS.set(pattern, read);
    }
    if (read !== null && !FRAME_AUDIT.all && !mayMatch(ctx, read)) return;
    regex = pattern;
    source = read;
  }
  const starts = frameStarts(ctx, source);
  if (starts !== null) {
    yield* stickyMatches(ctx, regex, starts, owner);
    return;
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
/**
 * The matches frameMatches gives, read only at `starts`: the sticky copy of `regex` runs at
 * each start after the last match, in order. A global scan finds the leftmost match after
 * its last one; when every match starts at one of `starts`, both give the same matches.
 */
function* stickyMatches(
  ctx: DetectContext,
  regex: RegExp,
  starts: readonly number[],
  owner: string | ((match: RegExpExecArray) => number) | null,
): Generator<RegExpExecArray> {
  let sticky = STICKY.get(regex);
  if (!sticky) STICKY.set(regex, (sticky = new RegExp(regex.source, `${regex.flags}y`)));
  let next = Math.max(0, ctx.from - 256);
  for (const at of starts) {
    if (at < next) continue;
    sticky.lastIndex = at;
    const m = sticky.exec(ctx.scanText);
    if (!m) continue;
    next = m.index + m[0].length;
    let start: number;
    if (owner === null) start = ctx.from;
    else if (typeof owner === "string") {
      const [ownerStart, ownerEnd] = m.indices!.groups![owner];
      // As in frameMatches: resume right after the owner.
      if (ownerEnd < next) next = Math.max(m.index + 1, ownerEnd);
      start = ownerStart;
    } else start = owner(m);
    if (start < ctx.from || start >= ctx.to) continue;
    if (gluedAfter(ctx.text, m.index + m[0].length)) continue;
    if (namedExampleBefore(ctx.text, m.index)) continue;
    yield m;
  }
}

export type PhraseTemplate = {
  pattern: string;
  replacement: string;
  messageKey: RawFinding["messageKey"];
  clauseStart?: true;
};

/**
 * The text start, closing punctuation or a blank line before `index`; a soft line wrap is not.
 * An opening quote or parenthesis also opens a sentence after a line break.
 */
export function opensSentence(text: string, index: number): boolean {
  let before = text.slice(Math.max(0, index - 96), index);
  const opened = /["“‘„«(]$/.test(before);
  if (opened) before = before.slice(0, -1);
  return (
    (index <= 96 && /^[ \t\u00a0]*$/.test(before)) ||
    /(?:[.!?;:][ \t\r\n\u00a0]{0,8}|\n\r?\n[ \t\u00a0]{0,8})$/.test(before) ||
    (opened && /\n[ \t\u00a0]{0,8}$/.test(before))
  );
}
