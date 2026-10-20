import { namedExampleBefore, OPENING_QUOTES } from "../exampleCues";
import { isLang } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { finding } from "../finding";
import { carryCase } from "../../implementations/helpers/GenericRuleShared";

/** Spaces between two words of a frame; no letter, digit or word glue continues the word. */
export { SPACE as S, WORD_END as END } from "../phraseTemplates";
/** No letter before: the frame starts a word. */
export const START = "(?<![\\p{L}\\p{M}\\p{N}_'’@/#\\\\.-])";
/**
 * A word starts a clause or the text here: the text start, or sentence punctuation and spaces.
 * The letter test comes first, so most positions never read back.
 */
export const CLAUSE_START =
  '(?=\\p{L})(?<=(?:^|[.!?…:;]["”’»)]{0,3}[ \\t\\u00a0\\n]{1,8}|\\n[ \\t\\u00a0]{0,8}))';
/** The prepositions after which a word must be a noun phrase. */
export const PREPOSITIONS =
  "w|we|z|ze|na|do|od|ode|po|za|przy|przed|przede|nad|nade|pod|pode|dla|bez|u|ku|przez|przeze|między|o|wśród|spod|znad|zza|sprzed";

export const isPl = (ctx: DetectContext) => isLang(ctx, "pl");

/**
 * Polish abbreviations mistyped with a slash ("d/s", "w/w", "w/g"), "i/lub", and dotted ones
 * with a wrong letter or dot ("m.im", "M.in", "d.s", "p.n.e", "dz.cyt"): prose, not a path or
 * a dotted name. The token is read without its trailing marks.
 */
export const POLISH_PROSE_TOKEN =
  /^(?:d\/s|w\/w|w\/g|i\/lub|lub\/i|m\.i[nm]|d\.s|p\.n\.e|dz\.cyt|op\.cit)$/iu;

/** `replacement` in the case of the letters of `typed`. */
export const caseLike = (typed: string, replacement: string) => carryCase(typed, replacement, true);

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
  /** A capital inside a sentence makes it a name ("w Głownie", "Maja"): abstain. */
  lowercase?: true;
}

/** The text before `start` ends a sentence (or nothing comes before it). */
export function sentenceStartAt(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 8), start);
  return /(?:[.!?…]["”’»)]*\s+|\n\s*)$/u.test(before) || /^\s*$/u.test(text.slice(0, start));
}

export function findingAt(
  ctx: DetectContext,
  start: number,
  end: number,
  alternatives: readonly string[],
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
): RawFinding {
  return finding(ruleId, messageKey, start, end, [...alternatives], {
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    // No single fix (an impossible date): the finding only warns.
    ...(alternatives.length === 0 ? { warningOnly: true as const } : {}),
    context: {
      start: Math.max(0, start - 96),
      end: Math.min(ctx.text.length, end + 32),
    },
  });
}

const QUOTE_MARK = new RegExp(`[${OPENING_QUOTES}]`, "gu");
// The quote marks of each chunk context. The scans of one chunk share them.
const QUOTE_MARKS = new WeakMap<DetectContext, number[]>();

/**
 * namedExampleBefore(text, at) reads back from a quote mark at most 81 characters before `at`.
 * Without such a mark it is false, so it is not called.
 */
function mayBeExample(ctx: DetectContext, at: number): boolean {
  let marks = QUOTE_MARKS.get(ctx);
  if (!marks) {
    marks = [];
    QUOTE_MARK.lastIndex = Math.max(0, ctx.from - 81);
    for (let m = QUOTE_MARK.exec(ctx.text); m && m.index < ctx.to; m = QUOTE_MARK.exec(ctx.text))
      marks.push(m.index);
    QUOTE_MARKS.set(ctx, marks);
  }
  return marks.some((mark) => mark < at && mark >= at - 81);
}

/** Owned regex matches of a hand-written scan (not a frame), with the example guard. */
export function* owned(ctx: DetectContext, regex: RegExp): Generator<RegExpExecArray> {
  regex.lastIndex = Math.max(0, ctx.from - 64);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    if (m.index < ctx.from) continue;
    if (mayBeExample(ctx, m.index) && namedExampleBefore(ctx.text, m.index)) continue;
    yield m;
  }
}
