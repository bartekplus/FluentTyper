// The rule library (library.ts): helpers of every language. Quotations, examples, words around
// a match and the findings built from them.
export { namedExampleBefore, quotedSpan, CUE_AND_QUOTE } from "../review/exampleCues";
export {
  around,
  caseLike,
  COMPLETE,
  found,
  group,
  hasUserOrCasedWord,
  isLang,
  ownedMatches,
  PSEUDO_CLEFT_BEFORE,
  TOKEN_END,
  WORD_START,
} from "../review/phraseTemplates";
export { finding } from "../review/finding";
export { graphemeEnd, overlapsSortedRanges, withTextApostrophes } from "../review/textRanges";
export {
  applyWordCase,
  carryCase,
  detectWordCase,
  isLowercaseLetter,
  isTechnicalToken,
  lastNonSpaceBefore,
  memoize,
} from "../implementations/helpers/GenericRuleShared";
export { lastNonBlankBefore, opensClause } from "../implementations/helpers/EnglishRuleShared";
export { MASK_CHAR } from "../review/types";
export { digitValue, invalidIsoDate } from "../review/isoDates";
export { phraseRows } from "./common/engine";
export {
  englishNounForms,
  hasCountPrefix,
} from "../implementations/helpers/EnglishNounNumber";
export { englishWordInfo } from "../implementations/helpers/EnglishLexicon";
