// The rule library (library.ts): helpers of every language. Quotations, examples, words around
// a match and the findings built from them.
export { namedExampleBefore, quotedSpan, CUE_AND_QUOTE } from "../review/exampleCues";
export {
  caseLike,
  COMPLETE,
  group,
  hasUserOrCasedWord,
  isLang,
  PSEUDO_CLEFT_BEFORE,
  TOKEN_END,
  WORD_START,
} from "../review/phraseTemplates";
export { finding } from "../review/finding";
export { graphemeEnd, overlapsSortedRanges, withTextApostrophes } from "../review/textRanges";
export {
  applyWordCase,
  carryCase,
  isLowercaseLetter,
  isTechnicalToken,
  lastNonSpaceBefore,
  memoize,
} from "../implementations/helpers/GenericRuleShared";
export { lastNonBlankBefore, opensClause } from "../implementations/helpers/EnglishRuleShared";
export { MASK_CHAR } from "../review/types";
export { phraseRows } from "./common/engine";
