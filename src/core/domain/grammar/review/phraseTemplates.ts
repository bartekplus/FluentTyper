import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { namedExampleBefore } from "./exampleCues";
import type { CatalogRuleId } from "../ruleCatalog";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "./reviewDetectors";

// Shared English frame fragments. EDGE continues a word or a technical token.
export const SPACE = "[ \\t\\u00a0]{1,8}";
export const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
export const WORD_START = `(?<![.])(?<!${EDGE})`;
export const WORD_END = `(?!${EDGE})`;
/** A token ends here: no word character after it, and no ".name" ("file.txt"). */
export const TOKEN_END = `(?!${EDGE}|\\.[\\p{L}\\p{N}])`;
/** The frame closes its clause: only spaces before closing punctuation or the end. */
export const COMPLETE = `${WORD_END}(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`;
/** COMPLETE, where a closing parenthesis also closes the clause. */
export const COMPLETE_OR_PAREN = `${WORD_END}(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:)]|$))`;

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

/** `replacement` in the casing of `typed`: shouted, capitalized or as written. */
export function caseLike(typed: string, replacement: string): string {
  const letters = typed.replace(/\P{L}/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return replacement.toUpperCase();
  if (/^\P{L}*\p{Lu}/u.test(typed))
    return replacement.replace(/\p{L}/u, (letter) => letter.toUpperCase());
  return replacement;
}

/** A `.name` or protected text (U+FFFC) right after a frame makes it part of a token. */
export const gluedAfter = (text: string, end: number) =>
  /^\uFFFC|^\.[\p{L}\p{N}_]/u.test(text.slice(end, end + 2));

// A clause mark or the text start, then spaces or tabs. In a lookbehind, put it after
// `(?=word)`: tried at every position of a long run of spaces, it rereads the run each time
// in JavaScriptCore.
export const CLAUSE = `(?:^|[.!?,;:(\\n])[ \\t]*`;
/** A lookbehind: none of the whole `words` (an alternation) right before the frame. */
export const notAfter = (words: string) => `(?<!(?<![\\p{L}'’])(?:${words})${SPACE})`;
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

// String patterns come from static rule tables, so the cache stays bounded.
const COMPILED = new Map<string, RegExp>();
// A regex mid-scan in an unfinished generator; a nested scan of it gets its own copy.
const SCANNING = new WeakSet<RegExp>();

// An escape after its backslash: \p{L}, \u{…}, \k<name>, \u00a0, \x2d, \cJ or one character.
const ESCAPE = /^(?:[pPu]\{[^}]*\}|k<[^>]*>|u[\dA-Fa-f]{4}|x[\dA-Fa-f]{2}|c[A-Za-z]|.)/su;
/**
 * The longest run of plain letters every match of `source` consumes: runs outside
 * character classes and escapes, inside no lookaround, alternation or optional part.
 * "" when there is none (a top-level alternation, say).
 */
export function requiredLiteral(source: string): string {
  // Each open group collects its required runs; closing passes them to the parent.
  const groups: { runs: string[]; alternation: boolean; lookaround: boolean }[] = [
    { runs: [], alternation: false, lookaround: false },
  ];
  let run = "";
  const endRun = () => {
    if (run) groups.at(-1)!.runs.push(run);
    run = "";
  };
  const optionalAt = (i: number) => /^(?:[?*]|\{0[,}])/.test(source.slice(i, i + 3));
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (/[A-Za-z]/.test(char)) {
      if (optionalAt(i + 1)) endRun();
      else run += char;
      continue;
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
      groups.push({ runs: [], alternation: false, lookaround });
    } else if (char === ")") {
      const group = groups.pop()!;
      if (!group.lookaround && !group.alternation && !optionalAt(i + 1))
        groups.at(-1)!.runs.push(...group.runs);
    } else if (char === "|") groups.at(-1)!.alternation = true;
  }
  endRun();
  const [top] = groups;
  return top.alternation ? "" : top.runs.reduce((a, b) => (b.length > a.length ? b : a), "");
}
const LITERALS = new Map<string, string>();
// The lowercased text a frame scan can match in, or null when it holds a character whose
// case-insensitive match is a different ASCII letter (U+017F long s ~ s, U+212A Kelvin sign ~ k).
const SCANNED = new WeakMap<DetectContext, string | null>();

/**
 * False when a case-insensitive frame cannot match in this chunk's scan: the text from
 * from-256 (where scans start) lacks a literal every match consumes. Such a frame is
 * neither compiled nor run, which spares most idiom frames on most text.
 */
