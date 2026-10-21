// The rule library: the only code that the expressions of the rule files (rules/*.yaml) may call.
// Each export is generic: it answers a question about the text or the language, or builds a
// finding or an edit from the parts it gets. It names no check and no message, and it holds no
// rule's trigger words, exceptions or fix text: those stay in the rule files.
//
// scripts/grammarRules.ts reads this file and the library/ files it re-exports with `export *`:
// a name that an expression reads must be exported there. Each area has its own file.

// Types of the generated rule modules and of def signatures.
export type { DetectContext, RawFinding } from "./review/reviewDetectors";
export type { FrameRef, MatchResult } from "./engine/reviewRules";
export type { FixResult } from "./library/english/frames";
export type { TextRange } from "./review/types";
export type { GrammarContext, GrammarEdit } from "./types";
export type { LiveRuleOptions } from "./engine/liveRules";

export * from "./library/text";
export * from "./library/common";
export * from "./library/typing";
export * from "./library/english";
export * from "./library/german";
export * from "./library/french";
export * from "./library/spanish";
export * from "./library/polish";
export * from "./library/portuguese";
export * from "./library/arabic";
export * from "./library/greek";
export * from "./library/swedish";
