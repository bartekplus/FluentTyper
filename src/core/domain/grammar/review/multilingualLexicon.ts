// The word tables and frames of the Review-only extensions of English rules to the other
// languages are in grammar/rules/common.yaml (rules doubledDegree.*, spelling, properNouns.de).
import { spellingFrameRegexes } from "../engine/rules/common.generated";

/** The regexes of the spelling frames: a test keeps the frames in step with the word tables. */
export const SPELLING_FRAME_REGEXES: readonly RegExp[] = spellingFrameRegexes();