function mayMatch(ctx: DetectContext, source: string): boolean {
  let literal = LITERALS.get(source);
  if (literal === undefined)
    LITERALS.set(source, (literal = requiredLiteral(source).toLowerCase()));
  if (literal.length < 3) return true;
  let scanned = SCANNED.get(ctx);
  if (scanned === undefined) {
    const text = ctx.scanText.slice(Math.max(0, ctx.from - 256));
    scanned = /[\u017f\u212a]/.test(text) ? null : text.toLowerCase();
    SCANNED.set(ctx, scanned);
  }
  return scanned === null || scanned.includes(literal);
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
  } else if (pattern.flags.includes("i") && !mayMatch(ctx, pattern.source)) return;
  else regex = pattern;
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
      const before = ctx.scanText.slice(Math.max(0, match.index - 96), match.index);
      if (
        clauseStart &&
        !(match.index <= 96 && /^[ \t\u00a0]*$/.test(before)) &&
        !/(?:[.!?;:][ \t\r\n\u00a0]{0,8}|\n\r?\n[ \t\u00a0]{0,8})$/.test(before)
      )
        continue;
      // "TypeScript" is the one mixed-case word a template names itself.
      if (hasUserOrCasedWord(ctx, match[0].replace(/\bTypeScript\b/g, ""))) continue;
      findings.push(
        found(ctx, match, ruleId, messageKey, [
          replacement ? applyWordCase(replacement, detectWordCase(match.groups!.target)) : "",
        ]),
      );
    }
  }
  return findings;
}

export type FrameRule = Extract<
  CatalogRuleId,
  | "englishPhraseCorrections"
  | "englishClosedCompounds"
  | "englishContextualCompounds"
  | "englishCountability"
  | "englishSubjectVerbAgreement"
  | "englishAuxiliaryBaseVerb"
  | "englishVerbComplements"
  | "englishItsContext"
  | "stylePhrasing"
  | "styleRedundancy"
>;
const FRAME_MESSAGES: Record<FrameRule, RawFinding["messageKey"]> = {
  englishPhraseCorrections: "review_msg_phrase_correction",
  englishClosedCompounds: "review_msg_closed_compound",
  englishContextualCompounds: "review_msg_closed_compound",
  englishCountability: "review_msg_mass_noun",
  englishSubjectVerbAgreement: "review_msg_pronoun_verb",
  englishAuxiliaryBaseVerb: "review_msg_auxiliary_base",
  englishVerbComplements: "review_msg_missing_to",
  englishItsContext: "review_msg_its_contraction",
  stylePhrasing: "review_msg_style_phrasing",
  styleRedundancy: "review_msg_style_redundancy",
};
/** A frame's `target` group is replaced; `fix` may veto (null) after a closer look. */
export type Frame = {
  pattern: string;
  fix: string | readonly string[] | ((m: RegExpExecArray) => string | readonly string[] | null);
  /** The fix already carries the typed casing. */
  raw?: true;
};

/** Context frames on English text: forms that are also ordinary English elsewhere. */
function detectFrames(ctx: DetectContext, rule: FrameRule, frames: readonly Frame[]): RawFinding[] {
  if (!ctx.lang.startsWith("en")) return [];
  const findings: RawFinding[] = [];
  for (const { pattern, fix, raw } of frames) {
    for (const m of frameMatches(ctx, pattern)) {
      const [start, end] = m.indices!.groups!.target;
      if (hasUserOrCasedWord(ctx, ctx.text.slice(m.index, Math.max(end, m.index + m[0].length))))
        continue;
      const value = typeof fix === "function" ? fix(m) : fix;
      if (value === null) continue;
      const style = detectWordCase(m.groups!.target.trim());
      const alternatives = [value].flat().map((alt) => (raw ? alt : applyWordCase(alt, style)));
      findings.push({
        ruleId: rule,
        messageKey: FRAME_MESSAGES[rule],
        range: { start, end },
        alternatives,
        ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
        context: {
          start: Math.max(0, m.index - 40),
          end: Math.min(ctx.text.length, m.index + m[0].length + 20),
        },
      });
    }
  }
  return findings;
}

/** One context detector per rule of `frames`. */
export const frameDetectors = (
  frames: Partial<Record<FrameRule, readonly Frame[]>>,
): ReviewDetectorEntry[] =>
  (Object.entries(frames) as [FrameRule, readonly Frame[]][]).map(([rule, ruleFrames]) => ({
    rules: [rule],
    detect: (ctx) => detectFrames(ctx, rule, ruleFrames),
  }));
