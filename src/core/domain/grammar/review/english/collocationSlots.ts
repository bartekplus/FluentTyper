// The head table of en.collocations is in grammar/rules/en.yaml. The head frame keeps its
// fixer name: tests/grammar/ReviewCollocationHeadFrame.test.ts finds the frame by that name.
import type { MatchFixer } from "../../engine/reviewRules";
import { collocationHead, COLLOCATION_ROWS } from "../../engine/rules/en.generated";

export { COLLOCATION_ROWS as ROWS };

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = { collocationHead } satisfies Record<string, MatchFixer>;
