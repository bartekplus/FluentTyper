// A facade: the idioms5 frames are code in grammar/rules/en.yaml. engine/frameStyles.ts, the rule
// library and the frame health test import these names here.
import type { Rule } from "../../library/english/frames";

export type { Fix, FixResult, Frame, Rule } from "../../library/english/frames";
export { recase } from "../../library/english/words";
export { FRAME_SETS } from "../../engine/frameStyles";

// The checks and messages of the English phrase frames. tests/grammar/ReviewExplanations.test.ts
// reads the message keys of the review/ sources.
export const PHRASE: Rule = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_phrase_correction",
};
export const CONTEXT: Rule = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_contextual_grammar",
};
export const TYPO: Rule = { ruleId: "englishPhraseCorrections", messageKey: "review_msg_typo" };
export const COMPOUND: Rule = {
  ruleId: "englishContextualCompounds",
  messageKey: "review_msg_compounds",
};
