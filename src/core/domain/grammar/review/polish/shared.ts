import { namedExampleBefore } from "../exampleCues";
import { frameMatches } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";

/** Spaces between two words of a frame. */
export const S = "[ \\t\\u00a0]{1,8}";
/** No letter, digit or word glue continues the word. */
export const END = "(?![\\p{L}\\p{M}\\p{N}_'’@/#\\\\-])";
/** No letter before: the frame starts a word. */
export const START = "(?<![\\p{L}\\p{M}\\p{N}_'’@/#\\\\.-])";
/** A clause or text starts here: the text start, or sentence punctuation and spaces. */
export const CLAUSE_START = '(?<=(?:^|[.!?…:;]["”’»)]*[ \\t\\u00a0\\n]{1,8}|\\n[ \\t\\u00a0]*))';
/** The prepositions after which a word must be a noun phrase. */
export const PREPOSITIONS =
  "w|we|z|ze|na|do|od|ode|po|za|przy|przed|przede|nad|nade|pod|pode|dla|bez|u|ku|przez|przeze|między|o|wśród|spod|znad|zza|sprzed";

export const isPl = (ctx: DetectContext) => ctx.lang.slice(0, 2) === "pl";

/** `replacement` in the casing of `typed`: shouted, capitalized or as written. */
export function caseLike(typed: string, replacement: string): string {
  const letters = typed.replace(/\P{L}/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return replacement.toUpperCase();
  return /^\P{L}*\p{Lu}/u.test(typed)
    ? replacement.replace(/\p{L}/u, (letter) => letter.toUpperCase())
    : replacement;
}

/** A word the user added, or mixed casing that names something ("McDonald"). */
export function userOrNamed(ctx: DetectContext, typed: string): boolean {
  return (typed.match(/\p{L}+/gu) ?? []).some(
    (word) =>
      ctx.dictionary.has(word.toLowerCase()) ||
      (/\p{Lu}/u.test(word.slice(1)) && word !== word.toUpperCase()),
  );
}

export type Fix =
  string | readonly string[] | ((m: RegExpExecArray) => string | readonly string[] | null);

/** A guarded frame: the regex carries its own context; `target` is what is replaced. */
export interface Frame {
  pattern: string;
  fix: Fix;
  ruleId: RawFinding["ruleId"];
  messageKey: RawFinding["messageKey"];
  /** Keep the typed casing off: the fix decides it (names, abbreviations). */
  verbatim?: true;
}

export function findingAt(
  ctx: DetectContext,
  start: number,
  end: number,
  alternatives: readonly string[],
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
): RawFinding {
  return {
    ruleId,
    messageKey,
    range: { start, end },
    alternatives: [...alternatives],
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    context: {
      start: Math.max(0, start - 96),
      end: Math.min(ctx.text.length, end + 32),
    },
  };
}

/** Runs guarded frames; a match yields the fix of its `target` group. */
export function runFrames(ctx: DetectContext, frames: readonly Frame[]): RawFinding[] {
  if (!isPl(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const { pattern, fix, ruleId, messageKey, verbatim } of frames) {
    if (ctx.rules && !ctx.rules.has(ruleId)) continue;
    for (const m of frameMatches(ctx, pattern)) {
      const [start, end] = m.indices!.groups!.target;
      const typed = ctx.source.slice(start, end);
      if (userOrNamed(ctx, typed)) continue;
      const fixed = typeof fix === "function" ? fix(m) : fix;
      if (fixed === null) continue;
      const alternatives = [fixed]
        .flat()
        .map((alt) => (verbatim ? alt : caseLike(typed, alt)))
        .filter((alt) => alt !== typed);
      if (alternatives.length === 0) continue;
      findings.push(findingAt(ctx, start, end, alternatives, ruleId, messageKey));
    }
  }
  return findings;
}

/** Owned regex matches of a hand-written scan (not a frame), with the example guard. */
export function* owned(ctx: DetectContext, regex: RegExp): Generator<RegExpExecArray> {
  regex.lastIndex = Math.max(0, ctx.from - 64);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (m.index < ctx.from) continue;
    if (namedExampleBefore(ctx.text, m.index)) continue;
    yield m;
  }
}

/** The adjective endings of a masculine lemma in -y/-i, every case and gender. */
const ADJ_ENDINGS = ["y", "a", "e", "ego", "ej", "emu", "ą", "ym", "ych", "ymi"];
const ADJ_ENDINGS_I = ["i", "a", "e", "ego", "ej", "emu", "ą", "im", "ich", "imi"];

/**
 * Rows for every form of an adjective written apart: `adjectiveRows("krótko trwał", "krótkotrwał")`.
 * Stems end before the case ending; `soft` stems take -i (-ki, -gi, -ni).
 */
export function adjectiveRows(
  typedStem: string,
  fixedStem: string,
  soft = /[kg]$/.test(typedStem),
): Array<[string, string]> {
  return (soft ? ADJ_ENDINGS_I : ADJ_ENDINGS).map((ending) => [
    typedStem + ending,
    fixedStem + ending,
  ]);
}
