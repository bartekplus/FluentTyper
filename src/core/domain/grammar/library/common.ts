// The rule library (library.ts): helpers of every language. Quotations, examples, words around
// a match and the findings built from them, and the English lexicon that the shared English
// rules of common.yaml read.
export { namedExampleBefore, quotedSpan, CUE_AND_QUOTE } from "../review/exampleCues";
export {
  around,
  caseLike,
  COMPLETE,
  found,
  group,
  hasUserOrCasedWord,
  isLang,
  nextLowerWord,
  opensSentence,
  ownedMatches,
  plainToken,
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
export { atClauseStart, previousWord } from "./common/text";
export {
  englishNounNumber,
  isEnglishFunctionWord,
  isUniquePast,
  pluralNoun,
  simplePastOnly,
} from "./common/english";
export {
  englishNounForms,
  hasCountPrefix,
  knownEnglishNounNumber,
} from "../implementations/helpers/EnglishNounNumber";
export {
  ENGLISH_MASS_NOUNS,
  MASS_WITH_COUNT_SENSE,
} from "../implementations/helpers/EnglishCountability";
export { englishWordInfo, hasVerbForm } from "../implementations/helpers/EnglishLexicon";
export { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
export { englishInitialSound } from "../implementations/helpers/EnglishInitialSound";
export { englishInflect, englishLemma } from "../implementations/helpers/EnglishInflection";
