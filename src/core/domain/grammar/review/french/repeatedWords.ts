import { namedExampleBefore } from "../exampleCues";
import type { DetectContext } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { finding } from "../finding";
import { inChunk, tokensAfter, tokensBefore } from "./frenchTokens";

// A word or a pair of words typed two times in a row (opt-in): "très très", "tu as tu as".
// Spoken French doubles some words for emphasis, so the check is off by default.

const RULE = "frenchRepeatedWords";
const MESSAGE = "review_msg_repeated_words";

// The default-on repeated-word check already reads these (reviewDetectors.ts REPEATABLE_WORDS).
const DEFAULT_ON = new Set(
  (
    "le les une des du au aux dans pour avec sur et mais est sont par ce cette ces sans je tu " +
    "il ils on à mon ma mes ton ta tes son sa ses"
  ).split(" "),
);
// Words that French doubles with no error: interjections and sounds ("ah ah", "là là"), a
// stressed pronoun before its clitic ("lui lui a dit"), "en en mangeant", "si si", "non non".
const DOUBLED_OK = new Set(
  (
    "ah ha hé eh oh ho hi hein là si non oui bon bla toc pan chut hop ouh ouf bye da tic tac " +
    "cha tam lui en nous vous elle elles"
  ).split(" "),
);
const PERSONAL = new Set("je j' tu il elle on ils elles".split(" "));

/** "nous nous", "vous vous": a reflexive verb, unless another subject comes before them or "ne"
 * comes after them ("je vous vous écris", "que nous nous ne mentions pas"). */
function extraPronoun(ctx: DetectContext, start: number, end: number): boolean {
  const before = tokensBefore(ctx.text, start, 1)[0];
  const after = tokensAfter(ctx.text, end, 1)[0];
  return (before !== undefined && PERSONAL.has(before.w)) || ["ne", "n'"].includes(after?.w ?? "");
}

/** The named frame fixes of grammar/rules/fr.yaml (`fixer:`). */
export const FIXERS = {
  repeatedWord: inChunk((m, ctx) => {
    const unit = m.groups!.unit;
    const lower = unit.toLowerCase().replaceAll("’", "'");
    const words = lower.split(/[ \t]+/);
    const end = m.index + m[0].length;
    // "p p": spelled-out letters; "Coco Coco": a capital on the second copy starts a name.
    const second = ctx.text.slice(end - unit.length, end);
    if (words.some((w) => w.length < 2) || second !== second.toLowerCase()) return null;
    if (words.length === 1 && DEFAULT_ON.has(lower)) return null;
    if (words.some((w) => DOUBLED_OK.has(w))) {
      const pronoun = words.length === 1 && (lower === "nous" || lower === "vous");
      if (!pronoun || !extraPronoun(ctx, m.index, end)) return null;
    }
    if (namedExampleBefore(ctx.text, m.index)) return null;
    return finding(RULE, MESSAGE, m.index, end, [unit], { context: { start: m.index, end } });
  }),
} satisfies Record<string, MatchFixer>;
