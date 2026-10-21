// The rule library (library.ts): helpers of every language. Quotations, examples, words around
// a match and the findings built from them, and the English lexicon that the shared English
// rules of common.yaml read.
export { namedExampleBefore, quotedSpan, CUE_AND_QUOTE } from "../review/exampleCues";
export type { MeasurementLocalePolicy } from "../measurement/contracts";
export {
  around,
  caseLike,
  COMPLETE,
  found,
  gluedAfter,
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
export { carryCase, memoize } from "../implementations/helpers/GenericRuleShared";
export { lastNonBlankBefore } from "../implementations/helpers/EnglishRuleShared";
export { MASK_CHAR } from "../review/types";
export { digitValue, invalidIsoDate } from "../review/isoDates";
export { phraseRows } from "./common/engine";
export { atClauseStart, lastBefore, matchesFrom, previousWord } from "./common/text";
export { isUniquePast, pluralNoun, simplePastOnly } from "./common/english";
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
export { englishInflect, englishLemma } from "../implementations/helpers/EnglishInflection";
export {
  groupRange,
  isGluedToTechnical,
  isWhitespaceAt,
  isWordCharAt,
  lastIndexInChunk,
  lowerCodeAt,
  ownedByChunk,
  phraseMatch,
  previousTokensStart,
  resumeScan,
  skipForwardWhile,
  tokenEndAfter,
  tokenEndBefore,
  tokenAt,
  tokenStartBefore,
} from "./common/tokens";
export {
  contextYear,
  dateSide,
  dayCount,
  daysInMonth,
  nearestDayOn,
  recentPast,
  weekdayOf,
  yearsFor,
} from "../review/reviewClock";
export {
  clauseTokensAfter,
  skipComplements,
  skipCoordinated,
  skipNounPhrase,
  skipPostnominal,
  verbAfterRelative,
} from "../review/clauseReader";
export type { ClauseProfile, ClauseToken } from "../review/clauseReader";
export { quoteMarkEdits } from "./common/quotes";
