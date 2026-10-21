// The rule library (library.ts): the typing rules' helpers. The text before the cursor, its
// words and the edits a typing rule gives.
export {
  matchTrailingEnglishPhrase,
  replaceFrom,
} from "../implementations/helpers/EnglishRuleShared";
export { detectWordCase, normalizeWordSet } from "../implementations/helpers/GenericRuleShared";
