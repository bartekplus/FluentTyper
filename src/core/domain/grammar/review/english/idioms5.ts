// A facade: the idioms5 frames are code in grammar/rules/en.yaml. engine/frameStyles.ts, the rule
// library and the frame health test import these names here.
export type { Fix, FixResult, Frame, Rule } from "../../library/english/frames";
export { recase } from "../../library/english/words";
export { FRAME_SETS } from "../../engine/frameStyles";
