// The named Review detectors of grammar/rules/en.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type FindingsFilter, type Fixer } from "../../engine/reviewRules";
import * as apostrophes from "./apostrophes";
import * as compoundForms from "./compoundForms";
import * as properNames from "./properNames";
import * as plainStyle from "./plainStyle";
import * as passiveVoice from "./passiveVoice";
import * as punctuation from "./punctuation";
import * as articles from "./articles";
import * as slotConfusions from "./slotConfusions";
import * as britishUsage from "./britishUsage";
import * as typography from "./typography";
import * as confusions1 from "./confusions1";
import * as dates from "./dates";
import * as contractionSlots from "./contractionSlots";
import * as degreeSlots from "./degreeSlots";
import * as nounNumberSlots from "./nounNumberSlots";
import * as verbGroupSlots from "./verbGroupSlots";
import * as complementSlots from "./complementSlots";
import * as missingVerbSlots from "./missingVerbSlots";
import * as determinerSlots from "./determinerSlots";
import * as agreementSlots from "./agreementSlots";
import * as adverbSlots from "./adverbSlots";
import * as confusionSlots from "./confusionSlots";
import * as countSlots from "./countSlots";
import * as negationSlots from "./negationSlots";
import * as relativeSlots from "./relativeSlots";
import * as questionSlots from "./questionSlots";
import * as comparisonSlots from "./comparisonSlots";
import * as collocationSlots from "./collocationSlots";
import * as tenseSlots from "./tenseSlots";
import * as noNotSlots from "./noNotSlots";
import * as clauseAgreementSlots from "./clauseAgreementSlots";
import * as wordClassSlots from "./wordClassSlots";
import * as dialects from "./dialects";
import * as lexical from "./lexical";
import * as remaining from "./remaining";
import * as usageTables from "./usageTables";
import * as confusions2 from "./confusions2";
import * as fixedPhrases from "./fixedPhrases";
import * as grammarStyle1 from "./grammarStyle1";
import * as grammarStyle2 from "./grammarStyle2";
import * as idioms1 from "./idioms1";
import * as idioms2 from "./idioms2";
import * as idioms3 from "./idioms3";
import * as idioms4 from "./idioms4";
import * as idioms5 from "./idioms5";
import * as clauseSlots from "./clauseSlots";
import * as everydaySlots from "./everydaySlots";
import * as wordFormSlots from "./wordFormSlots";
import * as typoSlots from "./typoSlots";
import * as neighbourSlots from "./neighbourSlots";
import * as prepositionSlots from "./prepositionSlots";
import * as clauseFrames from "./clauseFrames";
import * as slipFrames from "./slipFrames";
import * as realWordFrames from "./realWordFrames";
import * as clauseGaps from "./clauseGaps";
import * as misheardWords from "./misheardWords";
import * as verbSlots from "./verbSlots";
import * as nounSlots from "./nounSlots";
import * as agreementFrames from "./agreementFrames";
import * as neighbourTypos from "./neighbourTypos";
import * as clashFrames from "./clashFrames";

export const PREDICATES = mergePredicates(
  fixedPhrases.PREDICATES,
  confusions1.PREDICATES,
  confusions2.PREDICATES,
  grammarStyle1.PREDICATES,
  grammarStyle2.PREDICATES,
  dialects.PREDICATES,
  lexical.PREDICATES,
  remaining.PREDICATES,
  compoundForms.PREDICATES,
  dates.PREDICATES,
  usageTables.PREDICATES,
  contractionSlots.PREDICATES,
  degreeSlots.PREDICATES,
  nounNumberSlots.PREDICATES,
  complementSlots.PREDICATES,
  missingVerbSlots.PREDICATES,
  determinerSlots.PREDICATES,
  adverbSlots.PREDICATES,
  confusionSlots.PREDICATES,
  countSlots.PREDICATES,
  negationSlots.PREDICATES,
  relativeSlots.PREDICATES,
  questionSlots.PREDICATES,
  comparisonSlots.PREDICATES,
  collocationSlots.PREDICATES,
  tenseSlots.PREDICATES,
  noNotSlots.PREDICATES,
  clauseAgreementSlots.PREDICATES,
  wordClassSlots.PREDICATES,
  apostrophes.PREDICATES,
  properNames.PREDICATES,
  typography.PREDICATES,
  plainStyle.PREDICATES,
  passiveVoice.PREDICATES,
  punctuation.PREDICATES,
  articles.PREDICATES,
  clauseSlots.PREDICATES,
);

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  idioms3.FIXERS,
  articles.FIXERS,
  idioms5.FIXERS,
  slotConfusions.FIXERS,
  clauseGaps.FIXERS,
  slipFrames.FIXERS,
  neighbourTypos.FIXERS,
  clashFrames.FIXERS,
  idioms1.FIXERS,
  idioms2.FIXERS,
  idioms4.FIXERS,
  agreementFrames.FIXERS,
  clauseFrames.FIXERS,
  britishUsage.FIXERS,
  misheardWords.FIXERS,
  neighbourSlots.FIXERS,
  nounSlots.FIXERS,
  prepositionSlots.FIXERS,
  realWordFrames.FIXERS,
  typoSlots.FIXERS,
  verbSlots.FIXERS,
  remaining.FIXERS,
  everydaySlots.FIXERS,
  wordFormSlots.FIXERS,
  verbGroupSlots.FIXERS,
  agreementSlots.FIXERS,
);

/** The named findings filters of grammar/rules/en.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>(
  articles.FILTERS,
  grammarStyle1.FILTERS,
  everydaySlots.FILTERS,
);
