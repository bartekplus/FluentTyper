// The rule library (library.ts): the typing rules' helpers. The text before the cursor, its
// words and the edits a typing rule gives.
export {
  findTrailingLetterToken,
  isPartOfTechnicalToken,
  matchTrailingEnglishPhrase,
  opensClause,
  replaceFrom,
  resolveEnglishBoundaryContext,
} from "../implementations/helpers/EnglishRuleShared";
export type { EnglishBoundaryContext } from "../implementations/helpers/EnglishRuleShared";
export {
  applyWordCase,
  detectWordCase,
  getLastToken,
  isLowercaseLetter,
  isTechnicalToken,
  isWordChar,
  lastNonSpaceBefore,
  normalizeWordSet,
  shouldSkipGenericReplacement,
  splitTrailingSpaces,
} from "../implementations/helpers/GenericRuleShared";
export { englishInitialSound } from "../implementations/helpers/EnglishInitialSound";
export { isInsideProtectedSpan } from "../implementations/helpers/ProtectedSpanShared";
export { PUNCTUATION_EQUIVALENTS, SPACE_CHARS, SPACING_OR_FILLER_CHARS } from "../../spacingRules";
export {
  isGreekQuestionMark,
  NBSP,
  NNBSP,
  resolveTypographyProfile,
  usesFrenchPunctuationSpacing,
} from "../typographyProfiles";
export { parseMeasurementExpression } from "../measurement/parser";
export { resolveMeasurementLocale } from "../measurement/registry";
export {
  CLOSING_CHARS,
  CLOSING_PADDING_CHARS,
  closesAbbreviation,
  keepsOwnCasing,
  periodEndsSentence,
  SENTENCE_CLOSERS,
  SENTENCE_OPENERS,
  SENTENCE_OPENING_MARKS,
  startsSentence,
  TRAILING_PUNCTUATION_REGEX,
} from "./typing/sentences";
export type { AbbreviationOptions } from "./typing/sentences";
export {
  execFrom,
  matchingOpenIndex,
  readMemo,
  runStart,
  storeMemo,
  typingEdit,
} from "./typing/text";
