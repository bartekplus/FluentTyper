// The rule library: the only code that the expressions of the rule files (rules/*.yaml) may call.
// Each export is generic. It takes the words, lists and patterns it reads as arguments and names
// no rule; the logic of a rule stays in its rule file. scripts/grammarRules.ts reads this module:
// a name the expressions read must be exported here, and the generated rule modules import it.

// Types of the generated rule modules and of def signatures.
export type { DetectContext, RawFinding } from "./review/reviewDetectors";
export type { FrameRef, MatchResult } from "./engine/reviewRules";
export type { FixResult } from "./review/english/idioms5";
export type { TextRange } from "./review/types";

// Text and collections.
export { capitalize, remember } from "./library/text";

// Quotations and examples.
export { namedExampleBefore } from "./review/exampleCues";

// German lexicon.
export { germanAdjective, germanGender, germanInfinitive } from "./review/german/germanLexicon";
